/// Registry.js: Javascript interface for the Macroverse Universal Registry
/// which allows subscribing to ownership update events for token keypaths,
/// creating, revealing, and canceling commitments, and sending ERC721 tokens
/// representing Macroverse virtual real estate.

// Load up the facade over web3 and truffle-contract
const eth = require('./eth.js')

// And the keypath manipulatioin code
const {getKeypath, setKeypath, lastComponent, parentOf} = require('./keypath.js')

// And the event emitter which we use to structure our API
const { EventEmitter2 } = require('eventemitter2')

const mv = require('macroverse')

// The actual Registry class. External interface.
// Events are associated with keypaths.
// Right now the only event is <whatever>.owner, which corresponds to the owner
// of the given Macroverse world object or plot of land. If the item is
// unowned, it is 0.
class Registry extends EventEmitter2 {
  // Construct a Registry using the specified base path for fetching contracts. 
  constructor(basePath) {
    super()

    // EventEmitter has Strong Opinions on how many clients we ought to have.
    // Override them.
    // TODO: Are we actually leaking memory/listeners?
    this.setMaxListeners(100000)

    // Save the base path
    this.basePath = basePath

    // Make a place to put the registry contract 
    this.reg = undefined

    // Make a cache from keypath to last known value.
    // We only do in memory cacheing; we get everything from the chain on every run since it's not much data.
    this.cache = {}

    // This counts how many listeners we have subscribed to each keypath, so we
    // can know when to create/destroy Ethereum listeners.
    this.subscriberCount = {}

    // This holds outstanding Ethereum watch filters by the keypath they back
    this.watchers = {}

    // Say we aren't initializing yet
    this.initPromise = undefined
    // Kick off async initialization
    this.init();
  }

  // Returns a promise for the async object initialization, kicked off by the constructor.
  // Resolves when the initialization is complete.
  init() {
    // Asynchronous initialization logic
    if (this.initPromise == undefined) {
      // We aren't initializing yet
      this.initPromise = (async () => {
        // Do the actual init work here.

        // Find the registry instance
        this.reg = await eth.get_instance(this.getContractPath('MacroverseUniversalRegistry'))
      })()
    }
    return this.initPromise
  }

  // Get the full relative URL to the JSON file for the contract, given its name (e.g. MacroverseUniversalRegistry).
  // TODO: Univy this with what the Datasource has somehow. Make a common base class?
  getContractPath(contractName) {
    // Only use the separating slash if we have a path component to separate from.
    // Otherwise we would be asking for /whatever.json at the web server root.
    return this.basePath + (this.basePath != '' ? '/' : '') + contractName + '.json'
  }

  // Subscribe to events at the given keypath. Handler will be called with the
  // initial value of the keypath, and subsequently with new values as events
  // come from the chain. Returns a subscription value that can be passed back
  // to unsubscribe *exactly once* to stop listening. 
  // May not be called multiple times for the same event and function without
  // intervening unsubscribe calls.
  subscribe(keypath, handler) {
    console.log('Subscribing to ' + keypath, handler)

    // Listen for the event
    this.on(keypath, handler)

    if (this.subscriberCount[keypath]) {
      // This keypath is already being listened to
      this.subscriberCount[keypath]++
    } else {
      // This is the first subscriber to this keypath.
      // Begin listening for updates to the item from the chain
      this.watchChain(keypath)
      this.subscriberCount[keypath] = 1
    }

    if (this.cache.hasOwnProperty(keypath)) {
      // If we have the current value cached, emit it at once.
      this.emit(keypath, this.cache[keypath])
    } else {
      // We don't have it

      // See if that fires before we can get an initial value
      let gotValueAlready = false
      // Make sure that we won't announce a stale value if an event comes in between the request and the reply.
      let catchEvent = (val) => {
        gotValueAlready = true
        this.cache[keypath] = val
      }
      this.once(keypath, catchEvent)

      // Kick off something to get an initial value, and emit that if it arrives before any updates.
      this.retrieveFromChain(keypath).then((val) => {
        if (!gotValueAlready) {
          // We won the race against the listener
          this.off(keypath, catchEvent)
          this.cache[keypath] = val
          this.emit(keypath, val)
        }
        // Otherwise the listener won and removed itself. Drop the value we just got.
      })
    }

    // If we aren't listening for the appropriate backing events from the blockchain, do it

    // The subscription is just the keypath and the handler, because the
    // backing EventEmitter2 has each function subscribe to each event up to
    // once.
    return [keypath, handler]

  }

  // Remove a subscription created by subscribe.
  // May be called at most once per subscription!
  unsubscribe(subscription) {
    let [keypath, handler] = subscription

    this.off(keypath, handler)

    if (this.subscriberCount[keypath] > 1) {
      // This keypath is still being listened to
      this.subscriberCount[keypath]--
    } else if (this.subscriberCount[keypath] == 1) {
      // This is the last subscriber to this keypath.
      // Stop listening for updates to the item from the chain
      this.unwatchChain(keypath)
      this.subscriberCount[keypath] = 0
    } else {
      // The client has gotten confused in matching their subscribes and unsubscribes
      throw new Error('Too many unsubscribes for event ' + keypath)
    }
  }

  // Return a promise for the value represented by the given keypath
  async retrieveFromChain(keypath) {
    if (lastComponent(keypath) == 'owner') {
      // We want the owner of something
      // Pack the token value
      let token = mv.keypathToToken(parentOf(keypath))

      // TODO: We need a method we can call to get the owner that will succeed eevn if the token is nonexistent.
      // Or we need a good way to tell a throw in the contract code from a failure to talk to the Ethereum node.
      let token_owner = await this.reg.ownerOf(token).catch((err) => {
        console.log('Error getting owner, assuming unowned', err)
        return 0
      })
      
      return token_owner
    } else {
      throw new Error('Unsupported keypath ' + keypath)
    }
  }

  // Start listening for Ethereum events that back the given keypath. When they
  // arrive, fire the keypath's event with the appropriate value.
  watchChain(keypath) {
    if (this.watchers[keypath] !== undefined) {
      throw new Error('Trying to double-watch ' + keypath)
    }
    
    if (lastComponent(keypath) == 'owner') {
      // We want the owner of something
      // Pack the token value
      let token = mv.keypathToToken(parentOf(keypath))

      // Set up a filter for the transfer of this token from here on out
      let filter = this.reg.Transfer({'tokenId': token}, { fromBlock: 'latest', toBlock: 'latest'})
      filter.watch((error, event_report) => {
        if (event_report.event == 'Transfer' && event_report.args.tokenId == token) {
          // This actually should have passed the filter. Emit the to address.
          this.emit(keypath, event_report.args.to)
        }
      })

      // Remember the filter so we can stop watching.
      this.watchers[keypath] = filter
    } else {
      throw new Error('Unsupported keypath ' + keypath)
    }
  }

  // Stop listening for Ethereum events that back the given keypath.
  unwatchChain(keypath) {
    if (this.watchers[keypath] == undefined) {
      throw new Error('Trying to unwatch unwatched ' + keypath)
    }

    // Stop and clear out the watcher
    this.watchers[keypath].stopWatching()
    this.watchers[keypath] = undefined
  }

}

// Async factory method for users to get a Registry. Actually exported.
// Needs to know where to find the smart contracts.
async function get_registry(basePath) {
  let reg = new Registry(basePath)
  await reg.init()
  return reg
}

module.exports = get_registry

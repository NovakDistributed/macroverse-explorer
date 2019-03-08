/// Registry.js: Javascript interface for the Macroverse Universal Registry
/// which allows subscribing to ownership update events for token keypaths,
/// creating, revealing, and canceling commitments, and sending ERC721 tokens
/// representing Macroverse virtual real estate.
/// Also handles making MRV transactions and reporting MRV balances.

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
    // And the MRV token contract for approvals
    this.mrv = undefined

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
        [this.reg, this.mrv] = await Promise.all([eth.get_instance(this.getContractPath('MacroverseUniversalRegistry')),
          eth.get_instance(this.getContractPath('MRVToken'))])
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
    console.log('Subscribing to ' + keypath)

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

      // Decide if it should have an owner right now
      let owned = await this.reg.exists(token);

      if (owned) {
        // We think it is owned

        let token_owner = await this.reg.ownerOf(token).catch((err) => {
          // Maybe it became unowned while we were looking at it
          console.log('Error getting owner, assuming unowned', err)
          return 0
        })

        return token_owner

      } else {
        // It doesn't appear to have an owner
        return 0
      }
      
      
    } else {
      throw new Error('Unsupported keypath ' + keypath)
    }
  }

  // Start listening for Ethereum events that back the given keypath. When they
  // arrive, fire the keypath's event with the appropriate value.
  watchChain(keypath) {
    console.log('Watching chain for changes to ' + keypath)

    if (this.watchers[keypath] !== undefined) {
      throw new Error('Trying to double-watch ' + keypath)
    }
    
    if (lastComponent(keypath) == 'owner') {
      // We want the owner of something
      // Pack the token value
      let token = mv.keypathToToken(parentOf(keypath))

      // Set up a filter for the transfer of this token from here on out.
      // Note: this also catches any events in the current top block when we make it
      let filter = this.reg.Transfer({'tokenId': token}, { fromBlock: 'latest', toBlock: 'latest'})
      filter.watch((error, event_report) => {
        console.log('Saw event: ', event_report)
        if (event_report.type != 'mined') {
          // This transaction hasn't confirmed, so ignore it
          return
        }
        this.emit(keypath, event_report.args.to)
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

  // Now we have a bunch of code to work with claims.
  // We locally store (in local storage) the keypath and nonce for every claim, by hash.
  // We also collect the commitment ID for the hash when we get a chance, by querying the events.
  // For now we don't implement recovery/searching for claims we don't have in local storage

  // Approve a certain number of MRV (in MRV-wei) as a deposit with the registry
  async approveDeposit(deposit) {
    // Work out our account
    let account = await eth.get_account()

    console.log('Approving deposit transfer by ' + this.reg.address)

    // Prompt for the approve transaction on the ERC20, for the deposit
    // This always seems to work with the default gas.
    await this.mrv.approve(this.reg.address, deposit, {from: account})

    console.log('Approved deposit')
  }

  // Make a claim for the given keypath. Prompt the user to approve the transaction and send it to the chain.
  // Record the nonce locally for the keypath, and if/when the claim gets an ID, record that too.
  // Deposit must be a BigNumber.
  // Returns the hash that identifies the claim.
  async createClaim(keypath, deposit) {

    // Work out our account
    let account = await eth.get_account()

    // Pack up the token
    let token = mv.keypathToToken(keypath)

    // Roll a random secret nonce
    let nonce = mv.generateNonce()
    
    // Compute a hash
    let data_hash = mv.hashTokenAndNonce(token, nonce)

    console.log('Token: 0x' + token.toString(16))
    console.log('Nonce: 0x' + nonce.toString(16))
    console.log('Hash: ' + data_hash)
    console.log('Deposit: ' + deposit.toString())

    // Save all this stuff to local storage under the hash.
    // If we lose these, all we can do is cancel the commitment, if we can even find it.
    window.localStorage.setItem('commitment.' + data_hash + '.token', '0x' + token.toString(16))
    window.localStorage.setItem('commitment.' + data_hash + '.nonce', '0x' + nonce.toString(16))
    window.localStorage.setItem('commitment.' + data_hash + '.account', account)

    // Approve the deposit
    await approveDeposit(deposit)

    // Now the deposit approval is mined.

    // Estimate commitment gas.
    // truffle-contract is too conservative (gives the conserved gas exactly,
    // which makes us hit 0) so we double it.
    let gas = await this.reg.commit.estimateGas(data_hash, deposit, {from: account}) * 2

    console.log('Commitment will probably take ' + gas + ' gas')

    // Commit for it
    await this.reg.commit(data_hash, deposit, {from: account, gas: gas})

    console.log('Commitment made')

    return data_hash
  }

  // Given the hash used to create a (successfully made) claim, do the reveal.
  // Fails if the claim has not matured or has expired
  async revealClaim(data_hash) {
    // Load from local storage
    let token = window.localStorage.getItem('commitment.' + data_hash + '.token')
    let nonce = window.localStorage.getItem('commitment.' + data_hash + '.nonce')
    let account = window.localStorage.getItem('commitment.' + data_hash + '.account')

    console.log('Token: ' + token)
    console.log('Nonce: ' + nonce)
    console.log('Hash: ' + data_hash)

    let gas = await this.reg.reveal.estimateGas(token, nonce, {from: account}) * 2

    console.log('Reveal will probably take ' + gas + ' gas')

    await this.reg.reveal(token, nonce, {from: account, gas: gas})

    console.log('Commitment revealed successfully')
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

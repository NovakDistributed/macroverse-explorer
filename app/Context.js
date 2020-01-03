// Context.js: defines a Context class, an instance of which represents a connection to the Macroverse system.
// Handles finding all the contracts, talking to web3, etc.
// Holds instances of the cache classes for querying the generators.
// TODO: Backport to the macroverse module itself?

// Load up the facade over web3 and truffle-contract
const eth = require('./eth.js')

// And the event emitter which we use to be a bus for global navigation events
const { EventEmitter2 } = require('eventemitter2')

// And the datasource, which lets us see fixed properties of the Macroverse world 
const Datasource = require('./Datasource.js')

// And the Registry, which handles real estate token ownership and commitments
// And the datasource we are replacing them with
const Registry = require('./Registry.js')

// Add the Wallet UI server
const Wallet = require('./Wallet.js')

// The actual context class. External interface.
// Users should listen to the 'show' event for keypaths to draw, and raise it when they want to navigate.
class Context extends EventEmitter2 {
  // Construct a context using the specified base path for fetching contracts. 
  constructor(basePath) {
    super()

    // Save the base path
    this.basePath = basePath

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

        // Make a Datasource that makes queries from the specified address
        this.ds = await Datasource(this.basePath, await eth.get_account())

        // And a Registry
        this.reg = await Registry(this.basePath)

        // Add a Wallet UI that knows about the account
        this.wallet = new Wallet(this, await eth.get_account())

      })()
    }
    return this.initPromise
  }

}

// Async factory method for users to get contexts. Actually exported.
async function get_context(basePath) {
  let ctx = new Context(basePath)
  await ctx.init()
  return ctx
}

module.exports = get_context

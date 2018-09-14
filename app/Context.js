// Context.js: defines a Context class, an instance of which represents a connection to the Macroverse system.
// Handles finding all the contracts, talking to web3, etc.
// Holds instances of the cache classes for querying the generators.
// TODO: Backport to the macroverse module itself?

// Load up the facade over web3 and truffle-contract
const eth = require('./eth.js')

// And the event emitter which we use to be a bus for global navigation events
const { EventEmitter2 } = require('eventemitter2')

// And the datasource we are replacing them with
const Datasource = require('./Datasource.js')

// The actual context class. External interface.
// Users should listen to the 'show' event for keypaths to draw, and raise it when they want to navigate.
class Context extends EventEmitter2 {
  // Construct a context using the specified base path for fetching contracts. 
  constructor(basePath) {
    super()

    // Save the base path
    this.basePath = basePath

    // Set up some fields for the caches
    this.stars = undefined
    this.planets = undefined

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

        // Find the MacroverseStarGenerator instance
        let MacroverseStarGenerator = await eth.get_instance(this.getContractPath('MacroverseStarGenerator'))

        // And the generator for planets (which fills in some more star properties relevant for planets)
        let MacroverseSystemGenerator = await eth.get_instance(this.getContractPath('MacroverseSystemGenerator'))
        
        // Make a Datasource
        this.ds = await Datasource(this.basePath)

      })()
    }
    return this.initPromise
  }

  // Get the full relative URL to the JSON file for the contract, given its name (e.g. MacroverseStarGenerator).
  getContractPath(contractName) {
    // Only use the separating slash if we have a path component to separate from.
    // Otherwise we would be asking for /whatever.json at the web server root.
    return this.basePath + (this.basePath != '' ? '/' : '') + contractName + '.json'
  }

}

// Async factory method for users to get contexts. Actually exported.
async function get_context(basePath) {
  let ctx = new Context(basePath)
  await ctx.init()
  return ctx
}

module.exports = get_context

// Datasource.js: defines a cacheing, keypath-based interface to the Macroverse smart contracts.
// Users send queries in with .request(keypath).
// They can get responses with .on().
// Replies will be sent as events named by the keypath, with the value being the value requested.

// Load up the facade over web3 and truffle-contract
const eth = require('./eth.js')

// And the cache implementations
const StarCache = require('./StarCache.js')
const PlanetCache = require('./PlanetCache.js')

// And the event emitter which we use to structure our API
const { EventEmitter2 } = require('eventemitter2')

// And the timers module which we use to defer our queue processing
const timers = require('timers')

// We define a tiny keypath get/set library

// Return the value of the given keypath, or undefined if it or any parent is not present
function getKeypath(obj, keypath) {
  if (obj == undefined) {
    // Base case: hit a dead end
    return undefined
  }

  if (keypath == '') {
    // Other base case: no more components
    return obj
  }

  // Look for a delimiter
  var dot = keypath.indexOf('.')
  if (dot == -1) {
    // Just look this up
    return obj[keypath]
  }

  let first = keypath.substr(0, dot)
  let rest = keypath.substr(dot + 1, (keypath.length - dot - 1))

  // Look up one step of the keypath and recurse for the rest
  return getKeypath(obj[first], rest)
}

// Set the value in the given object of the given keypath to the given value. Creates any missing intermediate objects.
function setKeypath(obj, keypath, value) {
  if (obj == undefined) {
    // Error! Can't set in nothing!
    throw new Error("Can't set " + keypath + " = " + value + " in undefined!")
  }

  if (keypath == '') {
    // Error! Can't set the thing itself!
    throw new Error("Can't set " + keypath + " = " + value + " in " + obj)
  }

  // Look for a delimiter
  var dot = keypath.indexOf('.')
  if (dot == -1) {
    // Just set here
    obj[keypath] = value
  } else {
    // Advance up one step of the keypath and recurse for the rest
    
    let first = keypath.substr(0, dot)
    let rest = keypath.substr(dot + 1, (keypath.length - dot - 1))

    if (obj[first] === undefined) {
      // Create any missing objects
      obj[first] = {}
    }

    // Go look for the place to stash the value
    return setKeypath(obj[first], rest, value)
  }
}

// The actual Datasource class. External interface.
class Datasource extends EventEmitter2 {
  // Construct a Datasource using the specified base path for fetching contracts. 
  constructor(basePath) {
    super()

    // Save the base path
    this.basePath = basePath

    // Set up some fields for the generators 
    this.MacroverseStarGenerator = undefined
    this.MacroverseSystemGenerator = undefined

    // Set up the stack of keypaths we are going to request.
    // It is OK if things go on the stack multiple times because we will just see later that we got them earlier.
    this.stack = []

    // Set up an in-memory cache of the expanded objects for the keypaths
    this.memCache = {}

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
        this.MacroverseStarGenerator = await eth.get_instance(this.getContractPath('MacroverseStarGenerator'))

        // And the generator for planets (which fills in some more star properties relevant for planets)
        this.MacroverseSystemGenerator = await eth.get_instance(this.getContractPath('MacroverseSystemGenerator'))
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

  // Put in a request for a keypath.
  // Valid keypath formats include
  //
  // <x>.<y>.<z>.objectCount (the only sector property)
  // <x>.<y>.<z>.<objectNumber> to get a whole star record (without planets)
  // <x>.<y>.<z>.<objectNumber>.<propertyName>
  // Object (star) properties include:
  // seed, x, y, z, objClass, objType, objMass, luminosity, hasPlanets, planetCount, habitableZone (which has start, end, realStart, realEnd)
  // <x>.<y>.<z>.<objectNumber>.<planetNumber> to get a whole planet record (without moons)
  // <x>.<y>.<z>.<objectNumber>.<planetNumber>.<propertyName>
  // Planet properties include seed, planetClass, planetMass, orbit (which has a bunch of its own properties), and moon stuff  
  // <x>.<y>.<z>.<objectNumber>.<planetNumber>.<moonNumber> to get a whole moon record
  // <x>.<y>.<z>.<objectNumber>.<palnetNumber>.<moonNumber>.<propertyName>
  // Moon properties are the same as planet properties
  //
  // Returns a promise that resolves with the value when it eventually comes in.
  // The request will be retried until it succeeds, so don't go asking for things that don't exist.
  //
  request(keypath) {
    // Just dump it into the stack.
    // TODO: It would be more debuggable to vet it here
    this.stack.push(keypath)

    console.log('Looking for ' + keypath)

    // Set up a promise for when the result comes in
    let promise = new Promise((resolve, reject) => {
      this.once(keypath, resolve)
    })

    if (this.stack.length == 1) {
      // We just made the stack non-empty, so kcick off processing it
    
      // Schedule the waiting tasks to be handled
      timers.setImmediate(() => {
        this.processStack()
      })
    }

    return promise
  }

  // Worker function which processes the top thing on the stack each call through.
  async processStack() {
    if (this.stack.length == 0) {
      return
    }

    let keypath = this.stack.pop()

    console.log('Stack top: ' + keypath)

    // See if we have it already
    let found = getKeypath(this.memCache, keypath)

    if (found === undefined) {
      // We have to go get it

      console.log('Actually retrieving ' + keypath + ' which is not in cache')
      console.log(this.memCache)

      // We will put it in here
      var value;

      // Parse out the parts
      let parts = keypath.split('.')

      if (parts.length < 4) {
        // We need at least the sector position and the star number/property
        throw new Error("Invalid keypath: " + keypath)
      }

      // Sector x (required)
      let x = parts[0]
      // Sector y (required)
      let y = parts[1]
      // Sector z (required)
      let z = parts[2]

      if (isNaN(parts[3])) {
        // If the next part is a property, go get it
        let property = parts.slice(3).join('.')
        try {
          value = await this.getSectorProperty(x, y, z, parts[3])
        } catch (err) {
          // If it doesn't come in, try again
          console.log(err)
          value = undefined
          this.stack.push(keypath)
        }
      } else {
        // Otherwise it's a star number
        let star = parts[3]

        if (parts.length < 4) {
          // If that's it, go get the whole star
          // TODO: Enqueue all the features of a star
        } else {
          if (isNaN(parts[4])) {
            // Otherwise, if it's a property, get it
            let property = parts.slice(4).join('.')
            try {
              // If the next part is a property, go get it
              value = await this.getStarProperty(x, y, z, star, property)
            } catch (err) {
              // If it doesn't come in, try again
              console.log(err)
              value = undefined
              this.stack.push(keypath)
            }
          } else {
            // Otherwise, it is a planet number
            let planet = parts[4]
            
            if(parts.length < 5) {
              // If that's it, get the whole planet
              // TODO: Enqueue all the features of a planet
            } else {
              if (isNaN(parts[5])) {
                // Otherwise, if it's a property, get it
                let property = parts.slice(5).join('.')
                try {
                  // If the next part is a property, go get it
                  value = await this.getPlanetProperty(x, y, z, star, planet, property)
                } catch (err) {
                  // If it doesn't come in, try again
                  console.log(err)
                  value = undefined
                  this.stack.push(keypath)
                }
              } else {
                // Otherwise, if it's a number, it's a moon number

                // TODO: moons
                throw new Error("Moons not supported")
              }
            }
          }
        }
      }

      if (value === undefined) {
        // We had an error and couldn't get the value
        this.stack.push(keypath)
      }

      // Otherwise, we got it
      // It will already have been sent out

    } else {
      // It was cached. Send it out again, because someone asked for it.
      console.log('Retrieved cached ' + keypath)
      this.publishKeypath(keypath, found)
    }

    // Whether we got it or not, kick off another tick
    timers.setImmediate(() => {
      this.processStack()
    })
  }

  // Record that the given keypath has been resolved with the given value in the cache.
  // Dispatch the keypath events
  async publishKeypath(keypath, value) {
    console.log('Cache ' + keypath)
    // Store the value in the cache
    setKeypath(this.memCache, keypath, value)
    // Emit the value to anyone listening for it
    this.emit(keypath, value)
  }

  // Get the given property of the sector from the blockchain.
  // Save it and any properties retrieved at the same time in the cache.
  // Return the property's value.
  async getSectorProperty(x, y, z, keypath) {
    console.log('Get property ' + keypath + ' of sector ' + x + ', ' + y + ', ' + z)
    switch(keypath) {
    case 'objectCount':
      let value = (await this.MacroverseStarGenerator.getSectorObjectCount.call(x, y, z)).toNumber()
      await this.saveSectorProperty(x, y, z, keypath, value)
      return value
    default:
      throw new Error('Unknown property: ' + keypath);
    }
  }

  // Save and dispatch events for the given property of the given sector
  async saveSectorProperty(x, y, z, keypath, value) {
    await this.publishKeypath(x + '.' + y + '.' + z + '.' + keypath, value)
  }

  // '' keypath = whole star
  async getStarProperty(x, y, z, starNumber, keypath) {
  }

  // '' keypath = whole planet
  async getPlanetProperty(x, y, z, starNumber, planetNumber, keypath) {
  }


}

// Async factory method for users to get a Datasource. Actually exported.
// Needs to know where to find the smart contracts.
async function get_datasource(basePath) {
  let source = new Datasource(basePath)
  await source.init()
  return source
}

module.exports = get_datasource

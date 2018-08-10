// Datasource.js: defines a cacheing, keypath-based interface to the Macroverse smart contracts.
// Users send queries in with .request(keypath).
// They can get responses with .on().
// Replies will be sent as events named by the keypath, with the value being the value requested.

// Load up the facade over web3 and truffle-contract
const eth = require('./eth.js')

// And the cache implementations
const StarCache = require('./StarCache.js')
const PlanetCache = require('./PlanetCache.js')

// And the keypath manipulatioin code
const {getKeypath, setKeypath, lastComponent} = require('./keypath.js')

// And the event emitter which we use to structure our API
const { EventEmitter2 } = require('eventemitter2')

// And the timers module which we use to defer our queue processing
const timers = require('timers')

const mv = require('macroverse')

// The actual Datasource class. External interface.
class Datasource extends EventEmitter2 {
  // Construct a Datasource using the specified base path for fetching contracts. 
  constructor(basePath) {
    super()

    // Save the base path
    this.basePath = basePath

    // Set up some fields for the generators 
    this.star = undefined
    this.sys = undefined

    // Set up the stack of keypaths we are going to request.
    // It is OK if things go on the stack multiple times because we will just see later that we got them earlier.
    this.stack = []

    // Is the stack being processed?
    this.running = false

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
        this.star = await eth.get_instance(this.getContractPath('MacroverseStarGenerator'))

        // And the generator for planets (which fills in some more star properties relevant for planets)
        this.sys = await eth.get_instance(this.getContractPath('MacroverseSystemGenerator'))
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


    // Set up a promise for when the result comes in
    let promise = new Promise((resolve, reject) => {
      this.once(keypath, (value) => {
        resolve(value)
      })
    })

    if (!this.running) {
      // We just disturbed a sleeping Datasource, so start processing stuff
      
      this.running = true

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
      this.running = false
      return
    }

    console.log('Stack of ' + this.stack.length + ' things')

    // What should we go get?
    let keypath = this.stack.pop()

    // Do the top thing on the stack, and get the value it produces
    let value = await this.resolveImmediately(keypath)
    // Note that it may call resolveImmediately to get keys it depends on

    // Emit the event for it.
    // Don't emit events for everything it caches.
    this.publishKeypath(keypath, value)

    // Check again for things on the stack
    timers.setImmediate(() => {
      this.processStack()
    })

  }

  // Resolve a particular keypath without queueing.
  // Returns a promise for its value.
  // Called as part of the processStack() loop.
  // But also called to retrieve dependency keys.
  async resolveImmediately(keypath) {
    
    // We will fill this in with the value when we get it
    var value = undefined;

    // See if we have it already in the first level of cache
    var found = getKeypath(this.memCache, keypath)

    if (found === undefined || found === null) {
        // Try the second level of cache
        found = JSON.parse(window.localStorage.getItem(keypath))
    }

    if (found === undefined || found === null || (typeof found == 'object' && found.constructor.name != 'BigNumber')) {
      // It's not found or it is an object (and we don't know that we have all the sub-keypaths).
      // We have to go get it

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
          console.log('Error getting ' + keypath, err)
          value = await this.resolveImmediately(keypath)
        }
      } else {
        // Otherwise it's a star number
        let star = parts[3]

        if (parts.length < 4) {
          // If that's it, go get the whole star
          value = await this.getStarProperty(x, y, z, star, '')
        } else {
          if (isNaN(parts[4])) {
            // Otherwise, if it's a property, get it
            let property = parts.slice(4).join('.')
            try {
              // If the next part is a property, go get it
              value = await this.getStarProperty(x, y, z, star, property)
            } catch (err) {
              // If it doesn't come in, try again
              console.log('Error getting ' + keypath, err)
              throw err
              //value = await this.resolveImmediately(keypath)
            }
          } else {
            // Otherwise, it is a planet number
            let planet = parts[4]
            
            if(parts.length < 5) {
              // If that's it, get the whole planet
              await this.getPlanetProperty(x, y, z, star, planet, '')
            } else {
              if (isNaN(parts[5])) {
                // Otherwise, if it's a property, get it
                let property = parts.slice(5).join('.')
                try {
                  // If the next part is a property, go get it
                  value = await this.getPlanetProperty(x, y, z, star, planet, property)
                } catch (err) {
                  // If it doesn't come in, try again
                  console.log('Error getting ' + keypath, err)
                  throw err
                  //value = await this.resolveImmediately(keypath)
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

    } else {
      // It was cached. Send it out again, because someone asked for it.
      value = found
    }

    // We pick up the value from the published message and send it to our caller.
    return value
  }

  // Record that the given keypath has been resolved with the given value in the cache.
  // Dispatch the keypath events
  async publishKeypath(keypath, value) {
    // Store the value in the cache
    setKeypath(this.memCache, keypath, value)

    if (value != null && (typeof value !== 'object' || value.constructor.name == 'BigNumber')) {
        // This isn't an internal node in the keypath tree. It is a real value to cache. Save it.
        // Note that BigNumber objects stringify as digit strings, which should be fine to hand back to web3, which is all we do with them.
        window.localStorage.setItem(keypath, JSON.stringify(value))
    }

    // Emit the value to anyone listening for it
    this.emit(keypath, value)
  }

  // Get the given property of the sector from the blockchain.
  // Save it and any properties retrieved at the same time in the cache.
  // Returns a promise for its value.
  async getSectorProperty(x, y, z, keypath) {
    switch(keypath) {
    case 'objectCount':
      let value = (await this.star.getSectorObjectCount.call(x, y, z)).toNumber()
      await this.saveSectorProperty(x, y, z, keypath, value)
      return value
      break
    default:
      throw new Error('Unknown property: ' + keypath);
    }
  }

  // Save and dispatch events for the given property of the given sector
  async saveSectorProperty(x, y, z, keypath, value) {
    await this.publishKeypath(x + '.' + y + '.' + z + '.' + keypath, value)
  }

  // Get the given property of the star from the blockchain.
  // Save it and any properties retrieved at the same time in the cache.
  // Returns a promise for its value
  // '' keypath = whole star
  async getStarProperty(x, y, z, starNumber, keypath) {
    
    // Lots of star properties depend on other ones
    let starKey = x + '.' + y + '.' + z + '.' + starNumber

    // Use this to save a property of the star
    let save = async (prop, value) => {
      await this.saveStarProperty(x, y, z, starNumber, prop, value)
    }

    // And this to get one
    let get = async (prop) => {
      return await this.resolveImmediately(starKey + '.' + prop)
    }

    // Star properties
    // seed, x, y, z, objClass, objType, realMass, objMass, realLuminosity, luminosity, hasPlanets, planetCount, habitableZone (which has start, end, realStart, realEnd)
    switch(keypath) {
    case '':
      {
        let value = {}
        for (let key of ['seed', 'x', 'y', 'z', 'objClass', 'objType', 'realMass', 'objMass',
          'realLuminosity', 'luminosity', 'hasPlanets', 'planetCount', 'habitableZone']) {
          // Go get and fill in all the properties
          value[key] = await get(key)
        }
        await save(keypath, value)
        return value
      }
      break
    case 'seed':
      {
        let value = await this.star.getSectorObjectSeed.call(x, y, z, starNumber)
        await save(keypath, value)
        return value
      }
      break
    case 'x':
    case 'y':
    case 'z':
      {
        // We need the seed for this.
        // So recursively resolve it if needed.
        let seed = await get('seed')
        let [ obj_x, obj_y, obj_z] = await this.star.getObjectPosition.call(seed)
        let position = {x: mv.fromReal(obj_x), y: mv.fromReal(obj_y), z: mv.fromReal(obj_z)}
        for (let prop in position) {
            await save(prop, position[prop])
        }
        return position[keypath]
      }
      break
    case 'objClass':
      {
        let seed = await get('seed')
        let value = (await this.star.getObjectClass.call(seed)).toNumber()
        await save(keypath, value)
        return value
      }
      break
    case 'objType':
      {
        let seed = await get('seed')
        let objClass = await get('objClass')
        let value = (await this.star.getObjectSpectralType.call(seed, objClass)).toNumber()
        await save(keypath, value)
        return value
      }
      break
    case 'hasPlanets':
      {
        let seed = await get('seed')
        let objClass = await get('objClass')
        let objType = await get('objType')
        let value = await this.star.getObjectHasPlanets.call(seed, objClass, objType)
        await save(keypath, value)
        return value
      }
      break
    case 'planetCount':
      {
        var value;
        if (await get('hasPlanets')) {
          let seed = await get('seed')
          let objClass = await get('objClass')
          let objType = await get('objType')
          value = (await this.sys.getObjectPlanetCount.call(seed, objClass, objType)).toNumber()
        } else {
          value = 0
        }
        await save(keypath, value)
        return value
      }
      break
    case 'realMass':
    case 'objMass':
      {
        let seed = await get('seed')
        let objClass = await get('objClass')
        let objType = await get('objType')
        let realMass = await this.star.getObjectMass.call(seed, objClass, objType)
        let objMass = mv.fromReal(realMass)
        await save('realMass', realMass)
        await save('objMass', objMass)
        let value = {realMass, objMass}[keypath]
        return value
      }
      break
    case 'realLuminosity':
    case 'luminosity':
      {
        let seed = await get('seed')
        let objClass = await get('objClass')
        let realMass = await get('realMass')
        let realLuminosity = await this.sys.getObjectLuminosity.call(seed, objClass, realMass)
        let luminosity = mv.fromReal(realLuminosity)
        await save('realLuminosity', realLuminosity)
        await save('luminosity', luminosity)
        let value = {realLuminosity, luminosity}[keypath]
        return value
      }
      break
    case 'habitableZone.realStart':
    case 'habitableZone.realEnd':
    case 'habitableZone.start':
    case 'habitableZone.end':
      {
        let realLuminosity = await get('realLuminosity')
        let [realHabStart, realHabEnd] = await this.sys.getObjectHabitableZone.call(realLuminosity)
        let start = mv.fromReal(realHabStart)
        let end = mv.fromReal(realHabEnd)
        await save('habitableZone.realStart', realHabStart)
        await save('habitableZone.realEnd', realHabEnd)
        await save('habitableZone.start', start)
        await save('habitableZone.end', end)
        let value = {'habitableZone.realStart': realHabStart, 'habitableZone.realEnd': realHabEnd,
          'habitableZone.start': start, 'habitableZone.end': end}[keypath]
        return value
      }
      break
    case 'habitableZone':
      {
        value = {}
        for (let key of ['realStart', 'realEnd', 'start', 'end']) {
          value[key] = await get('habitableZone.' + key)
        }
        await save(keypath, value)
        return value
      }
      break
    default:
      throw new Error('Unknown property: ' + keypath);
    }
    
  }

  // Save and dispatch events for the given property of the given star.
  // Using a keypath of '' indicates the whole star.
  async saveStarProperty(x, y, z, starNumber, keypath, value) {
    if (keypath == '') {
      // This is the whole star
      await this.publishKeypath(x + '.' + y + '.' + z + '.' + starNumber, value)
    } else {
      // This is a property
      await this.publishKeypath(x + '.' + y + '.' + z + '.' + starNumber + '.' + keypath, value)
    }
  }

  // Get the given property of the planet from the blockchain.
  // Save it and any properties retrieved at the same time in the cache.
  // Returns a promise for its value.
  // '' keypath = whole planet
  // Planet properties include seed, planetClass, planetMass, orbit (which has a bunch of its own properties),
  // periapsisIrradiance, apoapsisIrradiance, and moon stuff.
  // Orbit properties are: periapsis, apoapsis, clearance, lan, inclination, aop, meanAnomalyAtEpoch, semimajor, semiminor, period,
  // realPeriapsis, realApoapsis, realClearance, realLan, realInclination, realAop, realMeanAnomalyAtEpoch
  async getPlanetProperty(x, y, z, starNumber, planetNumber, keypath) {
    // Lots of planet properties depend on other ones
    let starKey = x + '.' + y + '.' + z + '.' + starNumber
    let planetKey = starKey + '.' + planetNumber

    // Use this to save a property of the planet
    let save = async (prop, value) => {
      await this.savePlanetProperty(x, y, z, starNumber, planetNumber, prop, value)
    }

    // And this to get one
    let get = async (prop) => {
      return await this.resolveImmediately(planetKey + '.' + prop)
    }

    // And this to get star properties
    let getStar = async (prop) => {
      return await this.resolveImmediately(starKey + '.' + prop)
    }

    switch(keypath) {
    case '':
      {
        let value = {}
        for (let key of ['seed', 'planetClass', 'planetMass', 'orbit', 'periapsisIrradiance', 'apoapsisIrradiance']) {
          // Go get and fill in all the properties
          value[key] = await get(key)
        }
        await save(keypath, value)
        return value
      }
      break
    case 'seed':
      {
        let starSeed = await getStar('seed')
        let value = await this.sys.getPlanetSeed.call(starSeed, planetNumber)
        await save(keypath, value)
        return value
      }
      break
    case 'planetClass':
      {
        let seed = await get('seed')
        let totalPlanets = await getStar('planetCount')
        let value = (await this.sys.getPlanetClass.call(seed, planetNumber, totalPlanets)).toNumber()
        await save(keypath, value)
        return value
      }
      break
    case 'realPlanetMass':
    case 'planetMass':
      {
        let seed = await get('seed')
        let planetClass = await get('planetClass')
        let realPlanetMass = await this.sys.getPlanetMass.call(seed, planetClass)
        let planetMass = mv.fromReal(realPlanetMass)
        await save('realPlanetMass', realPlanetMass)
        await save('planetMass', planetMass)
        return {realPlanetMass, planetMass}[keypath]
      }
      break
    case 'orbit':
      {
        let value = {}
        for (let key of ['periapsis', 'apoapsis', 'clearance', 'lan', 'inclination', 'aop', 'meanAnomalyAtEpoch',
          'semimajor', 'semiminor', 'period', 'realPeriapsis', 'realApoapsis', 'realClearance', 'realLan',
          'realInclination', 'realAop', 'realMeanAnomalyAtEpoch']) {
          // Go get and fill in all the properties
          value[key] = await get('orbit.' + key)
        }
        await save(keypath, value)
        return value
      }
      break
    case 'orbit.realPeriapsis':
    case 'orbit.periapsis':
    case 'orbit.realApoapsis':
    case 'orbit.apoapsis':
    case 'orbit.realClearance':
    case 'orbit.clearance':
      {
        let seed = await get('seed')
        let planetClass = await get('planetClass')
        // We need the clearance of the pervious planet, if there was one, or 0 otherwise
        let prevClearance = planetNumber == 0 ? 0 : await this.resolveImmediately(starKey + '.' + (planetNumber - 1) + '.orbit.realClearance')
        // And the habitable zone of the star
        let habStart = await getStar('habitableZone.realStart')
        let habEnd = await getStar('habitableZone.realEnd')
        let parts = await this.sys.getPlanetOrbitDimensions.call(habStart, habEnd, seed, planetClass, prevClearance)
        let partialOrbit = {'realPeriapsis': parts[0], 'realApoapsis': parts[1], 'realClearance': parts[2],
          'periapsis': mv.fromReal(parts[0]), 'apoapsis': mv.fromReal(parts[1]), 'clearance': mv.fromReal(parts[2])}
        for (let prop in partialOrbit) {
            await save('orbit.' + prop,  partialOrbit[prop])
        }
        return partialOrbit[lastComponent(keypath)]
      }
      break
    case 'orbit.realLan':
    case 'orbit.lan':
      {
        let seed = await get('seed')
        let realLan = await this.sys.getPlanetLan.call(seed)
        let lan = mv.fromReal(realLan)
        await save('orbit.realLan', realLan)
        await save('orbit.lan', lan)
        return {realLan, lan}[lastComponent(keypath)]
      }
      break
    case 'orbit.realInclination':
    case 'orbit.inclination':
      {
        let seed = await get('seed')
        let planetClass = await get('planetClass')
        let realInclination = await this.sys.getPlanetInclination.call(seed, planetClass)
        let inclination = mv.fromReal(realInclination)
        await save('orbit.realInclination', realInclination)
        await save('orbit.inclination', inclination)
        return {realInclination, inclination}[lastComponent(keypath)]
      }
      break
    case 'orbit.realAop':
    case 'orbit.aop':
      {
        let seed = await get('seed')
        let realAop = await this.sys.getPlanetAop.call(seed)
        let aop = mv.fromReal(realAop)
        await save('orbit.realAop', realAop)
        await save('orbit.aop', aop)
        return {realAop, aop}[lastComponent(keypath)]
      }
      break
    case 'orbit.realMeanAnomalyAtEpoch':
    case 'orbit.meanAnomalyAtEpoch':
      {
        let seed = await get('seed')
        let realMeanAnomalyAtEpoch = await this.sys.getPlanetMeanAnomalyAtEpoch.call(seed)
        let meanAnomalyAtEpoch = mv.fromReal(realMeanAnomalyAtEpoch)
        await save('orbit.realMeanAnomalyAtEpoch', realMeanAnomalyAtEpoch)
        await save('orbit.meanAnomalyAtEpoch', meanAnomalyAtEpoch)
        return {realMeanAnomalyAtEpoch, meanAnomalyAtEpoch}[lastComponent(keypath)]
      }
      break
    // Now some convenience floats we can ask for but which aren't essential
    case 'orbit.semimajor':
      {
        let apoapsis = await get('orbit.apoapsis')
        let periapsis = await get('orbit.periapsis')
        let value = (apoapsis + periapsis) / 2
        await save(keypath, value)
        return value
      }
      break
    case 'orbit.semiminor':
      {
        let apoapsis = await get('orbit.apoapsis')
        let periapsis = await get('orbit.periapsis')
        let value = Math.sqrt(apoapsis * periapsis)
        await save(keypath, value)
        return value
      }
      break
    case 'orbit.period':
      {
        let semimajor = await get('orbit.semimajor')
        let objMass = await getStar('objMass')
        let value = 2 * Math.PI * Math.sqrt(Math.pow(semimajor, 3) / (mv.G_PER_SOL * objMass))
        await save(keypath, value)
        return value
      }
      break
    case 'periapsisIrradiance':
      {
        let periapsis = await get('orbit.periapsis')
        let luminosity = await getStar('luminosity')
        let value = luminosity * mv.SOLAR_LUMINOSITY / (4 * Math.PI * Math.pow(periapsis, 2))
        await save(keypath, value)
        return value
      }
      break
    case 'apoapsisIrradiance':
      {
        let apoapsis = await get('orbit.apoapsis')
        let luminosity = await getStar('luminosity')
        let value = luminosity * mv.SOLAR_LUMINOSITY / (4 * Math.PI * Math.pow(apoapsis, 2))
        await save(keypath, value)
        return value
      }
      break
    default:
      throw new Error('Unknown property: ' + keypath);
    }
  }

  // Save and dispatch events for the given property of the given planet.
  // Using a keypath of '' indicates the whole planet.
  async savePlanetProperty(x, y, z, starNumber, planetNumber, keypath, value) {
    if (keypath == '') {
      await this.publishKeypath(x + '.' + y + '.' + z + '.' + starNumber + '.' + planetNumber, value)
    } else {
      await this.publishKeypath(x + '.' + y + '.' + z + '.' + starNumber + '.' + planetNumber + '.' + keypath, value)
    }
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

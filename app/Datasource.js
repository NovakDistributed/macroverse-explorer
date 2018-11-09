// Datasource.js: defines a cacheing, keypath-based interface to the Macroverse smart contracts.
// Users send queries in with .request(keypath).
// They can get responses with .on().
// Replies will be sent as events named by the keypath, with the value being the value requested.

// Load up the facade over web3 and truffle-contract
const eth = require('./eth.js')

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

    // EventEmitter has Strong Opinions on how many clients we ought to have.
    // Override them.
    // TODO: Are we actually leaking memory/listeners?
    this.setMaxListeners(100000)

    // Save the base path
    this.basePath = basePath

    // Set up some fields for the generators 
    this.star = undefined
    this.star_patch = undefined
    this.sys = undefined
    this.moon = undefined

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

        // Find the generator instances
        [this.star, this.star_patch, this.sys, this.moon] = await Promise.all([
          eth.get_instance(this.getContractPath('MacroverseStarGenerator')),
          eth.get_instance(this.getContractPath('MacroverseStarGeneratorPatch1')),
          eth.get_instance(this.getContractPath('MacroverseSystemGenerator')),
          eth.get_instance(this.getContractPath('MacroverseMoonGenerator'))
        ])
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

  // Get a promise that resolves the next time the given keypath is published.
  // If you want the return value of request(), you want this instead.
  // We do it this way so that the first time something comes in you get it,
  // whether you were the one who asked for it that time or not.
  // Does not actually fire a request.
  waitFor(keypath) {
    // Set up a promise for when the result comes in
    return new Promise((resolve, reject) => {
      this.once(keypath, (value) => {
        resolve(value)
      })
    })
  }

  // Main public entry point.
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
  // Planet properties include seed, planetClass, planetMass, orbit (which has a bunch of its own properties), moonCount, moonScale 
  // <x>.<y>.<z>.<objectNumber>.<planetNumber>.<moonNumber> to get a whole moon record
  // <x>.<y>.<z>.<objectNumber>.<palnetNumber>.<moonNumber>.<propertyName>
  // Moon properties are the same as planet properties
  //
  // Returns a promise for the value of the keypath.
  //
  // The request will be retried until it succeeds, so don't go asking for things that don't exist.
  //
  request(keypath) {
    
    let promise = this.waitFor(keypath)

    if (this.isCachedInMemory(keypath)) {
      // We have it in memory so skip the stack and publish the value
      this.resolveImmediately(keypath)
    }

    // Otherwise, we (may) need to wait for it

    // Just dump it into the stack.
    // TODO: It would be more debuggable to vet it here
    this.stack.push(keypath)

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

    while (this.stack.length > 0 && this.isCachedInMemory(this.stack[this.stack.length - 1])) {
      // While things on the stack are cached, resolve them.
      // This returns a promise but will finish immediately.
      this.resolveImmediately(this.stack.pop())
    }

    if (this.stack.length > 0) {
      // For the next thing we hit that isn't cached, resolve it.
      // This will take a while so we await.
      await this.resolveImmediately(this.stack.pop())
    }

    // Check again for things on the stack
    timers.setImmediate(() => {
      this.processStack()
    })

  }

  // Return true if the value of the given keypath is cached in memory,
  // or false if we have to go to local storage or the blockchain to get it.
  // Objects (like entire planets) always show as not cached, because we don't know we have all the parts.
  isCachedInMemory(keypath) {
    // See if we have it already in the first level of cache
    var found = getKeypath(this.memCache, keypath)

    if (found === undefined || found === null || (typeof found == 'object' && found.constructor.name != 'BigNumber')) {
      return false
    }
    return true
  }

  // Resolve a particular keypath without queueing.
  // Publish the result.
  // Return a promise that resolves with nothing when the result has been published.
  // Called as part of the processStack() loop.
  // But also called to retrieve dependency keys.
  async resolveImmediately(keypath) {

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
          await this.resolveSectorProperty(x, y, z, parts[3])
        } catch (err) {
          // If it doesn't come in, try again
          console.log('Error getting ' + keypath, err)
          await this.resolveImmediately(keypath)
        }
      } else {
        // Otherwise it's a star number
        let star = parts[3]

        if (parts.length < 4) {
          // If that's it, go get the whole star
          await this.resolveStarProperty(x, y, z, star, '')
        } else {
          if (isNaN(parts[4])) {
            // Otherwise, if it's a property, get it
            let property = parts.slice(4).join('.')
            try {
              // If the next part is a property, go get it
              await this.resolveStarProperty(x, y, z, star, property)
            } catch (err) {
              // If it doesn't come in, try again
              console.log('Error getting ' + keypath, err)
              throw err
              //await this.resolveImmediately(keypath)
            }
          } else {
            // Otherwise, it is a planet number
            let planet = parts[4]
            
            if(parts.length < 5) {
              // If that's it, get the whole planet
              await this.resolvePlanetProperty(x, y, z, star, planet, '')
            } else {
              if (isNaN(parts[5])) {
                // Otherwise, if it's a property, get it
                let property = parts.slice(5).join('.')
                try {
                  // If the next part is a property, go get it
                  await this.resolvePlanetProperty(x, y, z, star, planet, property)
                } catch (err) {
                  // If it doesn't come in, try again
                  console.log('Error getting ' + keypath, err)
                  throw err
                  //await this.resolveImmediately(keypath)
                }
              } else {
                // Otherwise, if it's a number, it's a moon number
                let moon = parts[5]

                if (parts.length < 6) {
                  // If that's it, get the whole moon
                  await this.resolveMoonProperty(x, y, z, star, planet, moon, '')
                } else {
                  if (isNaN(parts[6])) {
                    // Otherwise, if it's a property, get it
                    let property = parts.slice(6).join('.')
                    try {
                      // If the next part is a property, go get it
                      await this.resolveMoonProperty(x, y, z, star, planet, moon, property)
                    } catch (err) {
                      // If it doesn't come in, try again
                      console.log('Error getting ' + keypath, err)
                      throw err
                      //await this.resolveImmediately(keypath)
                    }
                  } else {
                    throw new Error("Moons have no children")
                  }
                }
              }
            }
          }
        }
      }

    } else {
      // We did find it in one of the caches
      this.publishKeypath(keypath, found)
    }
  }

  // Record that the given keypath has been resolved with the given value in the cache.
  // Dispatch the keypath events
  async publishKeypath(keypath, value) {
    if (!this.isCachedInMemory(keypath)) {
      // It's not already cached, so cache it here and in local storage (where we may have read it from...)
      setKeypath(this.memCache, keypath, value)

      if (value != null && (typeof value !== 'object' || value.constructor.name == 'BigNumber')) {
          // This isn't an internal node in the keypath tree. It is a real value to cache. Save it.
          // Note that BigNumber objects stringify as digit strings, which should be fine to hand back to web3, which is all we do with them.
          window.localStorage.setItem(keypath, JSON.stringify(value))
      }
    }

    // Emit the value to anyone listening for it
    this.emit(keypath, value)
  }

  // Load the given property of the sector from the blockchain.
  // Save it and any properties retrieved at the same time in the cache.
  // Publish its value.
  // Return a promise that resolves with nothing when done.
  async resolveSectorProperty(x, y, z, keypath) {
    switch(keypath) {
    case 'objectCount':
      let value = (await this.star.getSectorObjectCount.call(x, y, z)).toNumber()
      await this.saveSectorProperty(x, y, z, keypath, value)
      break
    default:
      throw new Error('Unknown property: ' + keypath);
    }
  }

  // Save and dispatch events for the given property of the given sector
  async saveSectorProperty(x, y, z, keypath, value) {
    await this.publishKeypath(x + '.' + y + '.' + z + '.' + keypath, value)
  }

  // Load the given property of the star from the blockchain.
  // Save it and any properties retrieved at the same time in the cache.
  // Publish its value.
  // Return a promise that resolves with nothing when done.
  // '' keypath = whole star
  async resolveStarProperty(x, y, z, starNumber, keypath) {
    
    // Lots of star properties depend on other ones
    let starKey = x + '.' + y + '.' + z + '.' + starNumber

    // Use this to save a property of the star
    let save = async (prop, value) => {
      await this.saveStarProperty(x, y, z, starNumber, prop, value)
    }

    // And this to get one
    let get = async (prop) => {
      let promise = this.waitFor(starKey + '.' + prop)
      await this.resolveImmediately(starKey + '.' + prop)
      return promise
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
      }
      break
    case 'seed':
      {
        let value = await this.star.getSectorObjectSeed.call(x, y, z, starNumber)
        await save(keypath, value)
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
      }
      break
    case 'objClass':
      {
        let seed = await get('seed')
        let value = (await this.star.getObjectClass.call(seed)).toNumber()
        await save(keypath, value)
      }
      break
    case 'objType':
      {
        let seed = await get('seed')
        let objClass = await get('objClass')
        let value = (await this.star.getObjectSpectralType.call(seed, objClass)).toNumber()
        await save(keypath, value)
      }
      break
    case 'hasPlanets':
      {
        let seed = await get('seed')
        let objClass = await get('objClass')
        let objType = await get('objType')
        let value = await this.star.getObjectHasPlanets.call(seed, objClass, objType)
        await save(keypath, value)
      }
      break
    case 'planetCount':
      {
        var value;
        if (await get('hasPlanets')) {
          let seed = await get('seed')
          let objClass = await get('objClass')
          let objType = await get('objType')
          value = (await this.star_patch.getObjectPlanetCount.call(seed, objClass, objType)).toNumber()
        } else {
          value = 0
        }
        await save(keypath, value)
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
      }
      break
    case 'realLuminosity':
    case 'luminosity':
      {
        let seed = await get('seed')
        let objClass = await get('objClass')
        let realMass = await get('realMass')
        let realLuminosity = await this.star_patch.getObjectLuminosity.call(seed, objClass, realMass)
        let luminosity = mv.fromReal(realLuminosity)
        await save('realLuminosity', realLuminosity)
        await save('luminosity', luminosity)
      }
      break
    case 'habitableZone.realStart':
    case 'habitableZone.realEnd':
    case 'habitableZone.start':
    case 'habitableZone.end':
      {
        let realLuminosity = await get('realLuminosity')
        let [realHabStart, realHabEnd] = await this.star_patch.getObjectHabitableZone.call(realLuminosity)
        let start = mv.fromReal(realHabStart)
        let end = mv.fromReal(realHabEnd)
        await save('habitableZone.realStart', realHabStart)
        await save('habitableZone.realEnd', realHabEnd)
        await save('habitableZone.start', start)
        await save('habitableZone.end', end)
      }
      break
    case 'habitableZone':
      {
        value = {}
        for (let key of ['realStart', 'realEnd', 'start', 'end']) {
          value[key] = await get('habitableZone.' + key)
        }
        await save(keypath, value)
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

  // Load the given property of the planet from the blockchain.
  // Save it and any properties retrieved at the same time in the cache.
  // Publish the property.
  // Return a promise that resolves with nothing after publication.
  // '' keypath = whole planet
  // Planet properties include seed, planetClass, planetMass, orbit (which has a bunch of its own properties),
  // periapsisIrradiance, apoapsisIrradiance, moonCount, moonScale, spin (which has its own properties)
  // Orbit properties are: periapsis, apoapsis, clearance, lan, inclination, aop, meanAnomalyAtEpoch, semimajor, semiminor, period,
  // realPeriapsis, realApoapsis, realClearance, realLan, realInclination, realAop, realMeanAnomalyAtEpoch
  // Spion properties are: isTidallyLocked, axisAngleZ, axisAngleX, rate (which we convert to rad/sec), period (in seconds)
  async resolvePlanetProperty(x, y, z, starNumber, planetNumber, keypath) {
    // Lots of planet properties depend on other ones
    let starKey = x + '.' + y + '.' + z + '.' + starNumber
    let planetKey = starKey + '.' + planetNumber

    // Use this to save a property of the planet
    let save = async (prop, value) => {
      await this.savePlanetProperty(x, y, z, starNumber, planetNumber, prop, value)
    }

    // And this to get one
    let get = async (prop) => {
      let promise = this.waitFor(planetKey + '.' + prop)
      await this.resolveImmediately(planetKey + '.' + prop)
      return promise
    }

    // And this to get star properties
    let getStar = async (prop) => {
      let promise = this.waitFor(starKey + '.' + prop)
      await this.resolveImmediately(starKey + '.' + prop)
      return promise
    }

    // And this for properties of the previous planet
    let getPrevPlanet = async (prop) => {
      let promise = this.waitFor(starKey + '.' + (planetNumber - 1) + '.' + prop)
      await this.resolveImmediately(starKey + '.' + (planetNumber - 1) + '.' + prop)
      return promise
    }

    switch(keypath) {
    case '':
      {
        let value = {}
        for (let key of ['seed', 'planetClass', 'planetMass', 'orbit', 'periapsisIrradiance', 'apoapsisIrradiance', 'moonCount', 'moonScale']) {
          // Go get and fill in all the properties
          value[key] = await get(key)
        }
        await save(keypath, value)
      }
      break
    case 'seed':
      {
        let starSeed = await getStar('seed')
        let value = await this.sys.getWorldSeed.call(starSeed, planetNumber)
        await save(keypath, value)
      }
      break
    case 'planetClass':
      {
        let seed = await get('seed')
        let totalPlanets = await getStar('planetCount')
        let value = (await this.sys.getPlanetClass.call(seed, planetNumber, totalPlanets)).toNumber()
        await save(keypath, value)
      }
      break
    case 'realPlanetMass':
    case 'planetMass':
      {
        let seed = await get('seed')
        let planetClass = await get('planetClass')
        let realPlanetMass = await this.sys.getWorldMass.call(seed, planetClass)
        let planetMass = mv.fromReal(realPlanetMass)
        await save('realPlanetMass', realPlanetMass)
        await save('planetMass', planetMass)
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
        let prevClearance = planetNumber == 0 ? 0 : await getPrevPlanet('orbit.realClearance')
        // And the habitable zone of the star
        let habStart = await getStar('habitableZone.realStart')
        let habEnd = await getStar('habitableZone.realEnd')
        let parts = await this.sys.getPlanetOrbitDimensions.call(habStart, habEnd, seed, planetClass, prevClearance)
        let partialOrbit = {'realPeriapsis': parts[0], 'realApoapsis': parts[1], 'realClearance': parts[2],
          'periapsis': mv.fromReal(parts[0]), 'apoapsis': mv.fromReal(parts[1]), 'clearance': mv.fromReal(parts[2])}
        for (let prop in partialOrbit) {
            await save('orbit.' + prop,  partialOrbit[prop])
        }
      }
      break
    case 'orbit.realLan':
    case 'orbit.lan':
      {
        let seed = await get('seed')
        let realLan = await this.sys.getWorldLan.call(seed)
        let lan = mv.fromReal(realLan)
        await save('orbit.realLan', realLan)
        await save('orbit.lan', lan)
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
      }
      break
    case 'orbit.realAop':
    case 'orbit.aop':
      {
        let seed = await get('seed')
        let realAop = await this.sys.getWorldAop.call(seed)
        let aop = mv.fromReal(realAop)
        await save('orbit.realAop', realAop)
        await save('orbit.aop', aop)
      }
      break
    case 'orbit.realMeanAnomalyAtEpoch':
    case 'orbit.meanAnomalyAtEpoch':
      {
        let seed = await get('seed')
        let realMeanAnomalyAtEpoch = await this.sys.getWorldMeanAnomalyAtEpoch.call(seed)
        let meanAnomalyAtEpoch = mv.fromReal(realMeanAnomalyAtEpoch)
        await save('orbit.realMeanAnomalyAtEpoch', realMeanAnomalyAtEpoch)
        await save('orbit.meanAnomalyAtEpoch', meanAnomalyAtEpoch)
      }
      break
    // Now some convenience floats we can ask for but which aren't essential
    case 'orbit.semimajor':
      {
        let apoapsis = await get('orbit.apoapsis')
        let periapsis = await get('orbit.periapsis')
        let value = (apoapsis + periapsis) / 2
        await save(keypath, value)
      }
      break
    case 'orbit.semiminor':
      {
        let apoapsis = await get('orbit.apoapsis')
        let periapsis = await get('orbit.periapsis')
        let value = Math.sqrt(apoapsis * periapsis)
        await save(keypath, value)
      }
      break
    case 'orbit.period':
      {
        let semimajor = await get('orbit.semimajor')
        let objMass = await getStar('objMass')
        let value = 2 * Math.PI * Math.sqrt(Math.pow(semimajor, 3) / (mv.G_PER_SOL * objMass))
        await save(keypath, value)
      }
      break
    case 'periapsisIrradiance':
      {
        let periapsis = await get('orbit.periapsis')
        let luminosity = await getStar('luminosity')
        let value = luminosity * mv.SOLAR_LUMINOSITY / (4 * Math.PI * Math.pow(periapsis, 2))
        await save(keypath, value)
      }
      break
    case 'apoapsisIrradiance':
      {
        let apoapsis = await get('orbit.apoapsis')
        let luminosity = await getStar('luminosity')
        let value = luminosity * mv.SOLAR_LUMINOSITY / (4 * Math.PI * Math.pow(apoapsis, 2))
        await save(keypath, value)
      }
      break
    case 'moonCount':
      {
        let seed = await get('seed')
        let planetClass = await get('planetClass')
        let value = (await this.moon.getPlanetMoonCount.call(seed, planetClass)).toNumber()
        await save(keypath, value)
      }
      break
    case 'realMoonScale':
    case 'moonScale':
      {
        let seed = await get('seed')
        let realPlanetMass = await get('realPlanetMass')
        let realMoonScale = await this.moon.getPlanetMoonScale.call(seed, realPlanetMass)
        let moonScale = mv.fromReal(realMoonScale)
        await save('realMoonScale', realMoonScale)
        await save('moonScale', moonScale)
      }
      break
    case 'spin':
      {
        let value = {}
        for (let key of ['isTidallyLocked', 'axisAngleX', 'axisAngleZ', 'rate', 'period']) {
          // Go get and fill in all the properties
          value[key] = await get('spin.' + key)
        }
        await save(keypath, value)
      }
      break
    case 'spin.isTidallyLocked':
      {
        let seed = await get('seed')
        let value = await this.sys.isTidallyLocked.call(seed, planetNumber)
        await save(keypath, value)
      }
      break
    case 'spin.axisAngleZ':
    case 'spin.axisAngleX':
      {
        let seed = await get('seed')
        let tidal_lock = await get('spin.isTidallyLocked')
        let axisAngleZ
        let axisAngleX
        if (tidal_lock) {
          // Rotation axis is normal to orbital plane
          axisAngleZ = 0
          axisAngleX = 0
        } else {
          let [realAxisAngleZ, realAxisAngleX] = await this.sys.getWorldZXAxisAngles(seed)
          axisAngleZ = mv.fromReal(realAxisAngleZ)
          axisAngleX = mv.fromReal(realAxisAngleX)
        }
        await save('spin.axisAngleZ', axisAngleZ)
        await save('spin.axisAngleX', axisAngleX)
      }
      break
    case 'spin.rate':
    case 'spin.period':
      {
        let tidal_lock = await get('spin.isTidallyLocked')
        let spinRate
        if (tidal_lock) {
          // Rotation rate is exactly 2 * PI radians / period
          // TODO: Use the orbital mechanics contract instead which on-chain apps will use?
          spinRate = 2 * Math.PI / await get('orbit.period')
        } else {
          let seed = await get('seed')
          // Pull out and convert to rad/sec
          spinRate = mv.fromReal(await this.sys.getWorldSpinRate(seed)) / mv.JULIAN_YEAR
        }
        await save('spin.rate', spinRate)
        await save('spin.period', 2 * Math.PI / spinRate)
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

  // Load the given property of the moon from the blockchain.
  // Save it and any properties retrieved at the same time in the cache.
  // Publish the property.
  // Return a promise that resolves with nothing after publication.
  // '' keypath = whole moon
  // Moon properties include seed, planetClass, planetMass, orbit (which has a bunch of its own properties),
  // periapsisIrradiance, apoapsisIrradiance (which are computed based on moon min and max sun distance)
  // Orbit properties are: periapsis, apoapsis, clearance, lan, inclination, aop, meanAnomalyAtEpoch, semimajor, semiminor, period,
  // realPeriapsis, realApoapsis, realClearance, realLan, realInclination, realAop, realMeanAnomalyAtEpoch
  // Orbit is around the parent planet.
  async resolveMoonProperty(x, y, z, starNumber, planetNumber, moonNumber, keypath) {
    // Lots of planet properties depend on other ones
    let starKey = x + '.' + y + '.' + z + '.' + starNumber
    let planetKey = starKey + '.' + planetNumber
    let moonKey = planetKey + '.' + moonNumber

    // Use this to save a property of the moon
    let save = async (prop, value) => {
      await this.saveMoonProperty(x, y, z, starNumber, planetNumber, moonNumber, prop, value)
    }

    // And this to get one
    let get = async (prop) => {
      let promise = this.waitFor(moonKey + '.' + prop)
      await this.resolveImmediately(moonKey + '.' + prop)
      return promise
    }

    // And this to get star properties
    let getStar = async (prop) => {
      let promise = this.waitFor(starKey + '.' + prop)
      await this.resolveImmediately(starKey + '.' + prop)
      return promise
    }

    // And this to get parent planet properties
    let getPlanet = async (prop) => {
      let promise = this.waitFor(planetKey + '.' + prop)
      await this.resolveImmediately(planetKey + '.' + prop)
      return promise
    }

    // And this for properties of the previous planet
    let getPrevMoon = async (prop) => {
      let prevKeypath = planetKey + '.' + (moonNumber - 1) + '.' + prop
      let promise = this.waitFor(prevKeypath)
      await this.resolveImmediately(prevKeypath)
      return promise
    }

    // TODO: We end up replicating a bunch of the switch logic from planets. Is there a way to unify it?
    switch(keypath) {
    case '':
      {
        let value = {}
        for (let key of ['seed', 'planetClass', 'planetMass', 'orbit', 'periapsisIrradiance', 'apoapsisIrradiance']) {
          // Go get and fill in all the properties
          value[key] = await get(key)
        }
        await save(keypath, value)
      }
      break
    case 'seed':
      {
        let planetSeed = await getPlanet('seed')
        let value = await this.sys.getWorldSeed.call(planetSeed, moonNumber)
        await save(keypath, value)
      }
      break
    case 'planetClass':
      {
        let parentClass = await getPlanet('planetClass')
        let seed = await get('seed')
        let value = (await this.moon.getMoonClass.call(parentClass, seed, moonNumber)).toNumber()
        await save(keypath, value)
      }
      break
    case 'realPlanetMass':
    case 'planetMass':
      {
        let seed = await get('seed')
        let planetClass = await get('planetClass')
        let realPlanetMass = await this.sys.getWorldMass.call(seed, planetClass)
        let planetMass = mv.fromReal(realPlanetMass)
        await save('realPlanetMass', realPlanetMass)
        await save('planetMass', planetMass)
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
        // We need the clearance of the pervious moon, if there was one, or 0 otherwise
        let prevClearance = moonNumber == 0 ? 0 : await getPrevMoon('orbit.realClearance')
        // We need the moon scale for the paret planet
        let realMoonScale = await getPlanet('realMoonScale')
        
        let parts = await this.moon.getMoonOrbitDimensions.call(realMoonScale, seed, planetClass, prevClearance)
        let partialOrbit = {'realPeriapsis': parts[0], 'realApoapsis': parts[1], 'realClearance': parts[2],
          'periapsis': mv.fromReal(parts[0]), 'apoapsis': mv.fromReal(parts[1]), 'clearance': mv.fromReal(parts[2])}
        for (let prop in partialOrbit) {
            await save('orbit.' + prop,  partialOrbit[prop])
        }
      }
      break
    case 'orbit.realLan':
    case 'orbit.lan':
      {
        let seed = await get('seed')
        let realLan = await this.sys.getWorldLan.call(seed)
        let lan = mv.fromReal(realLan)
        await save('orbit.realLan', realLan)
        await save('orbit.lan', lan)
      }
      break
    case 'orbit.realInclination':
    case 'orbit.inclination':
      {
        let seed = await get('seed')
        let planetClass = await get('planetClass')
        let realInclination = await this.moon.getMoonInclination.call(seed, planetClass)
        let inclination = mv.fromReal(realInclination)
        await save('orbit.realInclination', realInclination)
        await save('orbit.inclination', inclination)
      }
      break
    case 'orbit.realAop':
    case 'orbit.aop':
      {
        let seed = await get('seed')
        let realAop = await this.sys.getWorldAop.call(seed)
        let aop = mv.fromReal(realAop)
        await save('orbit.realAop', realAop)
        await save('orbit.aop', aop)
      }
      break
    case 'orbit.realMeanAnomalyAtEpoch':
    case 'orbit.meanAnomalyAtEpoch':
      {
        let seed = await get('seed')
        let realMeanAnomalyAtEpoch = await this.sys.getWorldMeanAnomalyAtEpoch.call(seed)
        let meanAnomalyAtEpoch = mv.fromReal(realMeanAnomalyAtEpoch)
        await save('orbit.realMeanAnomalyAtEpoch', realMeanAnomalyAtEpoch)
        await save('orbit.meanAnomalyAtEpoch', meanAnomalyAtEpoch)
      }
      break
    // Now some convenience floats we can ask for but which aren't essential
    case 'orbit.semimajor':
      {
        let apoapsis = await get('orbit.apoapsis')
        let periapsis = await get('orbit.periapsis')
        let value = (apoapsis + periapsis) / 2
        await save(keypath, value)
      }
      break
    case 'orbit.semiminor':
      {
        let apoapsis = await get('orbit.apoapsis')
        let periapsis = await get('orbit.periapsis')
        let value = Math.sqrt(apoapsis * periapsis)
        await save(keypath, value)
      }
      break
    case 'orbit.period':
      {
        let semimajor = await get('orbit.semimajor')
        let planetMass = await getPlanet('planetMass')
        // Make sure we convert to solar masses for the orbit math because that's what G is in
        let value = 2 * Math.PI * Math.sqrt(Math.pow(semimajor, 3) / (mv.G_PER_SOL * planetMass / mv.EARTH_MASSES_PER_SOLAR_MASS))
        await save(keypath, value)
      }
      break
    case 'periapsisIrradiance':
      {
        let apoapsis = await get('orbit.apoapsis')
        let parentPeriapsis = await getPlanet('orbit.periapsis')
        let luminosity = await getStar('luminosity')
        let value = luminosity * mv.SOLAR_LUMINOSITY / (4 * Math.PI * Math.pow(parentPeriapsis - apoapsis, 2))
        await save(keypath, value)
      }
      break
    case 'apoapsisIrradiance':
      {
        let apoapsis = await get('orbit.apoapsis')
        let parentApoapsis = await getPlanet('orbit.apoapsis')
        let luminosity = await getStar('luminosity')
        let value = luminosity * mv.SOLAR_LUMINOSITY / (4 * Math.PI * Math.pow(parentApoapsis + apoapsis, 2))
        await save(keypath, value)
      }
      break
    default:
      throw new Error('Unknown property: ' + keypath);
    }
  }

  // Save and dispatch events for the given property of the given moon.
  // Using a keypath of '' indicates the whole moon.
  async saveMoonProperty(x, y, z, starNumber, planetNumber, moonNumber, keypath, value) {
    if (keypath == '') {
      await this.publishKeypath(x + '.' + y + '.' + z + '.' + starNumber + '.' + planetNumber + '.' + moonNumber, value)
    } else {
      await this.publishKeypath(x + '.' + y + '.' + z + '.' + starNumber + '.' + planetNumber + '.' + moonNumber + '.' + keypath, value)
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

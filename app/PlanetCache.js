// PlanetCache.js: cacheing layer over the MacroverseSystemGenerator


// Pull in all the robustness tools
const { timeoutPromise, hammer, InFlightLimiter, MAX_WAIT_TIME } = require('./robust.js')

const mv = require('macroverse')

// Represents a cache over the MacroverseSystemGenerator.
// Internally handles retry logic to read from the blockchain.
class PlanetCache {
  // Construct a cache in front of a TruffleContract for the MacroverseSystemGenerator
  constructor(MacroverseSystemGeneratorInstance) {
    // Save a reference to the backing MacroverseSystemGenerator
    this.generator = MacroverseSystemGeneratorInstance
    
    // Maps from string paths to object
    this.cache = {}

    // Limits simultaneous object downloads
    this.queue = new InFlightLimiter(5)
  }
  
  // Get the given planet around the given stellar object, from either the blockchain or the cache.
  async getPlanet(obj, planetNumber) {
    // Make a string path for the planet
    let path = obj.seed + '/' + planetNumber
    
    if (!this.cache.hasOwnProperty(path)) {
      // We don't have it, so queue up a job to go get it, and come back when it is got.

      // But because orbits are generated inside to outside, we need to make
      // sure we have the next-innermost planet before we get into the queue.
      // Because our request for it needs to finish before we start.
      let previousPlanet = null
      if (planetNumber > 0) {
        previousPlanet = await this.getPlanet(obj, planetNumber - 1)
      }

      if (!this.cache.hasOwnProperty(path)) {
        // It still hasn't shown up

        this.cache[path] = this.queue.queue(async () => { 
          // OK it is our turn to try and get the planet we want
          console.log('Trying to load planet ' + path)

          // Make a new object
          let planet = {number: planetNumber}
          
          for (let tryNumber = 0; tryNumber < 10; tryNumber++) {
            
            try {
              // Work out the seed
              planet.seed = await timeoutPromise(this.generator.getPlanetSeed.call(obj.seed, planetNumber))

              // Get the total planets in the system
              let totalPlanets = await this.getObjectPlanetCount(obj)
              
              // Determine the class of the planet based on its rank in the system
              planet.planetClass = (await timeoutPromise(this.generator.getPlanetClass.call(planet.seed, planet.number, totalPlanets))).toNumber()
              
              // Then determine its mass
              planet.planetMass = mv.fromReal(await timeoutPromise(this.generator.getPlanetMass.call(planet.seed, planet.planetClass)))

              // Set up its orbit
              planet.orbit = {}

              // What is the previous clearance band extent?
              // Use the stored bignum if there was a previous planet, or 0 otherwise.
              let prevClearance = previousPlanet != null ? previousPlanet.orbit.realClearance : 0

              // Download the orbit as bignums in case we want to know exactly what the smart contract does with it
              planet.orbit.realPeriapsis = await timeoutPromise(this.generator.getPlanetPeriapsis.call(planet.seed, planet.planetClass, prevClearance))
              planet.orbit.realApoapsis = await timeoutPromise(this.generator.getPlanetApoapsis.call(planet.seed, planet.planetClass, planet.orbit.realPeriapsis))
              planet.orbit.realClearance = await timeoutPromise(this.generator.getPlanetClearance.call(planet.seed, planet.planetClass, planet.orbit.realApoapsis))

              planet.orbit.realLan = await timeoutPromise(this.generator.getPlanetLan.call(planet.seed))
              planet.orbit.realInclination = await timeoutPromise(this.generator.getPlanetInclination.call(planet.seed, planet.planetClass))
              planet.orbit.realAop = await timeoutPromise(this.generator.getPlanetAop.call(planet.seed))
              planet.orbit.realMeanAnomalyAtEpoch = await timeoutPromise(this.generator.getPlanetMeanAnomalyAtEpoch.call(planet.seed))

              // Provide float versions of all those reals for use in JS
              // Periapsis in meters from center of star
              planet.orbit.periapsis = mv.fromReal(planet.orbit.realPeriapsis)
              // Apoapsis in meters from center of star
              planet.orbit.apoapsis = mv.fromReal(planet.orbit.realApoapsis)
              // Cleared-out band in meters from center of star
              // Not a real orbital element, but used to generate the next orbit
              planet.orbit.clearance = mv.fromReal(planet.orbit.realClearance)
              // Longitude of the ascending node, in radians
              planet.orbit.lan = mv.fromReal(planet.orbit.realLan)
              // Inclination, in radians. Always positive, as negative would swap the nodes.
              planet.orbit.inclination = mv.fromReal(planet.orbit.realInclination)
              // Argument of periapsis, in radians.
              planet.orbit.aop = mv.fromReal(planet.orbit.realAop)
              // Mean anomaly at epoch, in radians.
              planet.orbit.meanAnomalyAtEpoch = mv.fromReal(planet.orbit.realMeanAnomalyAtEpoch)
              
              // Produce the generated planet in the cache
              console.log('Successfully loaded planet ' + path)
              return planet
              
            } catch (err) {
              // Ignore errors (probably lost RPC requests) and retry from the beginning
              // TODO: retry each query!
              console.log('Retrying planet ' + path + ' try ' + tryNumber + ' after error: ', err)
            }
          }

          // If we get here without returning we ran out of tries
          throw new Error('Unable to load ' + path + ' from Ethereum blockchain. Check your RPC node!')

        })

        // Get the actual promise result
        let result = undefined;
        try {
          result = await this.cache[path]
        } finally {
          // If the promise rejected, the above will throw.
          // Clear out the promise so we can try again
          delete this.cache[path]
        }
        // We got a result. Save it so we don't try to await the same promise a lot.
        this.cache[path] = result
      }
    }
    
    // Now we know the planet or a promise for it is in the cache.
    // Return it either way. 
    return this.cache[path]
  }
  
  // Given an object representing a star/black hole/whatever, from a StarCache, get the number of planets it has.
  async getObjectPlanetCount(obj) {
    // Make a string path for just the object
    let path = obj.seed
    if (!this.cache.hasOwnProperty(path)) {
      // If we haven't counted the planets, go do it.
      if (!obj.hasPlanets) {
        // We already know there are no planets
        this.cache[path] = 0
      } else {
        let bignum = await this.queue.queue(async () => { 
          return hammer(() => {
            return this.generator.getObjectPlanetCount.call(obj.seed, obj.objClass, obj.objType)
          })
        })

        this.cache[path] = bignum.toNumber()
      }
    }
    return this.cache[path]
  }
  
}

module.exports = PlanetCache

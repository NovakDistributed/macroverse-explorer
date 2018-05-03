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
  
  // Get the given object from the given sector, from either the blockchain or the cache.
  async getObject(sectorX, sectorY, sectorZ, objectNumber) {
    // Make a string path for the object
    let path = sectorX + ',' + sectorY + ',' + sectorZ + '/' + objectNumber
    
    if (!this.cache.hasOwnProperty(path)) {
      // We don't have it, so queue up a job to go get it, and come back when it is got.
      await this.queue.queue(async () => { 
        // OK it is our turn to try and get it
        if (this.cache.hasOwnProperty(path)) {
          // Someone else got it while we were waiting
          return
        }

        console.log('Trying to load star ' + path)

        // Make a new object
        let obj = {number: objectNumber, sectorX, sectorY, sectorZ}
        
        for (let tryNumber = 0; tryNumber < 10; tryNumber++) {
          
          try {
            // Work out the seed
            obj.seed = await timeoutPromise(this.generator.getSectorObjectSeed.call(sectorX, sectorY, sectorZ, objectNumber))
            
            // Decide on a position
            let [ x, y, z] = await timeoutPromise(this.generator.getObjectPosition.call(obj.seed))
            obj.x = mv.fromReal(x)
            obj.y = mv.fromReal(y)
            obj.z = mv.fromReal(z)
            
            obj.objClass = (await timeoutPromise(this.generator.getObjectClass.call(obj.seed))).toNumber()
            obj.objType = (await timeoutPromise(this.generator.getObjectSpectralType.call(obj.seed, obj.objClass))).toNumber()
            
            obj.hasPlanets = await timeoutPromise(this.generator.getObjectHasPlanets.call(obj.seed, obj.objClass, obj.objType))
            
            obj.objMass = mv.fromReal(await timeoutPromise(this.generator.getObjectMass.call(obj.seed, obj.objClass, obj.objType)))
            
            // Save it
            this.cache[path] = obj
            console.log('Successfully loaded star ' + path)
            break
            
          } catch (err) {
            // Ignore errors (probably lost RPC requests) and retry from the beginning
            // TODO: retry each query!
            console.log('Retrying star ' + path + ' try ' + tryNumber + ' after error: ', err)
          }
        }
      })
    }
    
    // When we get here, our load job has waited in the queue and then run. Or it wasn't necessary.

    if (!this.cache.hasOwnProperty(path)) {
      throw new Error('Unable to load ' + path + ' from Ethereum blockchain. Check your RPC node!')
    }
    
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

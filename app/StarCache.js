// StarCache.js: cacheing layer over the MacroverseStarGenerator


// Pull in all the robustness tools
const { timeoutPromise, hammer, rateLimit, MAX_WAIT_TIME } = require('./robust.js')

const mv = require('macroverse')

// Represents a cache over the MacroverseStarGenerator.
// Internally handles retry logic to read from the blockchain.
class StarCache {
  // Construct a cache in front of a TruffleContract for the MacroverseStarGenerator
  constructor(MacroverseStarGeneratorInstance) {
    // Save a reference to the backing MacroverseStarGenerator
    this.generator = MacroverseStarGeneratorInstance
    
    // Maps from string paths to object
    this.cache = {}
  }
  
  // Get the given object from the given sector, from either the blockchain or the cache.
  async getObject(sectorX, sectorY, sectorZ, objectNumber) {
    // Make a string path for the object
    let path = sectorX + ',' + sectorY + ',' + sectorZ + '/' + objectNumber
    
    if (!this.cache.hasOwnProperty(path)) {
      
      // Make a new object
      let obj = {number: objectNumber, sectorX, sectorY, sectorZ}
      
      for (let tryNumber = 0; tryNumber < 10; tryNumber++) {
        
        try {
          // Work out the seed
          obj.seed = await rateLimit(() => { return timeoutPromise(this.generator.getSectorObjectSeed.call(sectorX, sectorY, sectorZ, objectNumber)) })
          
          // Decide on a position
          let [ x, y, z] = await rateLimit(() => { return timeoutPromise(this.generator.getObjectPosition.call(obj.seed)) })
          obj.x = mv.fromReal(x)
          obj.y = mv.fromReal(y)
          obj.z = mv.fromReal(z)
          
          obj.objClass = (await rateLimit(() => { return timeoutPromise(this.generator.getObjectClass.call(obj.seed)) })).toNumber()
          obj.objType = (await rateLimit(() => { return timeoutPromise(this.generator.getObjectSpectralType.call(obj.seed, obj.objClass)) })).toNumber()
          
          obj.hasPlanets = await rateLimit(() => { return timeoutPromise(this.generator.getObjectHasPlanets.call(obj.seed, obj.objClass, obj.objType)) })
          
          obj.objMass = mv.fromReal(await rateLimit(() => { return timeoutPromise(this.generator.getObjectMass.call(obj.seed, obj.objClass, obj.objType)) }))
          
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
    }
    
    if (!this.cache.hasOwnProperty(path)) {
      throw new Error('Unable to load ' + path + ' from Ethereum blockchain. Check your RPC node!')
    }
    
    return this.cache[path]
  }
  
  async getObjectCount(sectorX, sectorY, sectorZ) {
    // Make a string path for just the sector
    let path = sectorX + ',' + sectorY + ',' + sectorZ
    if (!this.cache.hasOwnProperty(path)) {
      // If we haven't counted the stars in the sector yet, go do it.
      this.cache[path] = (await rateLimit(() => { return hammer(() => {
        return this.generator.getSectorObjectCount.call(sectorX, sectorY, sectorZ)
      }) })).toNumber()
    }
    return this.cache[path]
  }
  
}

module.exports = StarCache

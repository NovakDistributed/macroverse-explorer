// StarCache.js: cacheing layer over the MacroverseStarGenerator


// Pull in all the robustness tools
const { timeoutPromise, hammer, InFlightLimiter, MAX_WAIT_TIME } = require('./robust.js')

const mv = require('macroverse')

// Represents a cache over the MacroverseStarGenerator.
// Internally handles retry logic to read from the blockchain.
class StarCache {
  // Construct a cache in front of a TruffleContract for the MacroverseStarGenerator
  constructor(MacroverseStarGeneratorInstance) {
    // Save a reference to the backing MacroverseStarGenerator
    this.generator = MacroverseStarGeneratorInstance
    
    // Maps from string paths to object, or promise for object
    this.cache = {}

    // Limits simultaneous object downloads
    this.limiter = new InFlightLimiter(5)
  }
  
  // Get the given object from the given sector, from either the blockchain or the cache.
  async getObject(sectorX, sectorY, sectorZ, objectNumber) {
    // Make a string path for the object
    let path = sectorX + ',' + sectorY + ',' + sectorZ + '/' + objectNumber
    
    if (!this.cache.hasOwnProperty(path)) {
      let fromLocalStorage = window.localStorage.getItem(path)

      if (fromLocalStorage != undefined) {
        // We had it in local storage, so use that.
        this.cache[path] = new Promise((resolve, reject) => {
          setTimeout(() => {
            // Asynchronously load from local storage.
            // Breaks up loading all the stars in a sector to not all happen at once.
            resolve(JSON.parse(fromLocalStorage))
          }, 0)
        })
      } else {

        // We don't have it, and nobody is getting it, so submit a job to go get it, and come back when it is got.
        this.cache[path] = this.limiter.submit(async () => { 
          // OK it is our turn to try and get it
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
              
              console.log('Successfully loaded star ' + path)
              return obj
              
            } catch (err) {
              // Ignore errors (probably lost RPC requests) and retry from the beginning
              // TODO: retry each query!
              console.log('Retrying star ' + path + ' try ' + tryNumber + ' after error: ', err)
            }
          }
          
          // If we get here without returning we ran out of tries
          throw new Error('Unable to load ' + path + ' from Ethereum blockchain. Check your RPC node!')
        })
      }

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
      
      if (fromLocalStorage == undefined) {
        try {
          // Commit to local storage (if not full)
          window.localStorage.setItem(path, JSON.stringify(this.cache[path]))
        } catch (e) {
          console.log('Skipping cacheing to local storage due to ' , e)
        }
      }
    }
    
    // We now know there is either a result or a promise for a result in the cache.
    // Return it, whatever it is.
    return this.cache[path]
  }
  
  async getObjectCount(sectorX, sectorY, sectorZ) {
    // Make a string path for just the sector
    let path = sectorX + ',' + sectorY + ',' + sectorZ
    if (!this.cache.hasOwnProperty(path)) {
      let fromLocalStorage = window.localStorage.getItem(path)

      if (fromLocalStorage != undefined) {
        this.cache[path] = JSON.parse(fromLocalStorage)
      } else {
        // If we haven't counted the stars in the sector yet, go do it.
        let bignum = await this.limiter.submit(async () => { 
          return hammer(() => {
            return this.generator.getSectorObjectCount.call(sectorX, sectorY, sectorZ)
          })
        })

        this.cache[path] = bignum.toNumber()

        try {
          // Commit to local storage (if not full)
          window.localStorage.setItem(path, JSON.stringify(this.cache[path]))
        } catch (e) {
          console.log('Skipping cacheing to local storage due to ' , e)
        }
      }
    }
    return this.cache[path]
  }
  
}

module.exports = StarCache

// robust.js: tools for retrying and timing out to work around flaky Ethereum nodes

const RateLimiter = require('limiter').RateLimiter

// How long should we wait for a promise when loading stars?
let MAX_WAIT_TIME = 10000

// Make a promise time out and reject in the given number of ms.
// time is optional and has a sensible default.
function timeoutPromise(time, promise) {
  if (promise === undefined) {
    // Actually time is the promise
    promise = time
    time = MAX_WAIT_TIME
  }

  return Promise.race([promise, new Promise(function(resolve, reject) {
    setTimeout(function() {
      reject('Timout!')
    }, time)
  })])
}

// Call the given closure repeatedly until it succeeds before timing out, or the max retries is reached.
// Return the result, or throw an error.
async function hammer(closure, retries = 10) {
  for (var retry = 0; retry < retries; retry++) {
    // Loop until success
    try {
      // Try the thing and wait for timeout
      let val = await timeoutPromise(MAX_WAIT_TIME, closure())
      return val
    } catch (err) {
      // If it times out or otherwise rejects
      if (retry + 1 == retries) {
        // We can't try again
        console.log('Hammer fail after error: ', err)
        throw err
      } else {
        // Otherwise we can try again, so do it.
        console.log('Hammer retry after error: ', err)
      }
      
    }
  }
}

const global_limiter = new RateLimiter(5, 'minute')
let reqNum = 0

// Run the given function and resolve with its return value, subject to the global rate limit
function rateLimit(callback) {
  let thisReqNum = reqNum++
  return new Promise((resolve, reject) => {
    global_limiter.removeTokens(1, () => {
      console.log('Make request ' + thisReqNum)
      resolve(callback())
    })
  })
}

module.exports = { timeoutPromise, hammer, rateLimit, MAX_WAIT_TIME }



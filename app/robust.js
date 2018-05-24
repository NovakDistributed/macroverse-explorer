// robust.js: tools for retrying and timing out to work around flaky Ethereum nodes

const RateLimiter = require('limiter').RateLimiter

const timers = require('timers')

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

// Allow no more than a certian number of passed callbacks to be running at a time.
// Converts callbacks to promises that resolve with their return values when they are evantually run.
// Processes requests LIFO so that new user requests coming in are serviced before stale attempts to
// load things the user has given up on. 
class InFlightLimiter {
  constructor(max_in_flight) {
    this.max_in_flight = max_in_flight
    
    // Stack of waiting tasks
    this.waiting = []

    // Set of running tasks
    this.running = new Set()
  }

  // Submit the given callback to be run when there is a free slot.
  // If the callback kicks off more async stuff it must return a promise so we can know when they are all done.
  submit(callback) {
    // Make a new promise
    let promise = new Promise((resolve, reject) => {
      // Save everything we need to actually finish it
      this.waiting.push({
        callback: callback,
        resolve: resolve,
        reject: reject
      })
    })

    // Schedule the waiting tasks to be handled
    timers.setImmediate(() => {
      this.handle_waiting()
    })

    return promise
  }

  // Asynchronously handle the waiting tasks.
  // Kicked off when something is submitted and when something finishes.
  // Tracks how many child promises are currently running.
  async handle_waiting() {
    if (this.running.size >= this.max_in_flight) {
      // Nothing to do!
      return
    }
    
    if (this.waiting.length == 0) {
      // Still nothing to do
      return
    }
    
    // Find a job to do (most recently added) and mark it running
    let to_run = this.waiting.pop()
    this.running.add(to_run)

    let callback_return = undefined;
    try {
      // Call the callback, and wait for it to run and for any promise it returned to resolve or reject
      callback_return = await to_run.callback()
    } catch(e) {
      // The error makes the promise for the result reject.
      to_run.reject(e)
    } finally {
      // Whether it succeeded or not, it is done now so something else can have its place
      this.running.delete(to_run)

      // Next tick, check for more work to do
      timers.setImmediate(() => {
        this.handle_waiting()
      })
    }

    // Now the promise is done
    to_run.resolve(callback_return)
  }

}

module.exports = { timeoutPromise, hammer, rateLimit, InFlightLimiter, MAX_WAIT_TIME }



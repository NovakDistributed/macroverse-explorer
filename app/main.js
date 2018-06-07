// main.js: main Javascript file for the Macroverse Explorer
// Handles setting up the Explorer and plugging the Ethereum stuff into the A-Frame stuff

// We will use A-Frame
const aframe = require('aframe')
// And orbit controls
const orbit_controls = require('aframe-orbit-controls-component-2')
// And particles
const particles = require('aframe-particle-system-component')

// We want macroverse itself
const mv = require('macroverse')

// Load all the other parts of the code
const Context = require('./Context.js')
const eth = require('./eth.js')
const {desynchronize} = require('./robust.js')
const sprites = require('./sprites.js')

// Make a promise that waits for the given number of ms and then resolves
function sleep(time) {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, time)
  })
}

let systemNonce = 0

// Show the planetary system of the given star object, using the given Macroverse context
async function showSystem(ctx, star) {
  // Figure out our place so we don't clobber later requests that finish earlier
  systemNonce++
  let ourNonce = systemNonce

   // Find the system display holding node
  let system = document.getElementById('system')
  while (system.firstChild) {
    // Clear out its existing children
    system.removeChild(system.firstChild)
  }

  // Start up the system loading throbber
  let loader = document.getElementById('system-loading')
  loader.setAttribute('visible', true)
  
  let planetCount = await ctx.planets.getObjectPlanetCount(star)
  console.log('Star ' + star.seed + ' has ' + planetCount + ' planets.')

  planetPromises = []
  for (let j = 0; j < planetCount; j++) {
    // Go get every planet
    planetPromises.push(ctx.planets.getPlanet(star, j))
  }

  let planets = await Promise.all(planetPromises)

  // Generate a system view

  // Make a root node
  let root = document.createElement('a-entity')

  // Make a sun sprite at 0,0,0
  let sun = sprites.starToSprite(star, false)
  root.appendChild(sun);

  // TODO: desynchronize() all this system construction to not be slow.

  for (let i = 0; i < planets.length; i++) {
    // Make a planet sprite that moves with the orbit
    let planetSprite = sprites.planetToSprite(planets[i], star)
    // Make an orbit line sprite
    let orbitSprite = sprites.orbitToSprite(planets[i].orbit)
    
    root.appendChild(planetSprite)
    root.appendChild(orbitSprite)
  }

  if (ourNonce == systemNonce) {
    // We won the race so display.
    // Put in our child we made.
    system.appendChild(root)
    // Loading is done
    loader.setAttribute('visible', false)
  }

}

let sectorNonce = 0

async function showSector(ctx, x, y, z) {
  // Figure out our place so we don't clobber later requests that finish earlier
  sectorNonce++
  let ourNonce = sectorNonce

  console.log('Show sector ' + x + ' ' + y + ' ' + z + ' nonce ' + ourNonce)

  // Find where we want to put things
  let sector = document.getElementById('sector')

  // Find the loading throbber
  let loader = document.getElementById('sector-loading')
  loader.setAttribute('visible', true)

  // Clear out the sector
  while (sector.hasChildNodes()) {
    sector.removeChild(sector.lastChild);
  }

  let starCount = await ctx.stars.getObjectCount(x, y, z)

  // We fill this with promises for making all the stars, which are running in parallel.
  let starPromises = []

  for (let i = 0; i < starCount; i++) {
    // For each star in the origin sector
    let starPromise = desynchronize(() => {
      // Kick off loading all the stars asynchronously, so we don;t try and make too many sprites in one tick.
      return ctx.stars.getObject(x, y, z, i).then((star) => {
        // For each star object, when we get it

        if (ourNonce != sectorNonce) {
          // We are stale!
          return
        }

        // Make a sprite that positions itself
        let sprite = sprites.starToSprite(star, true)

        sprite.addEventListener('click', async () => {
          // When the user clicks it, show that system.
          console.log('User clicked on star ' + i + ' with seed ' + star.seed)
          // Display the star's system in the system view.
          await showSystem(ctx, star)
        })

        if (ourNonce == sectorNonce) {
          // We are still the sector being drawn.
          // Display the sprite.
          sector.appendChild(sprite)
        }
      })
    })

    // Now we have a promise for this star's completion, so stick it in the array
    starPromises.push(starPromise)

  }

  // Now starPromises is populated, so we can wait on all of them
  await Promise.all(starPromises)
  if (ourNonce == sectorNonce) {
    console.log('All stars loaded for sector ' + x + ' ' + y + ' ' + z + ' nonce ' + ourNonce)
    // Hide the loader
    loader.setAttribute('visible', false)
  } else {
    console.log('Stale sector ' + x + ' ' + y + ' ' + z + ' nonce ' + ourNonce + ' is done')
  }
}

// Track the 3d cursor for the sector we are supposed to display, for panning
let curX = 0
let curY = 0
let curZ = 0

// Return a function that will pan the currenc cursor by the specified amount and kick of the display of the new sector.
// Basically an event handler factory.
function make_pan_handler(ctx, deltaX, deltaY, deltaZ) {
  return function() {
    curX += deltaX
    curY += deltaY
    curZ += deltaZ
    showSector(ctx, curX, curY, curZ)
  }
}

async function main() {

  console.log('Macroverse Explorer starting on Ethereum network ' + eth.get_network_id())
  console.log('Using account ' + eth.get_account())

  // Get ahold of a global Macroverse context.
  let ctx = await Context('contracts/')

  // Show the initial sector
  showSector(ctx, curX, curY, curZ)

  // Hook up pan handlers
  document.getElementById('x-plus').addEventListener('click', make_pan_handler(ctx, 1, 0, 0))
  document.getElementById('x-minus').addEventListener('click', make_pan_handler(ctx, -1, 0, 0))
  document.getElementById('y-plus').addEventListener('click', make_pan_handler(ctx, 0, 1, 0))
  document.getElementById('y-minus').addEventListener('click', make_pan_handler(ctx, 0, -1, 0))
  document.getElementById('z-plus').addEventListener('click', make_pan_handler(ctx, 0, 0, 1))
  document.getElementById('z-minus').addEventListener('click', make_pan_handler(ctx, 0, 0, -1))
  
  

}

// Actually run the entry point
main()

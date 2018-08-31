// main.js: main Javascript file for the Macroverse Explorer
// Handles setting up the Explorer and plugging the Ethereum stuff into the A-Frame stuff

// We will use A-Frame
const aframe = require('aframe')
// And orbit controls
const aframe_orbit_controls = require('aframe-orbit-controls-component-2')
// And particles
const aframe_particles = require('aframe-particle-system-component')
// And animations
const aframe_animation = require('aframe-animation-component')

// We want macroverse itself
const mv = require('macroverse')

// Load all the other parts of the code
const Context = require('./Context.js')
const eth = require('./eth.js')
const {desynchronize} = require('./robust.js')
const sprites = require('./sprites.js')
const Infobox = require('./Infobox.js')
const {parentOf} = require('./keypath.js')

/// Make a promise that waits for the given number of ms and then resolves
function sleep(time) {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, time)
  })
}

// Nonce for remembering which system was most recenty requested
let systemNonce = 0

/// Animate the camera's focus to the given position
function moveCameraFocus(position) {
  let dolly = document.getElementById('dolly')

  let oldPos = dolly.getAttribute('position');

  dolly.setAttribute('animation', {
    property: 'position',
    // We need to break up the position vectors since passing a real Vector3 to the animation component crashes it...
    from: {x: oldPos.x, y: oldPos.y, z: oldPos.z},
    to: {x: position.x, y: position.y, x: position.z},
    dur: 500
  })

}


/// Show the planetary system of the star with the given keypath, using the given Macroverse context.
async function showSystem(ctx, keypath) {
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

  // Focus the system view
  moveCameraFocus(system.getAttribute('position'))

  // Make a ScaleManager to let the planets tell each other how big the view scale should be
  let scaleManager = new sprites.ScaleManager()

  // Generate a system view

  // Make a root node
  let root = document.createElement('a-entity')

  // We want to displace the sun up for readability
  let SUN_LINE_HEIGHT = 3

  // Make a sun sprite, elevated above the center so as not to eat the planets
  let sun = sprites.makeStarSprite(ctx, keypath, false)
  root.appendChild(sun);
  sun.addEventListener('loaded', () => {
    sun.setAttribute('position', {x: 0, y: SUN_LINE_HEIGHT, z: 0})
  })

  // The sun shall go on a stick
  let stick = document.createElement('a-entity')
  root.appendChild(stick)
  stick.addEventListener('loaded', () => {
    // It shall be stick-shaped
    stick.setAttribute('geometry', {
      primitive: 'cylinder',
      radius: 0.001,
      height: SUN_LINE_HEIGHT
    })
    // And a white line
    stick.setAttribute('material', {
      color: 'white',
      wireframe: true,
      wireframeLinewidth: 1
    })
    // And it will connect the sun to the orbital plane
    stick.setAttribute('position', {x: 0, y: SUN_LINE_HEIGHT / 2, z: 0})
  })

  sun.addEventListener('click', () => {
    // Show the star when the star is clicked again.
    // TODO: won't this re-build everything?
    ctx.emit('show', keypath)
  })


  ctx.ds.request(keypath + '.planetCount').then((planetCount) => {
    // Once the planet count comes in we can do the planets
    if (ourNonce != systemNonce) {
      console.log('Display expired')
      return
    }

    console.log('Queue up ' + planetCount + ' planets')
    
    // Each planet should report a min and max orbit param. Until then scale so we can see the temp orbits.
    scaleManager.expect(planetCount * 2, 1, planetCount)

    for (let i = planetCount - 1; i >= 0; i--) {
      // Queue planets in reverse because later queries get answered frist

      // Make a planet sprite that moves with the orbit
      let planetSprite = sprites.makePlanetSprite(ctx, keypath + '.' + i, scaleManager)
      // Make an orbit line sprite
      let orbitSprite = sprites.makeOrbitSprite(ctx, keypath + '.' + i, scaleManager)
      
      root.appendChild(planetSprite)
      root.appendChild(orbitSprite)

      let clickHandler = () => {
        // When clicked, show planet 
        ctx.emit('show', keypath + '.' + i)
      }

      planetSprite.addEventListener('click', clickHandler)
      orbitSprite.addEventListener('click', clickHandler)
    }

    console.log('Made ' + planetCount + ' planets')

    // Hide the loader because we have initial sprites out
    loader.setAttribute('visible', false)

  })
  
  // Put in our child we made.
  system.appendChild(root)
}

// Nonce for remembering which sector was most recently requested
let sectorNonce = 0

/// Display the sector with the given coordinates.
/// Uses the given context for talking to Macroverse and for moving to other places.
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

  // Focus the sector
  moveCameraFocus(sector.getAttribute('position'))

  // Go get the sector object count via the new Datasource interface
  let sectorPath = x + '.' + y + '.' + z


  var starCount = ctx.ds.waitFor(sectorPath + '.objectCount')
  ctx.ds.request(sectorPath + '.objectCount')
  starCount = await starCount

  if (ourNonce != sectorNonce) {
    // Don't queue stars up on top of sector data requests for later sectors.
    return
  }

  // We fill this with promises for making all the stars, which are running in parallel.
  let starPromises = []

  for (let i = 0; i < starCount; i++) {
    // For each star in the origin sector

    let starPromise = new Promise((resolve, reject) => {

      // Make a sprite that positions itself
      let sprite = sprites.makeStarSprite(ctx, sectorPath + '.' + i, true)

      sprite.addEventListener('loaded', () => {
        // When the star sprite is out, say it is ready.
        // The sprite may still update with more info later
        resolve()
      })

      sprite.addEventListener('click', async () => {
        // When the user clicks it, show that system.
        console.log('User clicked on star ' + i)
        // Display the star's system
        ctx.emit('show', sectorPath + '.' + i)
      })

      if (ourNonce == sectorNonce) {
        // We are still the sector being drawn.
        // Display the sprite.
        sector.appendChild(sprite)
      }
    })

    starPromises.push(starPromise)

  }

  // Now starPromises is populated, so we can wait on all of them
  await Promise.all(starPromises)
  if (ourNonce == sectorNonce) {
    console.log('All stars loading for sector ' + x + ' ' + y + ' ' + z + ' nonce ' + ourNonce)
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

/// Return a function that will pan the currenc cursor by the specified amount and kick of the display of the new sector.
/// Basically an event handler factory.
function make_pan_handler(ctx, deltaX, deltaY, deltaZ) {
  return function() {
    curX += deltaX
    curY += deltaY
    curZ += deltaZ
    ctx.emit('show', curX + '.' + curY + '.' + curZ)
  }
}

/// Return a promise that fulfills when the page finishes downloading.
/// Only works if called *before* DOM content has loaded.
function waitForDom() {
  return new Promise((resolve, reject) => {
    try {
      // Wait for the DOMContentLoaded event
      document.addEventListener('DOMContentLoaded', (ev) => {
        // And when it happens resolve
        resolve()
      })
    } catch (e) {
      // Problems!
      reject(e)
    }
  })
}

/// Main entry point
async function main() {

  console.log('Macroverse Explorer initializing...')
  // We need to run this script *before* the dom sets up so the A-Frame elements can be handled properly.
  // But we want to wait for the DOM to actually exist before we start tinkering about with the page itself.
  await waitForDom()

  console.log('Starting on Ethereum network ' + eth.get_network_id())
  console.log('Using account ' + eth.get_account())

  // Get ahold of a global Macroverse context.
  let ctx = await Context('contracts/')

  // Make an infobox object with access to the data source
  // It will look up values for whatever we tell it to display
  let infoboxElement = document.getElementById('infobox')
  let infobox = new Infobox(infoboxElement, ctx)

  ctx.ds.onAny((event_name, event_arg) => {
    //console.log('Published ' + event_name)
  })

  // Hook up an event listener to show things in the 3d view
  ctx.on('show', (keypath) => {
    console.log('Event to move to ' + keypath)
    let parts = keypath.split('.')

    if (parts.length == 3) {
      // We want a sector. Pass along the context.
      showSector(ctx, parts[0], parts[1], parts[2])
    } else if (parts.length == 4) {
      // This is a star
      showSystem(ctx, keypath) 
    }
    // Otherwise it's a planet and we don't move.
  })


  // Hook up pan handlers
  document.getElementById('x-plus').addEventListener('click', make_pan_handler(ctx, 1, 0, 0))
  document.getElementById('x-minus').addEventListener('click', make_pan_handler(ctx, -1, 0, 0))
  document.getElementById('y-plus').addEventListener('click', make_pan_handler(ctx, 0, 1, 0))
  document.getElementById('y-minus').addEventListener('click', make_pan_handler(ctx, 0, -1, 0))
  document.getElementById('z-plus').addEventListener('click', make_pan_handler(ctx, 0, 0, 1))
  document.getElementById('z-minus').addEventListener('click', make_pan_handler(ctx, 0, 0, -1))

  // Show the initial sector
  ctx.emit('show', curX + '.' + curY + '.' + curZ)
  
}

// Actually run the entry point
main()

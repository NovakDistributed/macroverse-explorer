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
// And a follow constraint to make the camera chase things
require('./aframe-follow-constraint.js')

// We want macroverse itself
const mv = require('macroverse')

// Load all the other parts of the code
const Context = require('./Context.js')
const eth = require('./eth.js')
const {desynchronize} = require('./robust.js')
const sprites = require('./sprites.js')
const Infobox = require('./Infobox.js')
const {parentOf, keypathToId} = require('./keypath.js')
const dialog = require('./dialog.js')

/// Make a promise that waits for the given number of ms and then resolves
function sleep(time) {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, time)
  })
}

// Nonce for remembering which system was most recenty requested
let systemNonce = 0
// And for the moons of which planet
let moonNonce = 0

let nextCameraTargetId = 0

/// Animate the camera's focus to the given position or HTML element
function moveCameraFocus(position) {
  let dolly = document.getElementById('dolly')

  let oldPos = dolly.getAttribute('position')

  if (position instanceof HTMLElement) {
    let followElement = position

    if (!followElement.id) {
      // Assign an id
      followElement.id = 'camera-target' + nextCameraTargetId++
    }

    // Make a following constraint to follow the target around
    dolly.setAttribute('follow-constraint', {
      target: '#' + followElement.id
    })
  } else {

    // De-parent
    dolly.removeAttribute('follow-constraint')

    dolly.setAttribute('animation', {
      property: 'position',
      // We need to break up the position vectors since passing a real Vector3 to the animation component crashes it...
      from: {x: oldPos.x, y: oldPos.y, z: oldPos.z},
      to: {x: position.x, y: position.y, z: position.z},
      dur: 500
    })
  }

}

/// Show the given moon, using the given Macroverse context
/// Assumes the planet has been shown already
async function showMoon(ctx, keypath) {

  // Find the moon we are looking for
  let moonSprite = document.getElementById(keypathToId(keypath))

  // Chase the planet with the camera
  moveCameraFocus(moonSprite)

}

/// Show the given planet, using the given Macroverse context
/// Assumes the system has been shown already
async function showPlanet(ctx, keypath) {

  moonNonce++
  let ourNonce = moonNonce
  let ourSystemNonce = systemNonce

  // Find the node we are going to parent the lunar system to
  let planetSprite = document.getElementById(keypathToId(keypath))

  // Find the loader
  let loader = document.getElementById('system-loading')
  loader.setAttribute('visible', true)

  // Chase the planet with the camera
  moveCameraFocus(planetSprite)

  // Start making the lunar system
  
  // Clear out any existing lunar system
  let oldSystem = document.getElementById('lunar-system')
  if (oldSystem) {
    oldSystem.parentNode.removeChild(oldSystem)
  }

  // Make a root node
  let root = document.createElement('a-entity')
  root.id = 'lunar-system'

  // Place it
  planetSprite.appendChild(root)

  // TODO: rotate it to match planet's equatorial plane

  // Get the planet's mass, which determinses size
  let worldMass = await ctx.ds.request(keypath + '.worldMass')
  // Work out the actual size for it
  let size = sprites.worldMassToSize(worldMass)

  // Make a ScaleManager to let the moons tell each other how big the view scale should be
  // Give it the desired inner and outer orbit sizes in 3d engine units
  // Note that the scale manager and orbits still work natively in AU
  // ScaleManager will give priority to the min scale.
  let scaleManager = new sprites.ScaleManager(size + 0.3, 5)

  // Count up the moons
  let moonCount = await ctx.ds.request(keypath + '.moonCount')

  // Track how many have been fully created
  let completedMoons = 0
  // And have a function to call when a moon is complete.
  let completeMoon = function() {
    completedMoons++
    if (completedMoons == moonCount && ourNonce == moonNonce && ourSystemNonce == systemNonce) {
      // We are the current system and we are done!
      loader.setAttribute('visible', false)
    }
  }
  if (completedMoons == moonCount && ourNonce == moonNonce && ourSystemNonce == systemNonce) {
    // We are the current system and we are done already!
      loader.setAttribute('visible', false)
  }

  // Each moon should report a min and max orbit param.
  // Until then scale so we can see the temp orbits, which will be on the order of 1 LD in AU probably.
  scaleManager.expect(moonCount * 2, mv.LD / mv.AU, (moonCount + 1) * mv.LD / mv.AU)

  for (let i = moonCount - 1; i >= 0; i--) {
    // Queue moons in reverse because later queries get answered first

    // Ask for the whole moon. When we get it, we know we have everything for the moon.
    // When enough of these come in, loading is done.
    ctx.ds.request(keypath + '.' + i).then((wholeMoon) => {
      completeMoon()
    })

    // Make a single orbit object so both sprites have a consistent view of the current orbit
    let orbit = {}

    // Make a moon sprite that moves with the orbit
    // This is also responsible for reporting in to the ScaleManager about the orbit
    let moonSprite = sprites.makePlanetSprite(ctx, keypath + '.' + i, scaleManager, orbit)
    // Make an orbit line sprite
    let orbitSprite = sprites.makeOrbitSprite(ctx, keypath + '.' + i, scaleManager, orbit)

    root.appendChild(moonSprite)
    root.appendChild(orbitSprite)

    let clickHandler = () => {
      // When clicked, show moon
      console.log('Focus on ' + keypath + '.' + i)
      ctx.emit('show', keypath + '.' + i)
    }

    for (let clickable of moonSprite.getElementsByClassName('world')) {
      // Let all the actual moon parts of the moon sprite be clickable
      clickable.addEventListener('click', clickHandler)
    }
    orbitSprite.addEventListener('click', clickHandler)
  }

  console.log('Made ' + moonCount + ' moons')
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
      shader: 'flat',
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

  let planetsPromise = ctx.ds.request(keypath + '.planetCount').then((planetCount) => {
    // Once the planet count comes in we can do the planets
    if (ourNonce != systemNonce) {
      console.log('Display expired')
      return
    }

    console.log('Queue up ' + planetCount + ' planets')

    // Track how many have been fully created
    let completedPlanets = 0
    // And have a function to call when a planet is complete.
    let completePlanet = function() {
      completedPlanets++
      if (completedPlanets == planetCount && ourNonce == systemNonce) {
        // We are the current system and we are done!
        loader.setAttribute('visible', false)
      }
    }
    if (completedPlanets == planetCount && ourNonce == systemNonce) {
      // We are the current system and we are done already
      loader.setAttribute('visible', false)
    }

    // Make a ScaleManager to let the planets tell each other how big the view scale should be
    // We want the output between 1 and 100 units
    let scaleManager = new sprites.ScaleManager(1, 100)
    
    // Each planet should report a min and max orbit param, on top of the habitable zone.
    // Until then scale so we can see the temp orbits.
    // We won't do the habitable zone if there are no planets, so don't wait for it
    scaleManager.expect(planetCount * 2 + (planetCount > 0 ? 2 : 0), 1, planetCount + 1)

    for (let i = planetCount - 1; i >= 0; i--) {
      // Queue planets in reverse because later queries get answered first

      // Ask for the whole planet. When we get it, we know we have everything for the planet.
      // When enough of these come in, loading is done.
      ctx.ds.request(keypath + '.' + i).then((wholePlanet) => {
        completePlanet()
      })

      // Make a single orbit object so both sprites have a consistent view of the current orbit
      let orbit = {}

      // Make a planet sprite that moves with the orbit
      let planetSprite = sprites.makePlanetSprite(ctx, keypath + '.' + i, scaleManager, orbit)
      // Make an orbit line sprite
      let orbitSprite = sprites.makeOrbitSprite(ctx, keypath + '.' + i, scaleManager, orbit)
      
      root.appendChild(planetSprite)
      root.appendChild(orbitSprite)

      let clickHandler = () => {
        // When clicked, show planet 
        ctx.emit('show', keypath + '.' + i)
      }
      
      // We want to be able to click on the actual planet but not things parented to it
      for (let clickable of planetSprite.getElementsByClassName('world')) {
        clickable.addEventListener('click', clickHandler)
      }
      orbitSprite.addEventListener('click', clickHandler)
    }

    if (planetCount > 0) {
      // Also show the habitable zone.
      let habZone = sprites.makeHabitableZoneSprite(ctx, keypath, scaleManager)
      root.appendChild(habZone)
    }

    console.log('Made ' + planetCount + ' planets')
  })
  
  // Put in our child we made.
  system.appendChild(root)

  // Don't resolve until the sprites are out.
  await planetsPromise
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

  // Clear the system
  systemNonce++
  let system = document.getElementById('system')
  while (system.firstChild) {
    // Clear out its existing children
    system.removeChild(system.firstChild)
  }

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
let curX = null
let curY = null
let curZ = null

/// Return a function that will pan the currenc cursor by the specified amount and kick of the display of the new sector.
/// Basically an event handler factory.
function make_pan_handler(ctx, deltaX, deltaY, deltaZ) {
  return function() {
    ctx.emit('show', (curX + deltaX) + '.' + (curY + deltaY) + '.' + (curZ + deltaZ))
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
  let ctx = await Context('contracts')

  console.log("Using star generator: " + ctx.ds.star.address)
  console.log("Using system generator: " + ctx.ds.sys.address)
  console.log("Using registry: " + ctx.reg.reg.address)

  // Make an infobox object with access to the data source
  // It will look up values for whatever we tell it to display
  let infoboxElement = document.getElementById('infobox')
  let infobox = new Infobox(infoboxElement, ctx)

  ctx.ds.onAny((event_name, event_arg) => {
    //console.log('Published ' + event_name)
  })

  let lastShownKeypath = null

  let showNonce = 0

  // Hook up an event listener to show things in the 3d view
  ctx.on('show', async (keypath) => {
    console.log('Event to move to ' + keypath)
    showNonce++
    let ourNonce = showNonce

    document.title = 'Macroverse Explorer: ' + keypath

    // Register this as a navigation if we moved
    console.log(keypath + ' vs ' + location.hash.substr(1))
    if (keypath != location.hash.substr(1)) {
      window.history.pushState(null, document.title, location.pathname + '#' + keypath)
    }

    let parts = keypath.split('.')

    // How many of those parts are unchanged from the last thing we tried to show?
    let matches = 0

    if (lastShownKeypath !== null) {
      let oldParts = lastShownKeypath.split('.')
      // Count up how many of the keypaht parts are the same until the first mismatch
      for (let i = 0; i < Math.min(parts.length, oldParts.length) && parts[i] == oldParts[i]; i++) {
        matches++;
      }
    }

    // Save the old sector
    let oldX = curX
    let oldY = curY
    let oldZ = curZ

    // Make sure panning happens from here
    curX = parseInt(parts[0])
    curY = parseInt(parts[1])
    curZ = parseInt(parts[2])

    if (oldX != curX || oldY != curY || oldZ != curZ || parts.length == 3) {
      // We changed sectors, or backed up to the sector view, so show the sector first
      showSector(ctx, parts[0], parts[1], parts[2])
    }

    if (parts.length == 4) {
      // This is a star. Show it.
      if (matches < 4 && ourNonce == showNonce) {
        await showSystem(ctx, keypath)
      }
      if (matches == 4 && ourNonce == showNonce) {
        // Just focus on it
        moveCameraFocus(document.getElementById('system'))
      }
    } else if (parts.length == 5) {
      // It must be a planet
      if (matches < 4 && ourNonce == showNonce) {
        // Planet depends on system
        await showSystem(ctx, parentOf(keypath))
      }
      if (matches < 5 && ourNonce == showNonce) {
        await showPlanet(ctx, keypath)
      }
      if (matches == 5 && ourNonce == showNonce) {
        // Just focus on it
        moveCameraFocus(document.getElementById(keypathToId(keypath)))
      }
    } else if (parts.length == 6) {
      // It must be a moon
      if (matches < 4 && ourNonce == showNonce) {
        // Planet depends on system
        await showSystem(ctx, parentOf(parentOf(keypath)))
      }
      if (matches < 5 && ourNonce == showNonce) {
        await showPlanet(ctx, parentOf(keypath))
      }
      if (matches < 6 && ourNonce == showNonce) {
        await showMoon(ctx, keypath)
      }
      if (matches == 6 && ourNonce == showNonce) {
        // Just focus on it
        moveCameraFocus(document.getElementById(keypathToId(keypath)))
      }
    }

    lastShownKeypath = keypath
  })


  // Hook up pan handlers
  document.getElementById('x-plus').addEventListener('click', make_pan_handler(ctx, 1, 0, 0))
  document.getElementById('x-minus').addEventListener('click', make_pan_handler(ctx, -1, 0, 0))
  document.getElementById('y-plus').addEventListener('click', make_pan_handler(ctx, 0, 1, 0))
  document.getElementById('y-minus').addEventListener('click', make_pan_handler(ctx, 0, -1, 0))
  document.getElementById('z-plus').addEventListener('click', make_pan_handler(ctx, 0, 0, 1))
  document.getElementById('z-minus').addEventListener('click', make_pan_handler(ctx, 0, 0, -1))

  if (location.hash) {
    // On load we asked for a thing
    ctx.emit('show', location.hash.substr(1))
  } else {
    ctx.emit('show', 0 + '.' + 0 + '.' + 0)
  }

  // When the user edits the URL, respond
  window.onhashchange = () => {
    ctx.emit('show', location.hash.substr(1))
  }

  // Hook up the wallet open handler
  document.getElementById('wallet-tool').addEventListener('click', () => {
    ctx.wallet.showWalletDialog()
  })

  // Hook up the claim manager open handler
  document.getElementById('claims-tool').addEventListener('click', () => {
    ctx.wallet.showClaimsDialog()
  })
  
  // Expose context for debugging
  window.ctx = ctx
}

// Actually run the entry point
main()

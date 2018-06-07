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

// We want someone else's implementation of orbital mechanics
const orb = require('orbjs')

// Load all the other parts of the code
const Context = require('./Context.js')
const eth = require('./eth.js')
const {desynchronize} = require('./robust.js')

// See http://www.isthe.com/chongo/tech/astro/HR-temp-mass-table-byhrclass.html for a nice table, also accounting for object class (IV/III/etc.) and 0-9 subtype.
let typeToColor = {
  'TypeO': [144, 166, 255],
  'TypeB': [156, 179, 255],
  'TypeA': [179, 197, 255],
  'TypeF': [218, 224, 255],
  'TypeG': [255, 248, 245],
  'TypeK': [255, 225, 189],
  'TypeM': [255, 213, 160],
  'NotApplicable': [128, 128, 128]
}

// Convert an array of 0-255 values into a hex color code.
// It has to be hex because A-Frame particle systems only accept hex, not 'rgb()' notation
function arrayToColor(arr) {
  
  hex = '#'
  for (let item of arr) {
    if(item < 16) {
      hex += '0'
    }
    hex += item.toString(16)
  }
  return hex
}

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

  // Start upt he system loading throbber
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

  // Make a sun sprite
  let sun = starToSprite(star)
  sun.addEventListener('loaded', () => {
    // Drop the sun in the center of the root entity
    sun.setAttribute('position', {x: 0, y: 0, z: 0})
  })

  root.appendChild(sun);

  // TODO: desynchronize() all this system construction to not be slow.

  for (let i = 0; i < planets.length; i++) {
    let planetSprite = planetToSprite(planets[i])
    let orbitSprite = orbitToSprite(planets[i].orbit)
    
    // Compute orbit facts
    let periapsis = planets[i].orbit.periapsis / mv.AU
    let apoapsis = planets[i].orbit.apoapsis / mv.AU
    
    let update = () => {
      // Work out where the planet belongs at this time
      let planetPos = computeOrbitPositionInAU(planets[i].orbit, star.objMass, getRenderTime())
      // Put it there
      planetSprite.setAttribute('position', planetPos)
    }

    planetSprite.addEventListener('loaded', () => {
      update()
      let interval = setInterval(() => {
        if (planetSprite.parentNode != null) {
          // We are still visible

          update()
        } else {
          // Stop updating
          clearInterval(interval)
        }
      }, 20)
    })
    
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

// Given a planet object from the cache, return a DOM node for a sprite to represent the planet
function planetToSprite(planet) {
  // Make it a sprite
  let sprite = document.createElement('a-entity')

  sprite.addEventListener('loaded', () => {
    // TODO: Move this stuff to the macroverse module
    let planetClasses = ['Lunar', 'Terrestrial', 'Uranian', 'Jovian', 'AsteroidBelt']
    let planetColors = {
      'Lunar': 'white',
      'Terrestrial': 'blue',
      'Uranian': 'purple',
      'Jovian': 'orange',
      'AsteroidBelt': 'gray'
    }
    let planetColor = planetColors[planetClasses[planet.planetClass]]

    // And make it the right color
    sprite.setAttribute('material', {color: planetColor})

    // Work out the size for it
    let size = Math.pow(planet.planetMass, 1/4) / 2

    // Make the planet sphere
    sprite.setAttribute('geometry', {
      primitive: 'sphere',
      radius: size
    })
  })

  return sprite
}

// Mount the given node on a parent, translated by the given translation, and then rotate the parent by the given rotation.
// Returns the parent. Rotations are in degrees, to match A-Frame.
// Order of rotations is undefined if multiple axes are used at once.
function mountTranslateRotate(childNode, xTrans, yTrans, zTrans, xRot, yRot, zRot) {
  childNode.addEventListener('loaded', () => {
    // Position the child
    childNode.setAttribute('position', {x: xTrans, y: yTrans, z: zTrans})
  })

  // Make the parent
  let parentNode = document.createElement('a-entity')
  parentNode.addEventListener('loaded', () => {
    // And rotate it
    parentNode.setAttribute('rotation', {x: xRot, y: yRot, z: zRot})
  })

  parentNode.appendChild(childNode)

  return parentNode

}

// Given an orbit Javascript object, turn it into a sprite (probably a wireframe)
function orbitToSprite(orbit) {

  // Compute sizes in A-Frame units (AU for system display)
  let apoapsis = orbit.apoapsis / mv.AU
  let periapsis = orbit.periapsis / mv.AU

  // Semimajor is arithmetic mean
  let semimajor = (apoapsis + periapsis) / 2
  // Semiminor is geometric mean
  let semiminor = Math.sqrt(apoapsis * periapsis)

  // Make an elipse of the right shape radius in the XZ plane
  let circleNode = document.createElement('a-entity')
  circleNode.addEventListener('loaded', () => {
    // Make it a circle (actually a ring, since "circles" have center vertices.)
    circleNode.setAttribute('geometry', {
      primitive: 'ring',
      radiusInner: semiminor,
      radiusOuter: semiminor - 0.001
    })
    // Give it a color and stuff
    circleNode.setAttribute('material', {color: 'white', wireframe: true, wireframeLinewidth: 1})

    // Stretch it out in X to be the semimajor radius
    circleNode.setAttribute('scale', {x: semimajor/semiminor, y: 1, z: 1})

    // Then rotate it from the XY plane to the XZ plane
    circleNode.setAttribute('rotation', {x: -90, y: 0, z: 0})
  })

  // Work out how far we have to budge from the center of the elipse to the apoapsis/periapsis junction (focus)
  // This is the amount of distance the apoapsis steals over what it would have if it were the semimajor axis
  let budge = apoapsis - semimajor

  // Mount the elipse on another scene node so the little lobe (periapsis) is +X
  // (toward the right) from the origin (where the parent body goes) and rotate
  // that around Y by the AoP. We have to move towards -X.
  let mounted1 = mountTranslateRotate(circleNode, -budge, 0, 0, 0, mv.degrees(orbit.aop), 0) 

  // Then mount that and rotate it in X by the inclination
  let mounted2 = mountTranslateRotate(mounted1, 0, 0, 0, mv.degrees(orbit.inclination), 0, 0)

  // Then mount that and rotate it in Y by the LAN
  let mounted3 = mountTranslateRotate(mounted2, 0, 0, 0, 0, mv.degrees(orbit.lan))

  return mounted3
}

// Compute where a planet ought to be in Cartesian coordinates, at a given time.
// Takes mass in sols and time in seconds. Returns an {x:, y:, z: } object
// Used to animate the planet motion.
function computeOrbitPositionInAU(orbit, centralMassSols, secondsSinceEpoch) {

  // Correct the mass for use with orbjs

  // Macroverse uses G=132712875029098577920 m^3 s^-2 sols^-1
  // orbjs uses orb.constants.common.G = 6.67384e-11 m^3 kg^-1 s^-2
  // For these two numbers to be equal, how big is a solar mass in kg?
  // TODO: Move the Macroverse G constant into the Macroverse module!
  let sol = 132712875029098577920 / orb.constants.common.G

  // Compute semimajor axis (still in meters)
  let semimajor = (orbit.apoapsis + orbit.periapsis) / 2
  // And eccentricity
  let eccentricity = (orbit.apoapsis - orbit.periapsis) / (orbit.apoapsis + orbit.periapsis)

  // Compute position and velocity
  let [pos, vel] = orb.position.keplerian(semimajor, eccentricity, orbit.inclination, orbit.lan, orbit.aop,
    secondsSinceEpoch, 0, orbit.meanAnomalyAtEpoch, centralMassSols * sol)

  // Swap axes around to Minecraft-style Y-up (swap Y and Z, and negate Z)
  // Also convert from meters to AU
  return {x: pos[0] / mv.AU, y: pos[2] / mv.AU, z: -pos[1] / mv.AU}

}

// Return the time to draw right now, in seconds since epoch
function getRenderTime() {
  let unixTime = (new Date()).getTime() / 1000
  let macroverseTime = unixTime - mv.EPOCH
  // Add a super speed scaling factor
  return macroverseTime * 100000000
}

// Given a star object from the cache, return a DOM node for a sprite to represent the star
function starToSprite(star) {
  // Make it a sprite
  let sprite = document.createElement('a-entity')

  sprite.addEventListener('loaded', () => {
    // We can't actually use any of the A-Frame overrides for element setup until A-Frame calls us back

    // We also have to use objects instead of the strings we would use in
    // HTML, a-entity for everything instead of the convenient primitive
    // tags, and geometry/material instead of the shorthand color and so on
    // on the primitives.
    
    let starColor = arrayToColor(typeToColor[mv.spectralTypes[star.objType]])
      
    // And make it the right color
    sprite.setAttribute('material', {color: starColor})

    // Work out the size for it
    let size = Math.pow(star.objMass, 1/4)

    // Make the star sphere
    sprite.setAttribute('geometry', {
      primitive: 'sphere',
      radius: size
    })

    // TODO: A particle glow that doesn't look completely different across platforms

  })

  return sprite
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

        // Make a sprite
        let sprite = starToSprite(star)

        sprite.addEventListener('loaded', () => {
          // When it loads, move it to the right spot in the sector.
          // Make sure to center the 25 LY sector on the A-Frame origin
          sprite.setAttribute('position', {x: star.x - 12.5, y: star.y - 12.5, z: star.z - 12.5})
        })

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

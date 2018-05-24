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
  
  let planetCount = await ctx.planets.getObjectPlanetCount(star)
  console.log('Star ' + star.seed + ' has ' + planetCount + ' planets.')

  planetPromises = []
  for (let j = 0; j < planetCount; j++) {
    // Go get every planet
    planetPromises.push(ctx.planets.getPlanet(star, j))
  }

  let planets = await Promise.all(planetPromises)

  for (let j = 0; j < planets.length; j++) {
    // Dump them all when they all come in
    console.log('Star ' + star.seed + ' planet ' + j + ': ', planets[j])
  }

  // Generate a system view

  // Make a root node
  let root = document.createElement('a-entity')

  // Make a sun sprite
  let sun = starToSprite(star)
  sun.addEventListener('loaded', () => {
    // Drop the sun in the center of the root entity
    sun.setAttribute('position', {x: 0, y: 0, z: 0})
    // Scale it up
    // TODO: Scaling does not work on the particle system!
    sun.setAttribute('scale', {x: 2, y: 2, z: 2})
  })

  root.appendChild(sun);

  for (let i = 0; i < planets.length; i++) {
    let planetSprite = planetToSprite(planets[i])
    
    planetSprite.addEventListener('loaded', () => {
      // Line the planets up in x
      planetSprite.setAttribute('position', {x: (i + 1) * 5, y: 0, z: 0})
    })
    
    root.appendChild(planetSprite)
  }

  if (ourNonce == systemNonce) {
    // We won the race so display
    // Find the system display holding node
    let system = document.getElementById('system')
    while (system.firstChild) {
      // Clear out its existing children
      system.removeChild(system.firstChild)
    }
    // Put in our child we made
    system.appendChild(root)
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
    let size = Math.pow(planet.planetMass, 1/4)
    console.log('Planet size is ' + size + ' for mass ' + planet.planetMass)

    // Make the planet sphere
    sprite.setAttribute('geometry', {
      primitive: 'sphere',
      radius: size
    })
  })

  return sprite
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

    if (mv.objectClasses[star.objClass] != 'BlackHole') {
      // We want it to glow

      // Add a particle system.
      // Note that we can't set spreads and things to 0 because then the preset's default will come through.
      // TODO: The particles scale weirdly! See <https://github.com/IdeaSpaceVR/aframe-particle-system-component/issues/36>
      // TODO: The particles also just draw over each other in order of system creation instead of in even system center Z order.
      // TODO: The default textures are somehow magic and can be transparent. Applying a custom texture can't seem to do that even with a transparent png.
      // TODO: The particle effect is weirdly pulsating due to uneven emission times.
      // This is because we always try to make 200 particles to start and we can only make up to the max count.
      sprite.setAttribute('particle-system', {
        preset: 'snow',
        color: [starColor, '#000000'],
        size: size * 8,
        type: 2, // Be a sphere
        positionSpread: {x: size/2, y: size/2, z: size/2},
        velocityValue: {x: 1E-10, y: 1E-10, z: 1E-10},
        velocitySpread: {x: size/2, y: size/2, z: size/2},
        accelerationValue: {x: 1E-10, y: 1E-10, z: 1E-10},
        accelerationSpread: {x: 1E-10, y: 1E-10, z: 1E-10},
        maxAge: 2,
        blending: 2, // Do additive blending
        texture: 'img/nova_1.png',
        maxParticleCount: 50,
        randomize: true
      })
    }
  })

  return sprite
}

let sectorNonce = 0

async function showSector(ctx, x, y, z) {
  // Figure out our place so we don't clobber later requests that finish earlier
  sectorNonce++
  let ourNonce = sectorNonce

  // Find where we want to put things
  let sector = document.getElementById('sector')

  // Clear out the sector
  while (sector.hasChildNodes()) {
    sector.removeChild(sector.lastChild);
  }

  let starCount = await ctx.stars.getObjectCount(x, y, z)

  // We fill this with promises for making all the stars, which are running in parallel.
  let starPromises = []

  for (let i = 0; i < starCount; i++) {
    // For each star in the origin sector
    let starPromise = ctx.stars.getObject(x, y, z, i).then((star) => {
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

    // Now we have a promise for this star's completion, so stick it in the array
    starPromises.push(starPromise)

  }

  // Now starPromises is populated, so we can wait on all of them
  await Promise.all(starPromises)
  if (ourNonce == sectorNonce) {
    console.log('All stars loaded for sector ' + x + ' ' + y + ' ' + z + ' nonce ' + ourNonce)
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

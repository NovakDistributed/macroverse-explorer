// sprites.js: handles creating 3d A-Frame "sprites" from planets, stars, and orbits.

// We want macroverse itself
const mv = require('macroverse')

// We want someone else's implementation of orbital mechanics
const orb = require('orbjs')

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

// Given a planet object from the cache, return a DOM node for a sprite to represent the planet
// The planet will automatically orbit on the orbit it carries, if the star is passed.
function planetToSprite(planet, star) {
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

  if (star) {
    // We can be in orbit

    // Compute orbit facts
    let periapsis = planet.orbit.periapsis / mv.AU
    let apoapsis = planet.orbit.apoapsis / mv.AU
    
    let update = () => {
      // Work out where the planet belongs at this time
      let planetPos = computeOrbitPositionInAU(planet.orbit, star.objMass, getRenderTime())
      // Put it there
      sprite.setAttribute('position', planetPos)
    }

    sprite.addEventListener('loaded', () => {
      update()
      let interval = setInterval(() => {
        if (sprite.parentNode != null) {
          // We are still visible
          update()
        } else {
          // Stop updating
          clearInterval(interval)
        }
      }, 20)
    })
  }

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
  // Show at 1 year per second
  return macroverseTime * 31557600
}

// Given a star object from the cache, return a DOM node for a sprite to represent the star.
// If positionSelf is true, star sprite will position itself based on the star's position
// in the sector, centering the sector on 0. Otherwise, the star will appear at 0.
function starToSprite(star, positionSelf) {
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

    if (positionSelf) {
      // When it loads, move it to the right spot in the sector.
      // Make sure to center the 25 LY sector on the A-Frame origin
      sprite.setAttribute('position', {x: star.x - 12.5, y: star.y - 12.5, z: star.z - 12.5})
    }

  })

  return sprite
}

module.exports = {starToSprite, planetToSprite, orbitToSprite}

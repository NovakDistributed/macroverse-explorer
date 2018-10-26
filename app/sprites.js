// sprites.js: handles creating 3d A-Frame "sprites" from planets, stars, and orbits.

// We want macroverse itself
const mv = require('macroverse')

const { parentOf, lastComponent } = require('./keypath.js')

// We want someone else's implementation of orbital mechanics
const orb = require('orbjs')

// Our ScaleManager can emit events
const { EventEmitter2 } = require('eventemitter2')

// Load a real quaternion library since I can't seem to make threejs do Euler right
const Quaternion = require('quaternion')
const quaternionToEuler = require('quaternion-to-euler')

// See http://www.isthe.com/chongo/tech/astro/HR-temp-mass-table-byhrclass.html for a nice table, also accounting for object class (IV/III/etc.) and 0-9 subtype.
const typeToColor = {
  'TypeO': [144, 166, 255],
  'TypeB': [156, 179, 255],
  'TypeA': [179, 197, 255],
  'TypeF': [218, 224, 255],
  'TypeG': [255, 248, 245],
  'TypeK': [255, 225, 189],
  'TypeM': [255, 213, 160],
  'NotApplicable': [128, 128, 128]
}

const worldColors = {
  'Lunar': 'white',
  'Europan': 'brown',
  'Terrestrial': 'blue',
  'Panthalassic': 'aqua',
  'Neptunian': 'purple',
  'Jovian': 'orange',
  'AsteroidBelt': 'gray',
  'Ring': 'yellow'
}

// Convert an array of 0-255 values into a hex color code.
// It has to be hex because A-Frame particle systems only accept hex, not 'rgb()' notation
function arrayToColor(arr) {

  if(arr === undefined) {
    // This is bad
    return '#FF00FF'
  }
  
  hex = '#'
  for (let item of arr) {
    if(item < 16) {
      hex += '0'
    }
    hex += item.toString(16)
  }
  return hex
}

// A set of planet sprites in a star system use one instance of this to decide on the overall scale of the system.
// It can scale down or up as planets materialize.
// TODO: Make it keep temporary orbits in view until overridden.
// TODO: This is kind of wanting to be really reactive.
class ScaleManager extends EventEmitter2 {
  constructor() {
    super()
    this.setMaxListeners(1000)

    // What scale are we at
    this.scale = 1.0

    // What are the min and max observed orbit scales?
    this.minAU = null
    this.maxAU = null

    // What temporary orbit scales (in AU) should we use until all planets have reported in?
    this.tempMin = 1
    this.tempMax = 1

    // How many total orbit parameter reports do we have?
    this.totalReports = 0

    // How many reports do we expect? This should be 2 * number of planets
    this.expectedReports = 0
  }

  // Get the scale factor to draw the star system with, in 3D units per AU
  get() {
    return this.scale
  }
  
  // Until the given number of total reports are received, use the given temporary min and max values in scaling
  expect(total, tempMin, tempMax) {
    this.expectedReports = total
    this.tempMin = tempMin
    this.tempMax = tempMax
  }

  // Report the periapsis or apoapsis of a planet, or a habitable zone boundary, in AU, and potentially adjust the scale
  report(au) {
    this.totalReports++

    let rescaled = false
    if (!this.minAU || au < this.minAU) {
      this.minAU = au
      rescaled = true
    }
    if (!this.maxAU || au > this.maxAU) {
      this.maxAU = au
      rescaled = true
    }
    if (rescaled) {
      this.rescale()
    }
  }

  // Actually compute a new scale, and issue an event if it has changed.
  rescale() {
    
    let minAU = this.minAU
    let maxAU = this.maxAU
    if (this.expectedReports > this.totalReports) {
      // Mix in the temp bounds
      minAU = Math.min(minAU, this.tempMin)
      maxAU = Math.max(maxAU, this.tempMax)
    }

    // We would prefer to scale up the innermost orbit to 1 units
    let minAUWantsScale = 1 / this.minAU

    // We would prefer to scale down the outermost orbit to 100 units
    let maxAUWantsScale = 100 / this.maxAU

    let newScale = this.scale
    if (maxAUWantsScale < 1) {
      // Scale down
      newScale = maxAUWantsScale
    } else if (minAUWantsScale > 1) {
      // Scale up
      newScale = Math.min(minAUWantsScale, maxAUWantsScale)
    }

    if (newScale != this.scale) {
      let oldScale = this.scale
      this.scale = newScale
      this.emit('rescale', this.scale, oldScale)
    }

  }
}

// Given a planet object from the cache, return a DOM node for a sprite to represent the planet
// The planet will automatically orbit on the orbit it carries, if the star is passed.
function makePlanetSprite(ctx, keypath, scaleManager) {

  // Define an easy function to get a promise for a property of the star
  let get = (prop) => {
    return ctx.ds.request(keypath + '.' + prop)
  }

  // And for the parent star
  let getStar = (prop) => {
    return ctx.ds.request(parentOf(keypath) + '.' + prop)
  }

  // Work out what planet this is
  let planetNumber = parseInt(lastComponent(keypath))

  // We will set up a default orbit based on the planet number
  let orbit = {
    periapsis: planetNumber * mv.AU,
    apoapsis: planetNumber * mv.AU,
    lan: 0,
    inclination: 0,
    aop: 0,
    meanAnomalyAtEpoch: 0
  }

  // And the rotation info, in radians
  let spin = {
    axisAngleZ: 0.5,
    axisAngleX: 0.1,
    spinRate: 0.00007272205,
  }

  // And similarly for the star, which we assume has a mass of 1 sol until proven otherwise
  let star = {
    objMass: 1
  }

  // Make sure to report orbit to the scale manager when it comes in
  // TODO: This will make extra requests
  get('orbit.periapsis').then((periapsis) => {
    scaleManager.report(pariapsis / mv.AU)
  })
  get('orbit.apoapsis').then((apoapsis) => {
    scaleManager.report(apoapsis / mv.AU)
  })

  for(let key in orbit) {
    // Kick off requests to update the orbit in place with all the real data when available
    get('orbit.' + key).then((val) => {
      orbit[key] = val
    })
  }

  for(let key in star) {
    // Similarly for any star properties used in the orbit
    getStar(key).then((val) => {
      star[key] = val
    })
  }

  // Make a sprite
  let sprite = document.createElement('a-entity')
  // It will have a hat on the north pole to show rotation
  let hat = document.createElement('a-entity')
  sprite.appendChild(hat)

  // Give it the ID of the keypath, so we can find it
  sprite.id = keypath

  // We initially use a random radius
  let initialRadius = Math.random()

  sprite.addEventListener('loaded', () => {
    // Give it a default appearance

    // It is a sphere of a random size initially, in low resolution
    sprite.setAttribute('geometry', {
      primitive: 'sphere',
      segmentsWidth: 8,
      segmentsHeight: 8,
      radius: initialRadius
    })

    // It will initially be a green wireframe to signify loading
    sprite.setAttribute('material', {
      color: 'green',
      wireframe: true,
      wireframeLinewidth: 1
    })

    get('planetMass').then((planetMass) => {
      // Work out the actual size for it
      let size = Math.max(Math.log10(planetMass) + 3, 1) / 10

      // Make the planet sphere
      sprite.setAttribute('geometry', {
        primitive: 'sphere',
        segmentsWidth: 18,
        segmentsHeight: 36,
        radius: size
      })
    })

    get('planetClass').then((planetClass) => {
      // Make it the right color for the class that it is
      let planetColor = worldColors[mv.worldClasses[planetClass]]
      sprite.setAttribute('material', {
        color: planetColor,
        wireframe: false
      })
    })
    
    // Define an update function for the planet's position in the orbit
    let update = () => {
      // Work out where the planet belongs at this time
      let planetPos = computeOrbitPositionInAU(orbit, star.objMass, getRenderTime())
      // Convert to 3d system units
      let scale = scaleManager.get()
      planetPos.x *= scale
      planetPos.y *= scale
      planetPos.z *= scale
      // Put it there
      sprite.setAttribute('position', planetPos)

      // Compute rotation based on spin rate, time, and planet angles
      let planetRot = computeWorldRotation(spin, getRenderTime());
      sprite.setAttribute('rotation', planetRot)
    }

    // Update the planet position now and later (when more values come in) according to the orbit
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

  hat.addEventListener('loaded', () => {
    // The hat will be a cone
    hat.setAttribute('geometry', {
      primitive: 'cone',
      // Make it a half cone so we can see it spin
      thetaStart: 180,
      thetaLength: 180,
      radiusTop: 0,
      segmentsHeight: 3,
      segmentsRadial: 8,
      radiusBottom: initialRadius / 3,
      height: initialRadius / 3
    })

    hat.setAttribute('position', {
      x: 0,
      y: initialRadius + (initialRadius / 6),
      z: 0
    })

    hat.setAttribute('material', {
      color: 'green',
      wireframe: true,
      wireframeLineWidth: 1
    })

    get('planetMass').then((planetMass) => {
      // Work out the actual size for it
      // TODO: Duplicative with above
      let size = Math.max(Math.log10(planetMass) + 3, 1) / 10

      // Move the hat
      hat.setAttribute('position', {
        x: 0,
        y: size + (size / 6),
        z: 0
      })

      hat.setAttribute('geometry', {
        radiusBottom: size / 3,
        height: size / 3
      })
    })
  })

  return sprite
}

// Mount the given node on a parent, translated by nothing, and then rotated by nothing
// Returns the parent. Rotations are in degrees, to match A-Frame.
// Order of rotations is undefined if multiple axes are used at once.
function mount(childNode) {
  
  // Make the parent
  let parentNode = document.createElement('a-entity')
  parentNode.appendChild(childNode)
  parentNode.mountedChild = childNode

  return parentNode

}

// Shorthand to apply a translation and a rotation to a mounting from mount().
// Applies the translation and then the rotation to the child node that was mounted.
// Operates on the returned, mounting node.
function applyTranslateRotate(mounted, xTrans, yTrans, zTrans, xRot, yRot, zRot) {
  let childNode = mounted.mountedChild
  childNode.setAttribute('position', {x: xTrans, y: yTrans, z: zTrans})
  mounted.setAttribute('rotation', {x: xRot, y: yRot, z: zRot})
}

// Return a function that can be called, and, once the given A-Frame node is loaded, calls the given update function.
// Also calls the updater function once when the scene node is loaded.
// Also works on mounted nodes from mount() where we have to wait for two things to load.
function makeUpdater(node, updateAssumingLoaded) {
  let loaded = false
  node.addEventListener('loaded', () => {
    loaded = true
    updateAssumingLoaded()
  })

  // TODO: We assume the child loaded if the parent did

  return () => {
    if (loaded) {
      updateAssumingLoaded()
    }
  }
}

// Make a sprite to represent an orbit.
// Scales with the given ScaleManager.
function makeOrbitSprite(ctx, keypath, scaleManager) {

  // Define an easy function to get a promise for a property of the planet
  let get = (prop) => {
    return ctx.ds.request(keypath + '.' + prop)
  }

  // And for the parent star
  let getStar = (prop) => {
    return ctx.ds.request(parentOf(keypath) + '.' + prop)
  }

  // Work out what planet this is
  let planetNumber = parseInt(lastComponent(keypath))

  // We use the same default-and-refine half-reactive system that the planets use
  let orbit = {
    periapsis: planetNumber * mv.AU,
    apoapsis: planetNumber * mv.AU,
    semimajor: planetNumber * mv.AU,
    semiminor: planetNumber * mv.AU,
    lan: 0,
    inclination: 0,
    aop: 0,
    meanAnomalyAtEpoch: 0
  }

  // Prepare the scene nodes

  // Make an elipse of the right shape radius in the XZ plane
  let circleNode = document.createElement('a-entity')

  circleNode.addEventListener('loaded', () => {
    // Give it a color and stuff
    circleNode.setAttribute('material', {color: 'white', wireframe: true, wireframeLinewidth: 1})

    // Then rotate it from the XY plane to the XZ plane
    circleNode.setAttribute('rotation', {x: -90, y: 0, z: 0})
  })

  // Make an updater for it that we can call again when the orbit changes
  let updateCircle = makeUpdater(circleNode, () => {
    // Give it its basic shape
    circleNode.setAttribute('geometry', {
      primitive: 'ring',
      radiusInner: orbit.semiminor / mv.AU * scaleManager.get(),
      radiusOuter: orbit.semiminor / mv.AU * scaleManager.get() - 0.001
    })

    // Stretch it out in X to be the semimajor radius
    circleNode.setAttribute('scale', {x: orbit.semimajor / orbit.semiminor, y: 1, z: 1})
  })

  // Mount the elipse on another scene node so the little lobe (periapsis) is +X
  // (toward the right) from the origin (where the parent body goes) and rotate
  // that around Y by the AoP. We have to move towards -X.
  let mounted1 = mount(circleNode)
  let updateMount1 = makeUpdater(mounted1, () => {
    let budge = (orbit.apoapsis - orbit.semimajor) / mv.AU * scaleManager.get()
    applyTranslateRotate(mounted1, -budge, 0, 0, 0, mv.degrees(orbit.aop), 0)
  })

  // Then mount that and rotate it in X by the inclination
  let mounted2 = mount(mounted1)
  let updateMount2 = makeUpdater(mounted2, () => {
    applyTranslateRotate(mounted2, 0, 0, 0, mv.degrees(orbit.inclination), 0, 0)
  })

  // Then mount that and rotate it in Y by the LAN
  let mounted3 = mount(mounted2)
  let updateMount3 = makeUpdater(mounted2, () => {
    applyTranslateRotate(mounted3, 0, 0, 0, 0, mv.degrees(orbit.lan))
  })

  // When we change the orbit, update the sprite
  for(let key in orbit) {
    // Kick off requests to update the orbit in place with all the real data when available
    get('orbit.' + key).then((val) => {
      orbit[key] = val

      updateCircle()
      updateMount1()
      updateMount2()
      updateMount3()
    })
  }

  // When the scale changes, also update the sprite
  scaleManager.on('rescale', () => {
    updateCircle()
    updateMount1()
    updateMount2()
    updateMount3()
  })

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
  let sol = mv.G_PER_SOL / orb.constants.common.G

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

// Compute the current orientation (A-frame XYZ Euler angles in degrees) of a planet.
// Takes a spin object with axisAngleZ, axisAngleX, in radians (rotate on Z first, then X, then spin, all intrinsic), and also spinRate in radians.
// Takes care of computing the final rotation.
function computeWorldRotation(spin, secondsSinceEpoch) {

  // Precompute the spin
  let currentSpinAngle = (secondsSinceEpoch * spin.spinRate) % (2 * Math.PI)
  
  // Euler angles are interpreted *and* applied in the order you specify
  let quat = Quaternion.fromEuler(spin.axisAngleZ, spin.axisAngleX, currentSpinAngle, 'ZXY')

  // Convert back to normal Euler angles
  let euler = quaternionToEuler(quat.toVector())

  // TODO: Why do these have to be in a different order? Are our quaternions misparsed?
  return {x: mv.degrees(euler[0]), y: mv.degrees(euler[1]) * 0, z: mv.degrees(euler[2])}

}

// Return the time to draw right now, in seconds since epoch
function getRenderTime() {
  let unixTime = (new Date()).getTime() / 1000
  let macroverseTime = unixTime - mv.EPOCH
  // Show at 1 day per second speed, about
  return macroverseTime * 60 * 60 * 24
}

// Make a sprite to represent the habitable zone around a star.
// Takes the root keypath of the star.
// Scales with the given ScaleManager.
function makeHabitableZoneSprite(ctx, keypath, scaleManager) {

  // Define an easy function to get a promise for a property of the star
  let get = (prop) => {
    return ctx.ds.request(keypath + '.' + prop)
  }

  // Define an object we will fill in witht the real habitable zone values
  let habitableZone = {
    start: mv.AU,
    end: 2 * mv.AU,
    // We have a special done flag so we know to turn not-wireframe
    done: false
  }

  // Prepare the scene nodes

  // Make a flat torus in the XZ plane, so we can depict an inner and outer radius
  let regionNode = document.createElement('a-entity')

  regionNode.addEventListener('loaded', () => {
    // Give it a color and stuff
    // TODO: Green wireframe = not ready for other things.
    regionNode.setAttribute('material', {color: 'green', wireframe: true, wireframeLinewidth: 1})

    // Then rotate it from the XY plane to the XZ plane
    regionNode.setAttribute('rotation', {x: -90, y: 0, z: 0})
  })

  // Make an updater for it that we can call again when the orbit changes
  let updateRegion = makeUpdater(regionNode, () => {
    // Give it its shape
    regionNode.setAttribute('geometry', {
      primitive: 'ring',
      radiusInner: habitableZone.start / mv.AU * scaleManager.get(),
      radiusOuter: habitableZone.end / mv.AU * scaleManager.get()
    })

    if (habitableZone.done) {
      // Make it not wireframe
      regionNode.setAttribute('material', {color: 'green', wireframe: false, side: 'double', opacity: 0.5})
    }
  })

  // The habitable zone is generated together, so go get it all at once.
  Promise.all([get('habitableZone.start'), get('habitableZone.end')]).then(([start, end]) => {
    // Now we know the habitable zone, so go be in it
    habitableZone.start = start
    habitableZone.end = end
    // mark it done so it can be solid
    habitableZone.done = true
    // Report both bounds to the scale manager, so we can scale to see them.
    scaleManager.report(start / mv.AU)
    scaleManager.report(end / mv.AU)
    updateRegion()
  })
  
  // When the scale changes, also update the sprite
  scaleManager.on('rescale', () => {
    updateRegion()
  })

  return regionNode
}

// Given the context and a star keypath, return a DOM node for a sprite to represent the star.
// If positionSelf is true, star sprite will position itself based on the star's position
// in the sector, centering the sector on 0. Otherwise, the star will appear at 0.
function makeStarSprite(ctx, keypath, positionSelf) {
  // Make it a sprite
  let sprite = document.createElement('a-entity')

  // Define an easy function to get a promise for a property of the star
  let get = (prop) => {
    return ctx.ds.request(keypath + '.' + prop)
  }

  // Define an easy way to know how long it will take to get a property (is it cached?)
  let have = (prop) => {
    return ctx.ds.isCachedInMemory(keypath + '.' + prop)
  }

  sprite.addEventListener('loaded', () => {
    // We can't actually use any of the A-Frame overrides for element setup until A-Frame calls us back

    // We also have to use objects instead of the strings we would use in
    // HTML, a-entity for everything instead of the convenient primitive
    // tags, and geometry/material instead of the shorthand color and so on
    // on the primitives.

    // It is a sphere of a random size initially, in low resolution
    sprite.setAttribute('geometry', {
      primitive: 'sphere',
      segmentsWidth: 8,
      segmentsHeight: 8,
      radius: Math.random()
    })

    // It will initially be a green wireframe to signify loading
    sprite.setAttribute('material', {
      color: 'green',
      wireframe: true,
      wireframeLinewidth: 1
    })

    // Go get the actual things we need to know about it
    
    get('objType').then((objType) => {
      let starColor = arrayToColor(typeToColor[mv.spectralTypes[objType]])
      
      // Make it the right color, and solid
      sprite.setAttribute('material', {
        color: starColor,
        wireframe: false
      })
    })

    get('objMass').then((objMass) => {
      // Work out the size for it
      let size = Math.max(Math.log10(objMass) + 3, 1) / 5

      // Make the star the right size
      sprite.setAttribute('geometry', {
        segmentsWidth: 18,
        segmentsHeight: 36,
        radius: size
      })
    })

    // TODO: A particle glow that doesn't look completely different across platforms

    if (positionSelf) {
      // When it loads, move it to the right spot in the sector.
      // Make sure to center the 25 LY sector on the A-Frame origin
      
      // Will we animate the position when we get the real one?
      var placeholderPos = null
      if (!have('x') || !have('y') || !have('z')) {
        // Position not already known

        // Initially put it at a random position
        placeholderPos = {x: Math.random() * 25 - 12.5, y: Math.random() * 25 - 12.5, z: Math.random() * 25 - 12.5}
        sprite.setAttribute('position', placeholderPos)
      }

      

      Promise.all([get('x'), get('y'), get('z')]).then(([x, y, z]) => {
        // Now we know the real position
        let realPos = {x: x - 12.5, y: y - 12.5, z: z - 12.5}

        if (placeholderPos) {
          // We were initially in a placeholder position. We should animate to where we want to go.
          let distance = Math.sqrt(Math.pow(realPos.x - placeholderPos.x, 2) +
                                   Math.pow(realPos.y - placeholderPos.y, 2) +
                                   Math.pow(realPos.z - placeholderPos.z, 2))

          // Animate between them
          sprite.setAttribute('animation', {
            property: 'position',
            from: placeholderPos,
            to: realPos,
            dur: distance/25 * 200
          })
        } else {
          // Just go there
          sprite.setAttribute('position', realPos)
        }
      })
      
      
    
    }
    

  })

  return sprite
}

module.exports = {makeStarSprite, makePlanetSprite, makeOrbitSprite, makeHabitableZoneSprite, ScaleManager}

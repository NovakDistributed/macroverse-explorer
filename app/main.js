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

async function main() {

  console.log('Macroverse Explorer starting on Ethereum network ' + eth.get_network_id())
  console.log('Using account ' + eth.get_account())

  // Get ahold of a global Macroverse context.
  let ctx = await Context('contracts/')

  // Find where we want to put things
  let scene = document.getElementById('scene')

  let starCount = await ctx.stars.getObjectCount(0, 0, 0)
  for (let i = 0; i < starCount; i++) {
    // For each star in the origin sector
    let star = await ctx.stars.getObject(0, 0, 0, i)
    // Make it a sprite
    let sprite = document.createElement('a-entity')
    sprite.setAttribute('id', 'star' + i)

    sprite.addEventListener('loaded', () => {
      // We can't actually use any of the A-Frame overrides for element setup until A-Frame calls us back

      // We also have to use objects instead of the strings we would use in
      // HTML, a-entity for everything instead of the convenient primitive
      // tags, and geometry/material instead of the shorthand color and so on
      // on the primitives.

      // Make sure to center the 25 LY sector on the A-Frame origin
      sprite.setAttribute('position', {x: star.x - 12.5, y: star.y - 12.5, z: star.z - 12.5})

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

      // Add a particle system.
      // Note that we can't set spreads and things to 0 because then the preset's default will come through.
      // TODO: The particles scale weirdly! See <https://github.com/IdeaSpaceVR/aframe-particle-system-component/issues/36>
      // TODO: The particles also just draw over each other in order of system creation instead of in even system center Z order.
      // TODO: The default textures are somehow magic and can be transparent. Applying a custom texture can't seem to do that even with a transparent png.
      // TODO: The particle effect is weirdly pulsating due to uneven emission times.
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

      console.log(sprite.getAttribute('particle-system'))
    })

    // And display it
    scene.appendChild(sprite)
    
  }

}

// Actually run the entry point
main()

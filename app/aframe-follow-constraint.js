/**
 * Follow constraint component for a-frame.
 * Better than the parent constraint component because it doesn't have an
 * uneditable object-parent offset.
 * Works around A-Frame's lack of any ability to change an entity's parent by
 * updating an entity's position every frame to follow another entity.
 * See: https://github.com/aframevr/aframe/issues/2425
 */

AFRAME.registerComponent('follow-constraint', {
  // What parts of the component data can exist?
  schema: {
    // This is the element we follow
    target: {type: 'selector', default: null},
    // This is the fraction of the distance we travel each frame
    speed: {default: 0.5},
    // This is the distance within which we snap to the final position
    snap: {default: 0.1}
  },
  multiple: false,
  init: function() {
    this.target = null
    this.speed = 0.5
    this.snap = 0.1
  },
  update: function(oldData) {
    // This is the a-frame component made by init
    // The new data is this.data

    if (typeof this.data.target != 'undefined') {
      // Update the target
      this.target = this.data.target
    }

    if (typeof this.data.speed != 'undefined') {
      // Update the speed
      this.speed = this.data.speed
    }

    if (typeof this.data.snap != 'undefined') {
      // Update the snap distance
      this.snap = this.data.snap
    }

    // TODO: We require the target and this element to both be set up before this component starts.
    // We don't have any logic to wait for them to load
  },
  tick: function(time, timeDelta) {
      if (this.target !== null) {
        // Find our object3d
        let ourObj = this.el.object3D
        // And the target's
        let targetObj = this.target.object3D

        // Get the target's world space position
        let targetWorldPos = targetObj.getWorldPosition()

        // Make our inverse matrix
        let worldToLocal = new THREE.Matrix4().getInverse(ourObj.matrixWorld)

        // Transform target pos to our local coordinate space
        // TODO: Assumes we have no rotation or scale!
        let targetLocalPos = targetWorldPos.clone()
        targetLocalPos.applyMatrix4(worldToLocal)

        if (targetLocalPos.length() > this.snap) {
          // Scale by speed so we can animate a bit
          targetLocalPos.multiplyScalar(this.speed)
        }

        // Adjust our local position to match (or approach) the target's
        ourObj.position.add(targetLocalPos)
      }
  },
  remove: function() {
    // Nothing to do!
  }
})



// halfact.js: contains an ad-hoc, informally-specified, bug-ridden, slow
// implementation of half of React, written by somebody who never learned
// React.

// Uses JavaScript template literals for templating, with some code to let you
// break into DOMNodes in the middle of template text by emitting placeholders
// and cramming the real elements in later.

const timers = require('timers')

// Internal counter to generate unique IDs
let nextId = 0

// Return a string to be added to the DOM. When the string is added to the
// DOM on the current JS tick, it will be replaced with the DOM node passed
// to this function on the next tick.
// Hacky DOM node embedding for template literals, so events can come along.
// TODO: Maybe we should just port this whole thing to React or something.
function placeDomNode(node) {
  // Come up with a unique HTML ID for the element we will return.
  let id = 'halfact-placeDomNode-' + nextId
  nextId++

  timers.setImmediate(() => {
    // On the next tick, after our text is in the DOM...

    // Find it
    let waiting = document.getElementById(id)
    if (waiting) {
      // Put the actual DOM node we want to embed before it
      waiting.parentNode.insertBefore(node, waiting)
      // Remove the placeholder
      waiting.parentNode.removeChild(waiting)
    }
  })

  // Return text to make the element we are going to look for.
  return `<span id="${id}"></span>`

  // TODO: Try an approach with dynamically added script tags instead, in case
  // the element doesn't want to be added quite this tick.  The probelm there
  // is: how do you know it will be added at all, and how long do you keep the
  // DOM node around waiting for the script to run?
}

module.exports = {placeDomNode}

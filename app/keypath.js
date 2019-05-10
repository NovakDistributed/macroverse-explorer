//keypath.js: keypath manipulation functions

// Make a function that gets keypath parents
function parentOf(keypath) {
  return keypath.substr(0, keypath.lastIndexOf('.'))
}

// And one that gets an array of all parents
function allParentsOf(keypath) {
  if (lastComponent(keypath) == keypath) {
    // No parents exist
    return []
  } else {
    // Get our parent
    let our_parent = parentOf(keypath)
    // And all its parents
    let higher_parents = allParentsOf(our_parent)
    // Add it in and return
    higher_parents.push(our_parent)
    return higher_parents
  }
}

// And one that gets the last thing in the keypath
function lastComponent(keypath) {
  return keypath.substr(keypath.lastIndexOf('.') + 1)
}

// And one that gets the first thing in the keypath
function firstComponent(keypath) {
  return keypath.substr(0, keypath.indexOf('.'))
}

// And one that gets the number of components in a keypath
function componentCount(keypath) {
  return splitKeypath(keypath).length
}

// And one that just explodes a keypath
function splitKeypath(keypath) {
  return keypath.split('.')
}


// We define a tiny keypath get/set library

// Return true if the given object has the given keypath set, and false otherwise
function hasKeypath(obj, keypath) {
  if (obj === undefined) {
    // Base case: hit a dead end
    return false
  }
  
  if (keypath == '') {
    // Base case: we just want this real object
    return true
  }

  var dot = keypath.indexOf('.')
  if (dot == -1) {
    // Base case: we want an immediate child
    return obj.hasOwnProperty(keypath)
  }

  let first = keypath.substr(0, dot)
  let rest = keypath.substr(dot + 1, (keypath.length - dot - 1))

  // Look up one step of the keypath and recurse for the rest
  return hasKeypath(obj[first], rest)
}

// Return the value of the given keypath, or undefined if it or any parent is not present
function getKeypath(obj, keypath) {
  if (obj === undefined) {
    // Base case: hit a dead end
    return undefined
  }

  if (keypath == '') {
    // Other base case: no more components
    return obj
  }

  // Look for a delimiter
  var dot = keypath.indexOf('.')
  if (dot == -1) {
    // Just look this up
    return obj[keypath]
  }

  let first = keypath.substr(0, dot)
  let rest = keypath.substr(dot + 1, (keypath.length - dot - 1))

  // Look up one step of the keypath and recurse for the rest
  return getKeypath(obj[first], rest)
}

// Set the value in the given object of the given keypath to the given value. Creates any missing intermediate objects.
function setKeypath(obj, keypath, value) {
  if (obj === undefined) {
    // Error! Can't set in nothing!
    throw new Error("Can't set keypath '" + keypath + "' = '" + value + "' in undefined!")
  }

  if (keypath == '') {
    // Error! Can't set the thing itself!
    throw new Error("Can't set empty keypath = '" + value + "' in an object")
  }

  // Look for a delimiter
  var dot = keypath.indexOf('.')
  if (dot == -1) {
    // Just set here
    obj[keypath] = value
  } else {
    // Advance up one step of the keypath and recurse for the rest
    
    let first = keypath.substr(0, dot)
    let rest = keypath.substr(dot + 1, (keypath.length - dot - 1))

    if (obj[first] === undefined) {
      // Create any missing objects
      obj[first] = {}
    }

    // Go look for the place to stash the value
    return setKeypath(obj[first], rest, value)
  }
}

// Convert a keypath to an HTML element identifier.
// A keypath is a perfectly cromulent ID by itself, but things start to break
// down when you want to use it in a CSS selector where '.' is significant.
function keypathToId(keypath) {
    return 'kp' + keypath.replace(/\./g, '_')
}

module.exports = { parentOf, allParentsOf, lastComponent, firstComponent, componentCount, splitKeypath, getKeypath, setKeypath, keypathToId }

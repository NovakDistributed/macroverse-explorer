//keypath.js: keypath manipulation functions

// Make a function that gets keypath parents
function parentOf(keypath) {
  return keypath.substr(0, keypath.lastIndexOf('.'))
}

// And one that gets the last thing in the keypath
function lastComponent(keypath) {
  return keypath.substr(keypath.lastIndexOf('.') + 1)
}

// We define a tiny keypath get/set library

// Return the value of the given keypath, or undefined if it or any parent is not present
function getKeypath(obj, keypath) {
  if (obj == undefined) {
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
  if (obj == undefined) {
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


module.exports = { parentOf, lastComponent, getKeypath, setKeypath }

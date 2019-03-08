// throbber.js: Defines a system for showing transaction progress as a throbber
// that either turns into a checkmark on success or an x on failure

/// Return a DOM node representing a throbber that is hidden
function create() {
  let throbber = document.createElement('span')
  throbber.classList.add('throbber')
  throbber.style.display = 'none'
  return throbber
}

/// Start the given throbber throbbing
function start(throbber) {
  throbber.style.display = 'inline'
  throbber.classList.remove('success')
  throbber.classList.remove('failure')
  throbber.classList.add('waiting')
  throbber.innerText = '...'
}

/// Change the given throbber to a success state
function succeed(throbber) {
  throbber.classList.add('success')
  throbber.classList.remove('failure')
  throbber.classList.remove('waiting')
  throbber.innerText = '✅'
}


/// Change the given throbber to a failure state
function fail(throbber) {
  throbber.classList.remove('success')
  throbber.classList.add('failure')
  throbber.classList.remove('waiting')
  throbber.innerText = '❌'
}
    
module.exports = { create, start, succeed, fail }

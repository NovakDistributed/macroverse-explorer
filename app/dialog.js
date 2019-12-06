// dialog.js: Defines a dialog box system for doing wallet transactions,
// complaining that the user is out of money, etc.

// Only one dialog at a time is displayed, and it lives in the element with id
// "dialog".

// Load up our reactive web framework
const { placeDomNode } = require('./halfact.js')

// We have up to one modal dialog at a time. If one is open and it has a close handler, that lives here.
let current_close_handler = undefined

// We have a function to display text as a dialog.
// The user should use a template literal and fill in the actual contents.
// Title is optional.
// on_close is optional also, but will be called when the dialog is dismissed.
// If modal is truthy, the close button will not be displayed.
function showDialog(title, text, on_close, modal) {
    
  if (!text) {
    // Make the title a default; what we did get is the text.
    text = title
    title = 'Dialog'
  }

  // Close the old dialog properly
  closeDialog()
  // Replace the handler with a new one or undefined
  current_close_handler = on_close
  

  let dialogRoot = document.getElementById('dialog')
  dialogRoot.style.display = 'none'
  dialogRoot.innerHTML = `
    <div class="dialog">
      <div class="dialog-header">
        <span class="dailog-title">${title}</span>
        ${modal ? '' : placeDomNode(createCloseButton())}
      </div>
      <div class="dialog-body" id="dialog-body">
        ${text}
      </div>
    </div>
  `
  dialogRoot.style.display = 'block'

  let dialogBody = document.getElementById('dialog-body')

  // Scroll to top of dialog.
  dialogBody.scrollTo(0,0)
}

// This function creates the close button with attached event handler
function createCloseButton() {
  let button = document.createElement('button')
  button.addEventListener('click', () => {
    // Make the dialog go away
    closeDialog()
  })
  button.classList.add('dialog-close')
  button.innerText = 'X'
  return button
}

// Close the current dialog. Use in event handlers in the dialog to dismiss it.
function closeDialog() {
  document.getElementById('dialog').style.display = 'none'
  if (current_close_handler) {
    current_close_handler()
    current_close_handler = undefined
  }
}

module.exports = { showDialog, closeDialog }

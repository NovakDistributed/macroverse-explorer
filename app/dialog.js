// dialog.js: Defines a dialog box system for doing wallet transactions,
// complaining that the user is out of money, etc.

// Only one dialog at a time is displayed, and it lives in the element with id
// "dialog".

// Load up our reactive web framework
const { placeDomNode } = require('./halfact.js')

// We have a function to display text as a dialog.
// The user should use a template literal and fill in the actual contents.
// Title is optional.
function showDialog(title, text) {

  if (!text) {
    // Make the title a default and what we did get the text.
    text = title
    title = 'Dialog'
  }

  let dialogRoot = document.getElementById('dialog')
  dialogRoot.style.display = 'none'
  dialogRoot.innerHTML = `
    <div class="dialog">
      <div class="dialog-header">
        <span class="dailog-title">${title}</span>
        ${placeDomNode(createCloseButton())}
      </div>
      <div class="dialog-body">
        ${text}
      </div>
    </div>
  `
  dialogRoot.style.display = 'block'
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
}

module.exports = { showDialog, closeDialog }

// Wallet.js: UI for managing claims, commitments, and MRV

const Web3Utils = require('web3-utils')

// Load the code for displaying dialogs
const dialog = require('./dialog.js')

const { placeDomNode } = require('./halfact.js')

const throbber = require('./throbber.js')

const mv = require('macroverse')

/// Main interface to wallet functionality.
/// TODO: Should we receive events on a bus instead of waiting for people to look us up in the context and call our methods???
class Wallet {
  /// Create a new Wallet object
  constructor(context) {
    // Keep ahold of the context object, which lets us get at the Registry, which is our backend
    this.ctx = context
  }

  /// Display a commit dialog/wizard to help people commit
  showCommitDialog(keypath) {
    // Compute the minimum deposit for this item, in whole tokens.
    // Assumes no decimal place adjustment
    let minDeposit = Web3Utils.fromWei(mv.getMinimumDeposit(keypath))

    // Make a deposit approval throbber
    let approveThrobber = throbber.create()

    dialog.showDialog('Commit for ' + keypath, `
      <p>This wizard will guide you through the process of claiming ownership of ${keypath}</p>
      <h2>Step 1: Choose and Authorize Deposit</h2>
      <p>In order to own Macroverse virtual real estate, you need to put up a deposit in MRV. That deposit is locked up when you commit for an ownership claim, and returned when you cancel the commitment, or when you release your ownership of the claimed real estate. The minimum deposit value in MRV for the object you are trying to claim is pre-filled below. You must authorize the Macroverse registry to take this MRV from your account.</p>
      <label for="deposit">Deposit in MRV:</label>
      <input id="deposit" value="${minDeposit}"/>
      ${placeDomNode((() => {
        let approveButton = document.createElement('button')
        approveButton.innerText = 'Approve'
        approveButton.addEventListener('click', () => {
          // Start the throbber
          throbber.start(approveThrobber)
          // Actually send the approval transaction. Metamask or other user agent should prompt to confirm.
          this.ctx.reg.approveDeposit(Web3Utils.toWei(document.getElementById('deposit').value, 'ether')).then(() => {
            // Report success
            throbber.succeed(approveThrobber)
          }).catch(() => {
            throbber.fail(approveThrobber)
          })
        })
        return approveButton
      })())}
      ${placeDomNode(approveThrobber)}
    `)

    
  }

  

}


module.exports = Wallet

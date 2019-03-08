// Wallet.js: UI for managing claims, commitments, and MRV

const Web3Utils = require('web3-utils')

const FileSaver = require('file-saver')

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

    // And a throbber for claim creation
    let claimThrobber = throbber.create()

    dialog.showDialog('Commit for ' + keypath, `
      <p>This wizard will guide you through the process of claiming ownership of ${keypath}</p>
      <h2>Step 1: Choose and Authorize Deposit</h2>
      <p>In order to own Macroverse virtual real estate, you need to put up a <strong>deposit</strong> in MRV. That deposit is locked up when you commit for an ownership claim, and returned when you cancel the commitment, or when you release your ownership of the claimed real estate. The minimum deposit value in MRV for the object you are trying to claim is pre-filled below. You must authorize the Macroverse registry to take this MRV from your account.</p>
      <label for="deposit">Deposit in MRV:</label>
      <input id="deposit" value="${minDeposit}"/>
      ${placeDomNode((() => {
        let approveButton = document.createElement('button')
        approveButton.innerText = 'Approve'
        approveButton.addEventListener('click', () => {
          // TODO: validate entered deposit against minimum
          
          // Find the deposit field
          let depositField = document.getElementById('deposit')

          // Disable it and the button
          depositField.disabled = true
          approveButton.disabled = true

          // Start the throbber
          throbber.start(approveThrobber)
          // Actually send the approval transaction. Metamask or other user agent should prompt to confirm.
          this.ctx.reg.approveDeposit(Web3Utils.toWei(depositField.value, 'ether')).then(() => {
            // Report success
            throbber.succeed(approveThrobber)
            // TODO: Only enable claim button now
          }).catch(() => {
            // Report failure and let them change the deposit and try again
            throbber.fail(approveThrobber)
            depositField.disabled = false
            approveButton.disabled = false
          })
        })
        return approveButton
      })())}
      ${placeDomNode(approveThrobber)}
      <h2>Step 2: Broadcast Claim</h2>
      <p>The next step in claiming your virtual real estate is to <strong>commit</strong> to your claim. Committing publishes a cryptographic hash value on the blockchain to establish that you are going to claim a piece of virtual real estate, without revealing what, specifically, you are intending to claim. The commitment will have to sit on the blockchain to "mature" for a period of time before you can actually claim the real estate. When you do reveal what you are claiming, the requirement to have a matured commitment will prevent other people from sniping your claims and stealing the real estate you were intending to claim by paying a higher gas price.</p>
      <p>Press the button below to broadcast a claim for this piece of virtual real estate. <strong>This process will give you a secret value in a file to keep. Without this value, your claim will be worthless.</strong> If you lose it, or do not save it, all you will be able to do will be to cancel the claim and try again.</p>
      ${placeDomNode((() => {
        let claimButton = document.createElement('button')
        claimButton.innerText = 'Claim'
        claimButton.addEventListener('click', async () => {
          claimButton.disabled = true

          // Start the throbber
          throbber.start(claimThrobber)

          // Find the deposit field
          let depositField = document.getElementById('deposit')
      
          // Make the claim with the chain
          this.ctx.reg.createClaim(keypath, Web3Utils.toWei(depositField.value, 'ether')).then((claimData) => {
            // Save the claim info including nonce. TODO: would be good to do this first.
            FileSaver.saveAs(new Blob([JSON.stringify(claimData)], {type: 'application/json;charset=utf-8'}), 'commitment.' + keypath + '.json')

            // Say we succeeded, assuming the user downloaded the data.
            // TODO: let them try downloading again if they forget/cancel
            throbber.succeed(claimThrobber)
          }).catch(() => {
            // Let them try claiming again
            throbber.fail(claimThrobber)
            claimButton.disabled = false
          })
        })

        return claimButton
      })())}
      ${placeDomNode(claimThrobber)}
      <h2>Step 3: Wait</h2>
      <p>After broadcasting your claim, you must <strong>wait at least 24 hours</strong>. This delay is required to prevent claim sniping; it is the longest time that a malicious actor can be permitted to delay your claim transaction without compromising the security of the system. Come back tomorrow (but before 7 days, or your claim will expire and you will have to start over!).</p>
      ${placeDomNode((() => {
        // Have a button to close the dialog
        let doneButton = document.createElement('button')
        doneButton.innerText = 'Close'
        doneButton.addEventListener('click', () => {
          dialog.closeDialog()
        })
        return doneButton
      })())}
    `)


    // TODO: eliminate ugly closure invocation sigils in placeDomNode by making it invoke functions
    // TODO: Make it so we don't have to remember to return
    
  }

  

}


module.exports = Wallet

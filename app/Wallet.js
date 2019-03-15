// Wallet.js: UI for managing claims, commitments, and MRV

const Web3Utils = require('web3-utils')

const FileSaver = require('file-saver')

// Load the code for displaying dialogs
const dialog = require('./dialog.js')

const { placeDomNode } = require('./halfact.js')

const throbber = require('./throbber.js')

const eth = require('./eth.js')

const mv = require('macroverse')



/// Main interface to wallet functionality.
/// TODO: Should we receive events on a bus instead of waiting for people to look us up in the context and call our methods???
class Wallet {
  /// Create a new Wallet object
  constructor(context) {
    // Keep ahold of the context object, which lets us get at the Registry, which is our backend
    this.ctx = context
    // Keep a list of all the subscriptions to the registry that we can clear out when closing a dialog.
    // TODO: share this code with the Infobox.
    this.regSubscriptions = []
  }

  /// Clear out any current registry subscriptions.
  /// TODO: share this code with the Infobox
  clearSubscriptions() {
    for (let sub of this.regSubscriptions) {
      this.ctx.reg.unsubscribe(sub)
    }
    this.regSubscriptions = []
  }

  /// Return a DOM node which dynamically updates when the user's MRV balance changes
  createMRVBalanceDisplay() {
    let node = document.createElement('span')
    node.innerText = '??? MRV'
    this.regSubscriptions.push(this.ctx.reg.subscribe('mrv.balance', (balance) => {
      console.log('Got MRV balance: ', balance)
      // TODO: We need to toBN the balance because Web3Utils refuses BigNumber.
      // See https://github.com/ethereum/web3.js/blob/1f98597a60cefce0e560cce33b0fff7f7957b52e/packages/web3-utils/src/index.js#L196
      // See also: https://github.com/ethereum/web3.js/issues/2468
      node.innerText = Web3Utils.fromWei(Web3Utils.toBN(balance)) + ' MRV'
    }))
    return node
  }

  /// Display a general wallet dialog to allow sending tokens and canceling commitments
  showWalletDialog() {
    // Clear any old subscriptions.
    // TODO: Have a way to know when our dialog closes itself.
    this.clearSubscriptions()

    // Preapre throbbers for the form
    let sendMRVThrobber = throbber.create()

    dialog.showDialog('Wallet', `
      <p>This wallet allows you to send and receive MRV tokens and Macroverse virtual real estate, and to manage your real estate claim commitments.</p>
      <h2>Your MRV balance: ${placeDomNode(this.createMRVBalanceDisplay())}</h2>
      <h3>Receive MRV</h3>
      <p>Receiving address: ${eth.get_account()}</p>
      <h3>Send MRV</h3>
      <label for="mrv-destination">Destination:</label>
      <input id="mrv-destination" placeholder="0xDeAdBeEf..."/>
      <label for="mrv-amount">MRV:</label>
      <input id="mrv-amount" placeholder="0.01"/>
      ${placeDomNode(() => {
        let sendButton = document.createElement('button')
        sendButton.innerText = 'Send'
        sendButton.addEventListener('click', () => {
          // TODO: validate entered data
          
          // Find the form data
          let valueField = document.getElementById('mrv-amount')
          let destField = document.getElementById('mrv-destination')

          // Disable the form
          valueField.disabled = true
          destField.disabled = true
          sendButton.disabled = true

          // Start the throbber
          throbber.start(sendMRVThrobber)
          // Actually send the transaction. Metamask or other user agent should prompt to confirm.
          this.ctx.reg.sendMRV(destField.value, Web3Utils.toWei(valueField.value, 'ether')).then(() => {
            // Report success
            throbber.succeed(sendMRVThrobber)
            // Re-enable form
            valueField.disabled = false
            destField.disabled = false
            sendButton.disabled = false
          }).catch((err) => {
            // Re-enable form
            console.error(err)
            throbber.fail(sendMRVThrobber)
            valueField.disabled = false
            destField.disabled = false
            sendButton.disabled = false
          })
        })
        return sendButton
      })}
      ${placeDomNode(sendMRVThrobber)}
    `);
  }

  /// Display a commit dialog/wizard to help people commit
  showCommitDialog(keypath) {
    // Clear any old subscriptions.
    // TODO: Have a way to know when our dialog closes itself.
    this.clearSubscriptions()

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
      ${placeDomNode(() => {
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
          }).catch((err) => {
            // Report failure and let them change the deposit and try again
            console.error(err)
            throbber.fail(approveThrobber)
            depositField.disabled = false
            approveButton.disabled = false
          })
        })
        return approveButton
      })}
      ${placeDomNode(approveThrobber)}
      <h2>Step 2: Broadcast Claim</h2>
      <p>The next step in claiming your virtual real estate is to <strong>commit</strong> to your claim. Committing publishes a cryptographic hash value on the blockchain to establish that you are going to claim a piece of virtual real estate, without revealing what, specifically, you are intending to claim. The commitment will have to sit on the blockchain to "mature" for a period of time before you can actually claim the real estate. When you do reveal what you are claiming, the requirement to have a matured commitment will prevent other people from sniping your claims and stealing the real estate you were intending to claim by paying a higher gas price.</p>
      <p>Press the button below to broadcast a claim for this piece of virtual real estate. <strong>This process will give you a secret value in a file to keep. Without this value, your claim will be worthless.</strong> If you lose it, or do not save it, all you will be able to do will be to cancel the claim and try again.</p>
      ${placeDomNode(() => {
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
          }).catch((err) => {
            // Let them try claiming again
            console.error(err)
            throbber.fail(claimThrobber)
            claimButton.disabled = false
          })
        })

        return claimButton
      })}
      ${placeDomNode(claimThrobber)}
      <h2>Step 3: Wait</h2>
      <p>After broadcasting your claim, you must <strong>wait at least 24 hours</strong>. This delay is required to prevent claim sniping; it is the longest time that a malicious actor can be permitted to delay your claim transaction without compromising the security of the system. Come back tomorrow (but before 7 days, or your claim will expire and you will have to start over!).</p>
      ${placeDomNode(() => {
        // Have a button to close the dialog
        let doneButton = document.createElement('button')
        doneButton.innerText = 'Close'
        doneButton.addEventListener('click', () => {
          this.clearSubscriptions()
          dialog.closeDialog()
        })
        return doneButton
      })}
    `)

    // TODO: Make it so we don't have to remember to return DOM elements we make
    
  }

  

}


module.exports = Wallet

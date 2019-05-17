// Wallet.js: UI for managing claims, commitments, and MRV

const Web3Utils = require('web3-utils')

const FileSaver = require('file-saver')

const moment = require('moment')

// Load the code for displaying dialogs
const dialog = require('./dialog.js')

const { placeDomNode, placeText, formatWithUnits } = require('./halfact.js')

const throbber = require('./throbber.js')

const eth = require('./eth.js')

// Get the address avatar renderer
const blockies = require('ethereum-blockies')

const mv = require('macroverse')



/// Main interface to wallet functionality.
/// TODO: Should we receive events on a bus instead of waiting for people to look us up in the context and call our methods???
class Wallet {
  /// Create a new Wallet object
  constructor(context) {
    // Keep ahold of the context object, which lets us get at the Registry, which is our backend
    this.ctx = context
  }

  /// Return a DOM node which dynamically updates when the user's MRV balance changes, using the given feed to manage the subscription
  createMRVBalanceDisplay(feed) {
    let node = document.createElement('span')
    node.innerText = '??? MRV'
    feed.subscribe('mrv.balance', (balance) => {
      console.log('Got MRV balance: ', balance)
      // TODO: We need to toBN the balance because Web3Utils refuses BigNumber.
      // See https://github.com/ethereum/web3.js/blob/1f98597a60cefce0e560cce33b0fff7f7957b52e/packages/web3-utils/src/index.js#L196
      // See also: https://github.com/ethereum/web3.js/issues/2468
      node.innerText = Web3Utils.fromWei(Web3Utils.toBN(balance)) + ' MRV'
    })
    return node
  }

  /// Return a DOM node which displays a time that depends on the commitment maturation time, which is retrieved from the given feed.
  /// Factor expresses the time to display, in multiples of the commitment maturation time.
  createTimeDisplay(feed, factor) {
    if (!factor) {
      // Default to a multiple of 1
      factor = 1
    }

    let node = document.createElement('span')
    node.innerText = '??? days'

    feed.subscribe('reg.commitmentMinWait', (waitSeconds) => {
      // When we get the commitment maturation time from the chain
      // Format our time and put it in the node.
      node.innerText = moment.duration(waitSeconds * factor, 'seconds').humanize()
    })

    return node
  }

  /// Return a DOM node which displays the wait time for commitments to mature, read from the given feed.
  createMaturationTimeDisplay(feed) {
    return this.createTimeDisplay(feed, 1)
  }

  /// Return a DOM node which displays the wait time for commitments to expire, read from the given feed.
  createExpirationTimeDisplay(feed) {
    return this.createTimeDisplay(feed, mv.COMMITMENT_MAX_WAIT_FACTOR)
  }
  
  /// Create a token display LI element to put in the UL of owned tokens in the wallet.
  /// Has controls for the token.
  /// Note that it will need to update to a completely different token if tokens before it in the enumeration change.
  createOwnedTokenDisplay(feed, index) {
    // Make the element to display the token
    let tokenDisplay = document.createElement('li')

    // Make a feed that we can subscribe to token properies on.
    // We will re-make it every time the token changes.
    // When the parent feed goes away, it will too.
    let tokenFeed = feed.derive()

    // Render it
    tokenDisplay.innerText = '???'
    feed.subscribe('reg.' + eth.get_account() + '.tokens.' + index, (token) => {
      // Unsubscribe the old token feed
      tokenFeed.unsubscribe()

      // Make a new one to ask for info about this particular token
      tokenFeed = feed.derive()
      
      if (token == 0) {
        // They don't actually have this token
        tokenDisplay.innerText = 'N/A'
        return
      }

      // Otherwise it is a real token
      let keypath = mv.tokenToKeypath(token)
      let hex = '0x' + token.toString(16)

      // Make throbbers
      let releaseThrobber = throbber.create()
      let sendThrobber = throbber.create()
      let homesteadingThrobber = throbber.create()

      // Make an input for entering an address to send to.
      // We make it manually to avoid having to give it an ID.
      let sendDest = document.createElement('input')
      sendDest.setAttribute('placeholder', '0xDeAdBeEf...')
      sendDest.setAttribute('id', 'send' + hex)

      // Make an (aria-only) label for the destination box.
      let sendDestLabel = document.createElement('label')
      sendDestLabel.setAttribute('for', sendDest.id)
      sendDestLabel.innerText='Send to address:'
      sendDestLabel.setAttribute('aria-hidden', false)
      sendDestLabel.style.display='none'

      // Make a button for doing the send
      let sendButton = document.createElement('button')
      sendButton.innerText = '🎁 Give'
      sendButton.addEventListener('click', () => {
        let dest = sendDest.value
        if (confirm('Are you sure you want to give away ' + keypath + ' to ' + dest + '?')) {
          sendButton.disabled = true
          sendDest.disabled = true
          throbber.start(sendThrobber)

          this.ctx.reg.sendToken(dest, keypath).then(() => {
            // Token is owned by someone else
            // Unless someone else is still us.
            // So re-enable the UI
            throbber.succeed(sendThrobber)
            sendDest.value = ''
            sendButton.disabled = false
            sendDest.disabled = false
          }).catch((e) => {
            console.error('Could not give ' + keypath + ' to ' + dest, e)
            throbber.fail(sendThrobber)
            sendButton.disabled = false
            sendDest.disabled = false
          })
        }
      })

      // Make a place to put the destination blocky icon
      let destIconHolder = document.createElement('span')
      destIconHolder.classList.add('blocky-holder')

      // Only let people hit the send button if they enter an address that
      // checksums. Also keep the dest icon up to date.
      sendButton.disabled = true
      sendButton.setAttribute('title', 'Enter a valid, checksummed address')
      sendDest.addEventListener('input', () => {
        let dest = sendDest.value
        if (Web3Utils.checkAddressChecksum(dest)) {
          sendButton.disabled = false
          sendButton.setAttribute('title', 'Give away virtual real estate to ' + dest)
          destIconHolder.innerHTML = ''
          destIconHolder.appendChild(blockies.create({seed: dest.toLowerCase()}))
        } else {
          sendButton.disabled = true
          sendButton.setAttribute('title', 'Enter a valid, checksummed address')
          destIconHolder.innerHTML = ''
        }
      })

      // Define a deposit display
      let depositDisplay = document.createElement('span')
      tokenFeed.subscribe(keypath + '.deposit', (deposit) => {
        // We need the base int he toString or we get exponential format instead of digits.
        depositDisplay.innerText = Web3Utils.fromWei(deposit.toString(10)) + ' MRV'
      })

      // Homesteading is only important for things above land
      // We fill in this string with code for a homesteading control if we are not ourselves land.
      let homesteadingUI = ''

      if (!mv.keypathIsLand(keypath)) {

        // Define a homesteading toggle
        let homesteadingControl = document.createElement('select')
        homesteadingControl.innerHTML = `
          <option value="0">🚫 PROHIBIT homesteading by others</option>
          <option value="1">👍🏾 ALLOW homesteading by others</option>
        `
        homesteadingControl.addEventListener('input', () => {
          // We want to turn homesteading on or off.
          let newState = homesteadingControl.value == 1

          if (newState && !confirm('Are you sure you want to allow other people ' +
            'to claim virtual real estate within ' + keypath + ' for themselves? ' +
            'They, and not you, will own any real estate they claim.')) {
            
            // User aborted enabling homesteading
            // Set the UI back
            homesteadingControl.value = 0
            // Don't go on to send the transaction
            return
          }

          homesteadingControl.disabled = true
          throbber.start(homesteadingThrobber)
          this.ctx.reg.setHomesteading(keypath, newState).then(() => {
            // Homesteading has been set
            throbber.succeed(homesteadingThrobber)
            homesteadingControl.disabled = false
          }).catch((e) => {
            console.error('Could not set homesteading to ' + newState + ' on ' + keypath, e)
            throbber.fail(homesteadingThrobber)
            homesteadingControl.disabled = false
          })
        })

        tokenFeed.subscribe(keypath + '.homesteading', (homesteadingAllowed) => {
          // Update the UI to reflect the chain state
          homesteadingControl.value = homesteadingAllowed ? 1 : 0
        })

        // Fill in the string that goes into the final UI for the token
        homesteadingUI = placeDomNode(homesteadingControl) + placeDomNode(homesteadingThrobber)
      }

      tokenDisplay.innerHTML = `
        ${keypath} (${hex})
        ${placeDomNode(() => {
          let goToButton = document.createElement('button')
          goToButton.innerText = '🎯 Go To'
          goToButton.addEventListener('click', () => {
            // Go look at the thing
            this.ctx.emit('show', keypath)
            dialog.closeDialog()
          })
          return goToButton
        })}
        ${homesteadingUI}
        <span class="address-widget">
          ${placeDomNode(sendDestLabel)}
          ${placeDomNode(sendDest)}
          ${placeDomNode(destIconHolder)}
        </span>
        ${placeDomNode(sendButton)}
        ${placeDomNode(sendThrobber)}
        Deposit: ${placeDomNode(depositDisplay)}
        ${placeDomNode(() => {
          let releaseButton = document.createElement('button')
          releaseButton.innerText = '♻️ Release'
          releaseButton.addEventListener('click', () => {
            if (confirm('Are you sure you want to release ' + keypath + ' to be claimed by others? You will no longer own it, but you will get your deposit back.')) {
              releaseButton.disabled = true
              throbber.start(releaseThrobber)
              
              this.ctx.reg.releaseToken(keypath).then(() => {
                // Token is released and should go away.
                // Don't re-enable anything.
                throbber.succeed(releaseThrobber)
              }).catch((e) => {
                console.error('Could not release ' + keypath, e)
                throbber.fail(releaseThrobber)
                releaseButton.disabled = false
              })
            }
          })
          return releaseButton
        })}
        ${placeDomNode(releaseThrobber)}
      `
      // TODO: showing associated deposit and homesteading status requires
      // making more subscriptions in a sort of subfeed that we can clear out
      // when the token we are supposed to be displaying changes.
    })

    return tokenDisplay
  }

  /// Display a general wallet dialog to allow sending tokens and canceling commitments
  showWalletDialog() {
    // Prepare a feed to manage subscriptions for this dialog display
    let feed = this.ctx.reg.create_feed()
    
    // Preapre throbbers for the form
    let sendMRVThrobber = throbber.create()

    // Prepare a place for the destination icon
    let destIconHolder = document.createElement('span')
    destIconHolder.classList.add('blocky-holder')

    // Prepare destination field
    // TODO: unify with NFT token send field
    let sendDest = document.createElement('input')
    sendDest.id = 'mrv-destination'
    sendDest.setAttribute('placeholder', '0xDeAdBeEf...')

    // Prepare a send button
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

      let wholeMRV = valueField.value
      if (isNaN(wholeMRV) || wholeMRV == '') {
        // Fail early
        throbber.fail(sendMRVThrobber)
        valueField.disabled = false
        destField.disabled = false
        sendButton.disabled = false
        return
      }
      // TODO: just watch the amount field as well...
      
      try {
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
      } catch (err) {
        // Collect errors from e.g. toWei
        console.error('Could not send MRV', err)
        throbber.fail(sendMRVThrobber)
        valueField.disabled = false
        destField.disabled = false
        sendButton.disabled = false
      }
    })

    // Only let people hit the send button if they enter an address that
    // checksums. Also keep the dest icon up to date.
    sendButton.disabled = true
    sendButton.setAttribute('title', 'Enter a valid, checksummed address')
    sendDest.addEventListener('input', () => {
      let dest = sendDest.value
      if (Web3Utils.checkAddressChecksum(dest)) {
        sendButton.disabled = false
        sendButton.setAttribute('title', 'Send MRV to ' + dest)
        destIconHolder.innerHTML = ''
        destIconHolder.appendChild(blockies.create({seed: dest.toLowerCase()}))
      } else {
        sendButton.disabled = true
        sendButton.setAttribute('title', 'Enter a valid, checksummed address')
        destIconHolder.innerHTML = ''
      }
    })
    // TODO: Unify with checksum and icon logic for NFT token transfer

    dialog.showDialog('Wallet', `
      <p>This wallet allows you to send and receive MRV tokens and Macroverse virtual real estate, and to manage your real estate claim commitments.</p>
      <h2>Your MRV balance: ${placeDomNode(this.createMRVBalanceDisplay(feed))}</h2>
      <p>
        Remember that you need at least <b>100 MRV</b> to access Macroverse.
        If you drop below that balance, <b>you will no longer be able to access the Macroverse world!</b>
      </p>
      <h3>Receive MRV</h3>
      <p>
        Receiving address:
        <span class="address-widget">
          <span class="address">${Web3Utils.toChecksumAddress(eth.get_account())}</span>
          <span class="blocky-holder">${placeDomNode(blockies.create({seed: eth.get_account()}))}</span>
        </span>
      </p>
      <h3>Send MRV</h3>
      <label for="mrv-destination">Destination:</label>
      <span class="address-widget">
        ${placeDomNode(sendDest)}
        ${placeDomNode(destIconHolder)}
      </span>   
      <label for="mrv-amount">MRV:</label>
      <input id="mrv-amount" placeholder="0.01"/>
      ${placeDomNode(sendButton)}
      ${placeDomNode(sendMRVThrobber)}
      <h2>Your Virtual Real Estate</h2>
      ${placeDomNode(() => {
        // Make a place to hold a list of tokens
        let tokenListHolder = document.createElement('div')
        // Here is the possibly empty list
        let tokenList = document.createElement('ul')
        tokenListHolder.appendChild(tokenList)

        // Here is some text explaining that it is empty if it is empty
        let tokenListEmpty = document.createElement('p')
        tokenListEmpty.innerText = 'You do not own any Macroverse virtual real estate.'
        tokenListHolder.appendChild(tokenListEmpty)

        // Keep a list of individual token feeds
        let tokenFeeds = []
        
        // We make sure this list always has the right number of entries that fill themselves in
        feed.subscribe('reg.' + eth.get_account() + '.tokens', (tokenCount) => {
          // Show the no tokens message only when there are no tokens
          if (tokenCount > 0) {
            tokenListEmpty.style.display = 'none'
          } else {
            tokenListEmpty.style.display = 'block'
          }

          // And keep the list populated with the right number of elements
          while (tokenList.children.length > tokenCount) {
            // Drop the last item until we are down
            tokenList.removeChild(tokenList.lastChild)
            // Drop the last feed
            tokenFeeds.pop().unsubscribe()
          }
          while (tokenList.children.length < tokenCount) {
            // Create new token displays
            let tokenFeed = this.ctx.reg.create_feed()

            // Work out the token index to show
            let tokenIndex = tokenList.children.length

            // Make a control to render it
            let tokenDisplay = this.createOwnedTokenDisplay(feed, tokenIndex)
            
            // Show it and remember its feed
            tokenList.appendChild(tokenDisplay)
            tokenFeeds.push(tokenFeed)
          }
        })

        return tokenListHolder
      })}
      ${placeDomNode(() => {
        // Have a button to close the dialog
        let doneButton = document.createElement('button')
        doneButton.innerText = 'Finish'
        doneButton.classList.add('done')
        doneButton.addEventListener('click', () => {
          dialog.closeDialog()
        })
        return doneButton
      })}
    `, () => {
      // Dialog is closed, close out the feed
      feed.unsubscribe()
    });
  }

  /// Display a commit dialog/wizard to help people commit
  showCommitDialog(keypath) {
    // Prepare a feed to manage subscriptions for this dialog display
    let feed = this.ctx.reg.create_feed()

    // Create an input for getting the user's deposit
    let depositInput = document.createElement('input')
    depositInput.setAttribute('id', 'deposit')
    depositInput.value = '???'

    // Track the min deposit for this item in MRV-wei
    let minDeposit = 0

    // Make a separate display for it
    let minDepositDisplay = document.createElement('span')
    minDepositDisplay.innerText = '???'


    // Go get it form the chain, since the scale is configurable
    feed.subscribe(keypath + '.minDeposit', (newMinDeposit) => {
      // When the min deposit finally arrives (or changes)
      
      // Remember the update for validation
      minDeposit = newMinDeposit

      // And for display to the user
      minDepositDisplay.innerText = Web3Utils.fromWei(minDeposit.toString(10))
      
      // Plug it in to the input field IF we haven't done that already.
      if (depositInput.value == '???') {
        depositInput.value = Web3Utils.fromWei(minDeposit.toString(10))
      }
    })

    // Track user's balance, for guessing if they will run out of money
    let userBalance = 0
    feed.subscribe('mrv.balance', (balance) => {
      userBalance = balance
    })

    // Make a deposit approval throbber
    let approveThrobber = throbber.create()

    // And a throbber for claim creation
    let claimThrobber = throbber.create()

    // And a button to go right to the claims view
    let extraClaimsButton = document.createElement('button')
    extraClaimsButton.innerText = '⛳ Claims'
    extraClaimsButton.addEventListener('click', () => {
      ctx.wallet.showClaimsDialog()
    })

    dialog.showDialog('Commit for ' + keypath, `
      <p>This wizard will guide you through the process of claiming ownership of ${keypath}</p>
      <h2>Step 1: Choose and Authorize Deposit</h2>
      <p>In order to own Macroverse virtual real estate, you need to put up a <strong>deposit</strong> in MRV. That deposit is locked up when you commit for an ownership claim, and returned when you cancel the commitment, or when you release your ownership of the claimed real estate. The minimum deposit value for the object you are trying to claim is <b>${placeDomNode(minDepositDisplay)} MRV</b>, but you may make a larger deposit. You must authorize the Macroverse registry to take this MRV from your account.</p>
      <label for="deposit">Deposit in MRV:</label>
      ${placeDomNode(depositInput)}
      ${placeDomNode(() => {
        let approveButton = document.createElement('button')
        approveButton.innerText = 'Approve'
        approveButton.addEventListener('click', () => {
          // Start the throbber
          throbber.start(approveThrobber)

          let approveDeposit = 0

          // Parse the deposit
          try {
            approveDeposit = Web3Utils.toWei(depositInput.value, 'ether')
      
            // Make sure to do comparison using bignumber methods
            if (minDeposit.gt(approveDeposit)) {
              // Deposit is too small!
              throbber.fail(approveThrobber)
              // Fix it up
              depositInput.value = Web3Utils.fromWei(minDeposit.toString(10))
              return
            }

            if (userBalance != 0) {
              // We know a user balance. See if this deposit would take the user below 100 MRV
              // TODO: don't hardcode this.
              let minBalanceThreshold = Web3Utils.toWei('100', 'ether')

              let newBalance = userBalance.minus(approveDeposit)

              if (newBalance.lt(minBalanceThreshold)) {
                // They would not have enough MRV left to use this tool
                // This also catches deposits larger than the money you have
                alert('You should not make a deposit that would put your balance below 100 MRV, the minimum balance required to access Macroverse. ' +
                  'The deposit you entered would leave you with only ' + Web3Utils.fromWei(newBalance.toString(10)) + ' MRV.')
                throbber.fail(approveThrobber)
                return
              }
            }
          } catch (e) {
            console.error('Error processing deposit', e)
            throbber.fail(approveThrobber)
            return
          }

          console.log('Approve ', approveDeposit, ' vs ', minDeposit)

          // Otherwise, actually send the transaction.
          // Don't let the user fiddle while we do it.
          depositInput.disabled = true
          approveButton.disabled = true

          // Actually send the approval transaction. Metamask or other user agent should prompt to confirm.
          this.ctx.reg.approveDeposit(approveDeposit).then(() => {
            // Report success
            throbber.succeed(approveThrobber)
            
            // Commit back to text box in case user was editing it when they hit the button
            depositInput.value = Web3Utils.fromWei(approveDeposit.toString(10))

          }).catch((err) => {
            // Report failure and let them change the deposit and try again
            console.error(err)
            throbber.fail(approveThrobber)
            depositInput.disabled = false
            approveButton.disabled = false
          })
        })
        return approveButton
      })}
      ${placeDomNode(approveThrobber)}
      <h2>Step 2: Broadcast Claim</h2>
      <p>The next step in claiming your virtual real estate is to <strong>commit</strong> to your claim. Committing publishes a cryptographic hash value on the blockchain to establish that you are going to claim a piece of virtual real estate, without revealing what, specifically, you are intending to claim. The commitment will have to sit on the blockchain to "mature" for a period of time before you can actually claim the real estate. When you do reveal what you are claiming, the requirement to have a matured commitment will prevent other people from sniping your claims and stealing the real estate you were intending to claim by paying a higher gas price.</p>
      <p>Press the button below to broadcast a claim for this piece of virtual real estate. <strong>This process will give you a secret value in a file to keep. Without this value, your claim will be worthless</strong> and <strong>your deposit <u>will not be recoverable</u> through this application</strong>. If you lose this file, or do not save it, <strong>you will not get your virtual real estate</strong> and <strong>you will have to manually cancel the claim</strong> by interacting directly with the on-chain registry contract.</p>
      ${placeDomNode(() => {
        let claimButton = document.createElement('button')

        claimButton.innerText = 'Claim'

        claimButton.addEventListener('click', () => {
          claimButton.disabled = true
          // Start the throbber
          throbber.start(claimThrobber)

          // Make the claim with the chain
          this.ctx.reg.createClaim(keypath, Web3Utils.toWei(depositInput.value, 'ether')).then((claimData) => {
            // Save the claim info including nonce. TODO: would be good to do this first.
            FileSaver.saveAs(new Blob([JSON.stringify(claimData)], {type: 'application/json;charset=utf-8'}), 'claim.' + keypath + '.json')

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
      <p>After broadcasting your claim, you must <strong>wait ${placeDomNode(this.createMaturationTimeDisplay(feed))} for your claim to mature</strong>, but <strong> no more than ${placeDomNode(this.createExpirationTimeDisplay(feed))} or your claim will expire</strong>. Maturation and expiration are required to prevent claim snipers from front-running your reveal transaction.</p>
      <h2>Step 4: Reveal</h2>
      <p>After ${placeDomNode(this.createMaturationTimeDisplay(feed))}, you can use the file you got in Step 2 to reveal your claim and actually take ownership of your virtual real estate. Click on the ${placeDomNode(extraClaimsButton)} button here or in the toolbar at the lower right of the main Macroverse Explorer window, and provide the file in the resulting form.</p>
      ${placeDomNode(() => {
        // Have a button to close the dialog
        let doneButton = document.createElement('button')
        doneButton.innerText = 'Finish'
        doneButton.classList.add('done')
        doneButton.addEventListener('click', () => {
          dialog.closeDialog()
        })
        return doneButton
      })}
    `, () => {
      // Dialog is closed, close out the feed
      feed.unsubscribe()
    })
  }

  /// Display a dialog to help people manage claims (cancel/reveal)
  showClaimsDialog() {
    // Prepare a feed to manage subscriptions for this dialog display
    let feed = this.ctx.reg.create_feed()

    // Make a claim data parse throbber
    let parseThrobber = throbber.create()

    // And a reveal throbber 
    let revealThrobber = throbber.create()

    // And a cancel throbber
    let cancelThrobber = throbber.create()

    // Make all the buttons and inputs that need to interact
    let picker = document.createElement('input')
    let revealButton = document.createElement('button')
    let cancelButton = document.createElement('button')

    // This will hold the claim data when we load it
    let claimData = null

    // This will show info about the claim and update when it updates
    let claimDataView = document.createElement('div')
    claimDataView.innerHTML = '<p>Provide a claim file to see claim data.</p>'
    // Give it its own feed
    let claimDataFeed = undefined
    // This will update the claim data view when the claim is changed
    let updateClaimDataView = () => {
      // Clobber the old feed and set up a new one
      if (claimDataFeed) {
        claimDataFeed.unsubscribe()
      }
      claimDataFeed = this.ctx.reg.create_feed()


      // Pack the keypath into a token
      let token = mv.keypathToToken(claimData.keypath)
      // Determine the claim hash
      let hash = mv.hashTokenAndNonce(token, claimData.nonce)

      // Determine the keypath at which the Registry exposes info about the claim
      let claimKeypath = 'commitment.' + claimData.account + '.' + hash

      // Build a table to show the claim info.
      // TODO: Remove old subscriptions when updating the view for a new claim data file
      claimDataView.innerHTML = `
        <table>
          <tr>
            <td>Account</td>
            <td>${placeText(Web3Utils.toChecksumAddress(claimData.account))}</td>
          </tr>
          <tr>
            <td>Keypath</td>
            <td>${placeText(claimData.keypath)}</td>
          </tr>
          <tr>
            <td>Nonce</td>
            <td>${placeText(claimData.nonce)}</td>
          </tr>
          <tr>
            <td>Claim Creation Time</td>
            <td>${placeDomNode(() => {
              let timeNode = document.createElement('span')
              timeNode.innerText = '???'

              feed.subscribe(claimKeypath + '.creationTime', (creationTime) => {
                if (creationTime == 0) {
                  // Claim does not exist
                  timeNode.innerText = 'N/A'
                } else {
                  // When the claim creation time of this person's claim for this thing with this nonce is available or updates, fill it in.
                  timeNode.innerText = creationTime
                }
              })

              return timeNode
            })}</td>
          </tr>
          <tr>
            <td>Claim Status</td>
            <td>${placeDomNode(() => {
              let ageNode = document.createElement('span')
              ageNode.classList.add('status')
              ageNode.innerText = '???'

              feed.subscribeAll(['block.timestamp', claimKeypath + '.creationTime', 'reg.commitmentMinWait'], ([timestamp, creationTime, minWait]) => {
                if (creationTime == 0) {
                  // The commitment does not exist. Probably it has been revealed or canceled.
                  ageNode.innerText = 'Already revealed or not yet created. Does not need to be revealed or canceled.'
                  ageNode.classList.remove('valid')
                  ageNode.classList.add('invalid')

                  // Don't let them reveal or cancel
                  revealButton.disabled = true
                  cancelButton.disabled = true
                } else {
                  // It exists, so it can be canceled
                  cancelButton.disabled = false

                  // Keep track of the age as a difference
                  let age = timestamp - creationTime
                  // Work out the bounds
                  let maxWait = minWait * mv.COMMITMENT_MAX_WAIT_FACTOR

                  if (age < minWait) {
                    // Say it is not mature yet
                    let maturesIn = minWait - age
                    ageNode.innerText = 'Matures ' + moment.duration(maturesIn, 'seconds').humanize(true) +
                      '. Do not proceed until then!'
                    ageNode.classList.remove('valid')
                    ageNode.classList.remove('invalid')
                    ageNode.classList.add('pending')

                    // Don't let the user reveal early
                    revealButton.disabled = true
                  } else if (age > maxWait) {
                    // Say it has expired
                    let expiredFor = age - maxWait
                    ageNode.innerText = 'Expired ' + moment.duration(-expiredFor, 'seconds').humanize(true) +
                      '. Go to In Case of Emergency and cancel the claim!'
                    ageNode.classList.remove('valid')
                    ageNode.classList.add('invalid')
                    ageNode.classList.remove('pending')

                    // Don't let the user reveal late
                    revealButton.disabled = true
                  } else {
                    // Say it is currently mature but will expire
                    let expiresIn = maxWait - age
                    ageNode.innerText = 'Mature; expires ' + moment.duration(expiresIn, 'seconds').humanize(true) +
                      '. Go to Step 2 now!'
                    ageNode.classList.add('valid')
                    ageNode.classList.remove('invalid')
                    ageNode.classList.remove('pending')

                    // Let the user reveal while valid
                    revealButton.disabled = false
                  }
                }
              })

              return ageNode
            })}</td>
          </tr>
        </table>
      `
    }

    picker.setAttribute('type', 'file')
    picker.setAttribute('accept', 'application/json')
    picker.addEventListener('input', () => {
      console.log('Claim file selected')
      throbber.start(parseThrobber)

      // Find the files we were given
      let files = picker.files

      // Disable the picker
      picker.disabled = true

      if (files.length == 1) {
        // Load the JSON from the file
        let reader = new FileReader()
        reader.addEventListener('error', (e) => {
          // Report the error
          console.error('Error reading claim file', e)
          
          // Let the user try again
          revealButton.disabled = true
          cancelButton.disabled = true
          picker.disabled = false

          throbber.fail(parseThrobber)
        })

        reader.addEventListener('load', () => {
          // Now we have the JSON claim data available. Probably.
          let json = reader.result

          try {
            // Parse into our dialog-scope claim data variable
            claimData = JSON.parse(json)

            console.log('Claim data:', claimData)

            // TODO: Validate the claim

            // Display the claim data
            updateClaimDataView()

            // Enable the cancel step now.
            // But don't enable the reveal until it appears to be mature
            cancelButton.disabled = false

            // Let the user switch to a new file now that validation is done
            picker.disabled = false

            throbber.succeed(parseThrobber)
          } catch (e) {
            // There's something wrong with the JSON
            console.error('Error parsing claim file', e)

            claimDataView.innerText = 'Claim file is invalid. Please select a .json file produced by the Macroverse Explorer.' 

            // Let the user try again
            revealButton.disabled = true
            cancelButton.disabled = true
            picker.disabled = false

            throbber.fail(parseThrobber)
          }
        })

        // Kick off the reader with the file we were given
        reader.readAsText(files[0])

      } else {
        // We got no files or multiple files. Let the user try again.
        revealButton.disabled = true
        cancelButton.disabled = true
        picker.disabled = false
        console.log('Received no files or multiple files')
        throbber.fail(parseThrobber)
      }
    })

    revealButton.disabled = true
    revealButton.innerText = 'Reveal Claim'
    revealButton.addEventListener('click', () => {
      // When the user hits reveal

      // Stop them doing things twice
      revealButton.disabled = true
      cancelButton.disabled = true
      picker.disabled = true
      throbber.start(revealThrobber)

      // Try the reveal
      this.ctx.reg.revealClaim(claimData).then(() => {
        // The reveal worked
        throbber.succeed(revealThrobber)
        // Let them start again
        picker.disabled = false
      }).catch((e) => {
        // Claim did not reveal successfully
        console.error('Error revealing claim', e)
        throbber.fail(revealThrobber)

        // Let them do something else
        revealButton.disabled = false
        cancelButton.disabled = false
        picker.disabled = false
      })
    })

    cancelButton.disabled = true
    cancelButton.innerText = 'Cancel Claim'
    cancelButton.addEventListener('click', () => {
      // When the user hits cancel

      // Stop them doing things twice
      revealButton.disabled = true
      cancelButton.disabled = true
      picker.disabled = true
      throbber.start(cancelThrobber)

      // Try the cancel
      this.ctx.reg.cancelClaim(claimData).then(() => {
        // The cancel worked
        throbber.succeed(cancelThrobber)
        // Let them start again
        picker.disabled = false
      }).catch((e) => {
        // Claim did not cancel successfully
        console.error('Error canceling claim', e)
        throbber.fail(cancelThrobber)

        // Let them do something else
        revealButton.disabled = false
        cancelButton.disabled = false
        picker.disabled = false
      })
  })

    dialog.showDialog('Manage Claims', `
      <p>This dialog will walk you through revealing or canceling a claim on a piece of virtual real estate that you committed to earlier.</p>
      <p>If you do not yet have a claim file, close this dialog, and navigate to the object in the Macroverse world which you want to own (star, planet, or moon) using the main Macroverse Explorer interface. When you have found an unowned object you want, click on the "Claim" button in the "Owner" row of the infobox table on the right side of the screen.</p>
      <h2>Step 1: Provide Claim File</h2>
      <p>Select the claim file you received when you committed.</p>
      <label for="claimFile">Claim File (.json):</label>
      ${placeDomNode(picker)}
      ${placeDomNode(parseThrobber)}
      <h3>Claim Data</h3>
      ${placeDomNode(claimDataView)}
      <h2>Step 2: Reveal Claim</h2>
      <p>By clicking the button below, you can reveal the identity of the piece of virtual real estate that your claim is for to the general public. If you do this for a claim that has matured and has not expired, you will take ownership of the piece of virtual real estate in question.</p>
      ${placeDomNode(revealButton)}
      ${placeDomNode(revealThrobber)}
      <h2>In Case of Emergency: Cancel Claim</h2>
      <p>If something goes wrong with your claim (for example, if you accidentally let it expire, or if someone else reveals a conflicting claim), you can cancel it with the button below.</p>
      <p><strong>You will no longer be able to use your claim to take ownership of the piece of virtual real estate in question</strong> after you cancel it. If you want the virtual real estate, you will have to start a new claim from scratch.</p>
      ${placeDomNode(cancelButton)}
      ${placeDomNode(cancelThrobber)}
      <p>After successfully revealing or canceling your claim, you no longer need the claim file.</p>
      ${placeDomNode(() => {
        // Have a button to close the dialog
        let doneButton = document.createElement('button')
        doneButton.innerText = 'Finish'
        doneButton.classList.add('done')
        doneButton.addEventListener('click', () => {
          dialog.closeDialog()
        })
        return doneButton
      })}
    `, () => {
      // Dialog is closed, close out the feed
      feed.unsubscribe()
      if (claimDataFeed) {
        claimDataFeed.unsubscribe()
      }
    })
  }
}

module.exports = Wallet

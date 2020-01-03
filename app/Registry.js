/// Registry.js: Javascript interface for the Macroverse Universal Registry
/// which allows subscribing to ownership update events for token keypaths,
/// creating, revealing, and canceling commitments, and sending ERC721 tokens
/// representing Macroverse virtual real estate.
/// Also handles making MRV transactions and reporting MRV balances.

// Load up the facade over web3 and truffle-contract
const eth = require('./eth.js')

// And the keypath manipulatioin code
const { getKeypath, setKeypath, firstComponent, lastComponent, parentOf, allParentsOf, componentCount, splitKeypath } = require('./keypath.js')

// And the event emitter which we use to structure our API
const { EventEmitter2 } = require('eventemitter2')

const mv = require('macroverse')

// The actual Registry class. External interface.
// Events are associated with keypaths.
// Right now the only event is <whatever>.owner, which corresponds to the owner
// of the given Macroverse world object or plot of land. If the item is
// unowned, it is 0.
class Registry extends EventEmitter2 {
  // Construct a Registry using the specified base path for fetching contracts. 
  constructor(basePath) {
    super()

    // EventEmitter has Strong Opinions on how many clients we ought to have.
    // Override them.
    // TODO: Are we actually leaking memory/listeners?
    this.setMaxListeners(100000)

    // Save the base path
    this.basePath = basePath

    // Make a place to put the registry contract 
    this.reg = undefined
    // And the MRV token contract for approvals
    this.mrv = undefined

    // If we end up using the testnet MRV token, we have minting support for
    // test purposes. Otherwise not. This flag will reflect that.
    this.canMintMRV = undefined

    // Make a cache from keypath to last known value.
    // We only do in memory cacheing; we get everything from the chain on every run since it's not much data.
    this.cache = {}

    // This counts how many listeners we have subscribed to each keypath, so we
    // can know when to create/destroy Ethereum listeners.
    this.subscriberCount = {}

    // This holds outstanding Ethereum watch filters by the keypath they back.
    // Each entry is an array because more than one filter may be necessary to support a keypath.
    this.watchers = {}

    // Say we aren't initializing yet
    this.initPromise = undefined
    // Kick off async initialization
    this.init();
  }

  // Returns a promise for the async object initialization, kicked off by the constructor.
  // Resolves when the initialization is complete.
  init() {
    // Asynchronous initialization logic
    if (this.initPromise == undefined) {
      // We aren't initializing yet
      this.initPromise = (async () => {
        // Do the actual init work here.

        // Find the contract instances
        [this.reg, this.real, this.mrv] = await Promise.all([
          eth.get_instance(this.getContractPath('MacroverseUniversalRegistry')),
          eth.get_instance(this.getContractPath('MacroverseRealEstate')), 
          eth.get_instance(this.getContractPath('TestnetMRVToken')).then((x) => {
            // If it works, remember that
            this.canMintMRV = true
            return x
          }).catch(() => {
            // If no TestnetMRVToken is available, use the normal version, and remember that.
            this.canMintMRV = false
            return eth.get_instance(this.getContractPath('MRVToken'))
          })])
      })()
    }
    return this.initPromise
  }

  // Get the full relative URL to the JSON file for the contract, given its name (e.g. MacroverseUniversalRegistry).
  // TODO: Univy this with what the Datasource has somehow. Make a common base class?
  getContractPath(contractName) {
    // Only use the separating slash if we have a path component to separate from.
    // Otherwise we would be asking for /whatever.json at the web server root.
    return this.basePath + (this.basePath != '' ? '/' : '') + contractName + '.json'
  }

  // Get a feed to manage a bundle of subscriptions.
  // This is preferred over direct subscribe/unsubscribe
  create_feed() {
    return new Feed(this)
  }

  // Subscribe to events at the given keypath. Handler will be called with the
  // initial value of the keypath, and subsequently with new values as events
  // come from the chain. Returns a subscription value that can be passed back
  // to unsubscribe *exactly once* to stop listening. 
  //
  // May not be called multiple times for the same event and function without
  // intervening unsubscribe calls.
  //
  // You probably shouldn't use this directly; use a Feed instead.
  subscribe(keypath, handler) {
    console.log('Subscribing to ' + keypath)

    // Wrap the handler to report errors
    let wrappedHandler = (val) => {
      try {
        handler(val)
      } catch (err) {
        console.error('Error in Registry subscriber for ' + keypath + ':', err)
      }
    }

    // Listen for the event
    this.on(keypath, wrappedHandler)

    if (this.subscriberCount[keypath]) {
      // This keypath is already being listened to
      this.subscriberCount[keypath]++
    } else {
      // This is the first subscriber to this keypath.
      // Begin listening for updates to the item from the chain
      this.watchChain(keypath)
      this.subscriberCount[keypath] = 1
    }

    if (this.cache.hasOwnProperty(keypath)) {
      // If we have the current value cached, emit it at once.
      console.log('Registry has ' + keypath + ' in cache')
      this.emit(keypath, this.cache[keypath])
    } else {
      // We don't have it

      console.log('Registry needs to go get ' + keypath)

      // See if that fires before we can get an initial value
      let gotValueAlready = false
      // Make sure that we won't announce a stale value if an event comes in between the request and the reply.
      let catchEvent = (val) => {
        gotValueAlready = true
        this.cache[keypath] = val
      }
      this.once(keypath, catchEvent)

      // Kick off something to get an initial value, and emit that if it arrives before any updates.
      this.retrieveFromChain(keypath).then((val) => {
        if (!gotValueAlready) {
          // We won the race against the listener
          this.off(keypath, catchEvent)
          this.cache[keypath] = val
          this.emit(keypath, val)
        }
        // Otherwise the listener won and removed itself. Drop the value we just got.
      })
    }

    // The subscription is just the keypath and the handler, because the
    // backing EventEmitter2 has each function subscribe to each event up to
    // once.
    return [keypath, wrappedHandler]

  }

  // Remove a subscription created by subscribe.
  // May be called at most once per subscription!
  unsubscribe(subscription) {
    let [keypath, handler] = subscription

    this.off(keypath, handler)

    if (this.subscriberCount[keypath] > 1) {
      // This keypath is still being listened to
      this.subscriberCount[keypath]--
    } else if (this.subscriberCount[keypath] == 1) {
      // This is the last subscriber to this keypath.
      // Stop listening for updates to the item from the chain
      this.unwatchChain(keypath)
      this.subscriberCount[keypath] = 0
      // Clear the cache since it is no longer being kept up to date
      delete this.cache[keypath]
    } else {
      // The client has gotten confused in matching their subscribes and unsubscribes
      throw new Error('Too many unsubscribes for event ' + keypath)
    }
  }

  // Return a promise for the value represented by the given keypath
  async retrieveFromChain(keypath) {
    console.log('Getting initial value for ' + keypath)
    if (firstComponent(keypath) == 'commitment') {
      // Format is 'commitment.{owner}.{hash}.("hash"|"deposit"|"creationTime")'
      // If the commitment doesn't exist, everything will resolve to 0.

      let wanted = lastComponent(keypath)
      if (wanted != 'hash' && wanted != 'deposit' && wanted != 'creationTime') {
        throw new Error('Unsupported keypath ' + keypath)
      }

      let hash = lastComponent(parentOf(keypath))
      let owner = lastComponent(parentOf(parentOf(keypath)))
      // Generate the key to find it under on chain
      let key_hash = mv.getClaimKey(hash, owner)

      // Look it up on the chain. Should never throw; should just return zeroes
      let [chain_hash, deposit, creation_time] = await this.reg.commitments(key_hash)

      if (wanted == 'hash') {
        return chain_hash
      } else if (wanted == 'deposit') {
        return deposit
      } else {
        // Must be the creation time
        return creation_time
      }
    } else if (firstComponent(keypath) == 'mrv' && lastComponent(keypath) == 'balance' && lastComponent(parentOf(keypath)) != 'mrv') {
      let address = lastComponent(parentOf(keypath))
      let balance = await this.mrv.balanceOf(address)
      return balance
    } else if (keypath == 'reg.commitmentMinWait') {
      // They want the min wait time of a commitment to mature.
      let wait_seconds = (await this.reg.commitmentMinWait()).toNumber()
      return wait_seconds
    } else if (firstComponent(keypath) == 'reg') {
      // Match reg.{address}.tokens, reg.{address}.tokens.{number}
      // TODO: This is actually fulfilled by the real estate contract now, so
      // should it be real.*?
      let parts = splitKeypath(keypath)

      if (parts.length == 3 && parts[2] == 'tokens') {
        // We want the token count
        let owner = parts[1]

        let val = await this.real.balanceOf(owner)
        this.cache[keypath] = val
        this.emit(keypath, val)
      } else if (parts.length == 4 && parts[2] == 'tokens') {
        // We want token i
        let owner = parts[1]
        let index = parts[3]

        let val = undefined
        try {
          // Find the token and get it as a string in base 10 with all digits intact
          val = (await this.real.tokenOfOwnerByIndex(owner, index)).toString(10)
        } catch(e) {
          // Maybe they no longer have this many tokens
          console.error('Error getting token ' + index + ' of owner ' + owner + ', assuming 0', e)
          val = '0'
        }
        this.cache[keypath] = val
        this.emit(keypath, val)
        // TODO: deduplicate this code with the update-on-event code
      } else {
        throw new Error('Unsupported keypath ' + keypath)
      }
    } else if (keypath == 'block.timestamp') {
      // They want to watch the current network time
      let latest_timestamp = (await eth.latest_block()).timestamp
      return latest_timestamp
    } else if (['minDeposit', 'owner', 'deposit', 'homesteading'].includes(lastComponent(keypath))) {
      // We want the owner, deposit, or homesteading status of a token (not a claim)
      // Pack the token value
      let token = mv.keypathToToken(parentOf(keypath))
      
      let wanted = lastComponent(keypath)

      if (wanted == 'minDeposit') {
        // Checking the min deposit doesn't care about the owner
        let min_deposit = await this.reg.getMinDepositToCreate(token)
        return min_deposit
      } else {
        // Everything else depends on the owner
        
        // Decide if it should have an owner right now
        let owned = await this.real.exists(token)

        if (owned) {
          // We think it is owned

          if (wanted == 'owner') {
            let token_owner = await this.real.ownerOf(token).catch((err) => {
              // Maybe it became unowned while we were looking at it
              console.log('Error getting owner, assuming unowned', err)
              return 0
            })

            return token_owner
          } else if (wanted == 'deposit') {
            // This returns 0 for unowned tokens.
            let deposit = await this.reg.getDeposit(token)
            return deposit
          } else if (wanted == 'homesteading') {
            // This returns false for unowned tokens
            let homesteading = await this.reg.getHomesteading(token)
            return homesteading
          }
        } else {
          // It doesn't appear to have an owner. The answer is 0/falsey for all of them.
          return 0
        }
      }
    } else if (['ultimateOwner', 'lowestOwnedParent', 'claimable'].includes(lastComponent(keypath))) {
      // We want to know who owns the lowest owned parent, or what it is, or if
      // we can claim this thing because that parent is nonexistent, is ours,
      // or has homesteading on.

      // Pack the token value
      let token = mv.keypathToToken(parentOf(keypath))
      let wanted = lastComponent(keypath)

      // See if it exists
      let owned = await this.real.exists(token)

      if (owned && wanted != 'lowestOwnedParent') {
        if (wanted == 'ultimateOwner') {
          // It's just the current owner
          let token_owner = await this.real.ownerOf(token).catch((err) => {
            // Maybe it became unowned while we were looking at it
            return 0
          })

          return token_owner
        } else if (wanted == 'claimable') {
          // Can't be claimed if it is owned
          return false
        }
      } else {

        // Something else may control it.
        // Get its token as a string.
        let controlling_token = (await this.reg.lowestExistingParent(token)).toString()

        if (wanted == 'lowestOwnedParent') {
          // Just return that token or 0 if it doesn't exist
          return controlling_token
        } else if (wanted == 'ultimateOwner') {
          if (controlling_token == 0) {
            // Nobody owns any parent
            return 0
          }
        
          // Otherwise, look up who owns the parent
          let controlling_token_owner = await this.real.ownerOf(controlling_token).catch((err) => {
            console.log('Error getting owner, assuming unowned', err)
            return 0
          })

          return controlling_token_owner
        } else if (wanted == 'claimable') {
          if (controlling_token == 0) {
            // Nobody owns any parent, so this must be claimable
            return true
          }

          // Otherwise, look up if we can claim under the parent
          return await this.reg.childrenClaimable(controlling_token, await eth.get_account())
        }
      }
      
    } else {
      throw new Error('Unsupported keypath ' + keypath)
    }
  }

  // Start listening for Ethereum events that back the given keypath. When they
  // arrive, fire the keypath's event with the appropriate value.
  watchChain(keypath) {
    console.log('Watching chain for changes to ' + keypath)

    if (this.watchers[keypath] !== undefined) {
      throw new Error('Trying to double-watch ' + keypath)
    }
    
    if (firstComponent(keypath) == 'commitment') {
      // Format is 'commitment.{owner}.{hash}.("hash"|"deposit"|"creationTime")'
      // If the commitment doesn't exist, everything will resolve to 0.

      let wanted = lastComponent(keypath)
      if (wanted != 'hash' && wanted != 'deposit' && wanted != 'creationTime') {
        throw new Error('Unsupported keypath ' + keypath)
      }

      // Work out what commitment hash by what owner we are interested in
      let hash = lastComponent(parentOf(keypath))
      let owner = lastComponent(parentOf(parentOf(keypath)))
      
      // Work out what struct to check if we need to read the actual data
      let key_hash = mv.getClaimKey(hash, owner)

      // Determine the filters to watch to watch it
      let commit_filter = this.reg.Commit({hash: hash, owner: owner}, {fromBlock: 'latest', toBlock: 'latest'})
      let cancel_filter = this.reg.Cancel({hash: hash, owner: owner}, {fromBlock: 'latest', toBlock: 'latest'})
      let reveal_filter = this.reg.Reveal({hash: hash, owner: owner}, {fromBlock: 'latest', toBlock: 'latest'})

      // On any event, update
      let handle_event = async (error, event_report) => {
        console.log('Saw event: ', event_report)
        if (event_report.removed == true || (typeof event_report.type != 'undefined' && event_report.type != 'mined')) {
          // This transaction hasn't confirmed, so ignore it
          return
        }

        if (event_report.args.hash.toString(16) != hash || event_report.args.owner != owner) {
          // Wrong subject!
          // TODO: This is probably due to web3 0.20 over a newer provider
          console.log('Wrong subject: ' + event_report.args.hash.toString(16) + ', ' + event_report.args.owner)
          return
        }

        let val
        if (event_report.event == 'Cancel' || event_report.event == 'Reveal') {
          // Everything is now 0.
          val = 0
        } else {
          // Just query the chain on a commit to get the actual info
          let commitment = await this.reg.commitments(key_hash)
          if (wanted == 'hash') {
            val = commitment[0]
          } else if (wanted == 'deposit') {
            val = commitment[1]
          } else {
            val = commitment[2]
          }
        }
        this.cache[keypath] = val
        this.emit(keypath, val)
      }
      commit_filter.watch(handle_event)
      cancel_filter.watch(handle_event)
      reveal_filter.watch(handle_event)

      // Register filters for deactivation
      this.watchers[keypath] = [commit_filter, cancel_filter, reveal_filter]
    } else if (firstComponent(keypath) == 'mrv' && lastComponent(keypath) == 'balance' && lastComponent(parentOf(keypath)) != 'mrv') {
      // Format: mrv.{address}.balance

      let address = lastComponent(parentOf(keypath))
      
      // Watch the user's MRV balance.
      // We have to filter separately for in and out transactions
      let in_filter = this.mrv.Transfer({to: address}, {fromBlock: 'latest', toBlock: 'latest'})
      let out_filter = this.mrv.Transfer({from: address}, {fromBlock: 'latest', toBlock: 'latest'})
      
      // On either event, update the balance
      let handle_event = async (error, event_report) => {
        console.log('Saw event: ', event_report)
        if (event_report.removed == true || (typeof event_report.type != 'undefined' && event_report.type != 'mined')) {
          // This transaction hasn't confirmed, so ignore it
          return
        }
        // Just query the balance again to update instead of doing real tracking.
        let val = await this.mrv.balanceOf(address)
        this.cache[keypath] = val
        this.emit(keypath, val)
      }
      in_filter.watch(handle_event)
      out_filter.watch(handle_event)

      // Register filters for deactivation
      this.watchers[keypath] = [in_filter, out_filter]
    } else if (keypath == 'reg.commitmentMinWait') {
      // They want the min wait time of a commitment to mature.
      // This does not change.
      // But we have to create a watcher list so unwatch doesn't complain it is mismatched.
      this.watchers[keypath] = []
    } else if (firstComponent(keypath) == 'reg') {
      // Match reg.{address}.tokens, reg.{address}.tokens.{number}
      let parts = splitKeypath(keypath)

      if ((parts.length == 3 || parts.length == 4)  && parts[2] == 'tokens') {
        let owner = parts[1]
        // For any change to the virtual real estate tokens of an owner, we need to watch the transfer events in and out

        let in_filter = this.real.Transfer({to: owner}, {fromBlock: 'latest', toBlock: 'latest'})
        let out_filter = this.real.Transfer({from: owner}, {fromBlock: 'latest', toBlock: 'latest'})
        
        // On either event, update everything
        let handle_event = async (error, event_report) => {
          console.log('Saw event: ', event_report)
          if (event_report.removed == true || (typeof event_report.type != 'undefined' && event_report.type != 'mined')) {
            // This transaction hasn't confirmed, so ignore it
            return
          }

          if (parts.length == 3) {
            // We just want the total NFT count for this owner
            // Just query the balance again to update instead of doing real tracking.
            let val = await this.real.balanceOf(owner)
            this.cache[keypath] = val
            this.emit(keypath, val)
          } else {
            // We must want the token at an index. Query that
            let index = parts[3]
            let val = undefined
            try {
              // Find the token and get it as a string in base 10 with all digits intact
              val = (await this.real.tokenOfOwnerByIndex(owner, index)).toString(10)
            } catch(e) {
              // Maybe they no longer have this many tokens
              console.error('Error getting token ' + index + ' of owner ' + owner + ', assuming 0', e)
              val = '0'
            }
            this.cache[keypath] = val
            this.emit(keypath, val)
          }
        }
        in_filter.watch(handle_event)
        out_filter.watch(handle_event)

        // Register filters for deactivation
        this.watchers[keypath] = [in_filter, out_filter]
      } else {
        throw new Error('Unsupported keypath ' + keypath)
      }
      
      let hash = lastComponent(parentOf(keypath))
      let owner = lastComponent(parentOf(parentOf(keypath)))
    } else if (keypath == 'block.timestamp') {
      // They want to watch the current network time
      let block_filter = eth.watch_block((block) => {
        let val = block.timestamp
        this.cache[keypath] = val
        this.emit(keypath, val)
      })

      this.watchers[keypath] = [block_filter]
    } else if (['minDeposit', 'owner', 'deposit', 'homesteading'].includes(lastComponent(keypath))) {
      // We want the owner, deposit, or homesteading status of a token (not a claim)
      // Pack the token value
      let token = mv.keypathToToken(parentOf(keypath))

      let wanted = lastComponent(keypath)

      if (wanted == 'minDeposit') {
        // Checking the min deposit doesn't care about the owner.
        // We only watch for deposit changed events on the whole system.
        let filter = this.reg.DepositScaleChange({}, {fromBlock: 'latest', toBlock: 'latest'})
        filter.watch(async (error, event_report) => {
          console.log('Saw event: ', event_report)
          if (event_report.removed == true || (typeof event_report.type != 'undefined' && event_report.type != 'mined')) {
            // This transaction hasn't confirmed, so ignore it
            return
          }
          
          // Re-look-up the deposit
          let deposit = await this.reg.getMinDepositToCreate(token)

          this.cache[keypath] = deposit
          this.emit(keypath, deposit)
        })
        this.watchers[keypath] = [filter]
      } else {
        // We care about the owner

        // Set up a filter for the transfer of this token from here on out.
        // Note: this also catches any events in the current top block when we make it
        let filter = this.real.Transfer({'tokenId': token}, {fromBlock: 'latest', toBlock: 'latest'})
        filter.watch(async (error, event_report) => {
          console.log('Saw event: ', event_report)
          if (event_report.removed == true || (typeof event_report.type != 'undefined' && event_report.type != 'mined')) {
            // This transaction hasn't confirmed, so ignore it
            return
          }

          if (event_report.args.tokenId.toString(10) != token.toString(10)) {
            console.log('Wrong token: ' + event_report.args.tokenId.toString(10))
            return
          }

          let new_owner = event_report.args.to

          if (wanted == 'owner') {
            // Just spit out the owner
            this.cache[keypath] = new_owner
            this.emit(keypath, new_owner)
          } else if (wanted == 'deposit') {
            // We want the deposit, or 0 for unowned tokens.
            // The contract already does that.
            let deposit = await this.reg.getDeposit(token)

            this.cache[keypath] = deposit
            this.emit(keypath, deposit)
          } else if (wanted == 'homesteading') {
            // Maybe the token was destroyed or created. Check homesteading.
            let homesteading = await this.reg.getHomesteading(token)

            this.cache[keypath] = homesteading
            this.emit(keypath, homesteading)
          }
        })

        // Remember the filter so we can stop watching.
        this.watchers[keypath] = [filter]

        if (wanted == 'homesteading') {
          // Also watch the homesteading event

          let filter2 = this.reg.Homesteading({'token': token}, {fromBlock: 'latest', toBlock: 'latest'})
          filter2.watch((error, event_report) => {
            console.log('Saw event: ', event_report)
            if (event_report.removed == true || (typeof event_report.type != 'undefined' && event_report.type != 'mined')) {
              // This transaction hasn't confirmed, so ignore it
              return
            }

            if (event_report.args.token.toString(10) != token.toString(10)) {
              // Wrong subject!
              // TODO: This can happen because we're still using Web3 0.20 on newer providers.
              return
            }

            // It says whether homesteading was turned on or off
            let val = event_report.args.value

            console.log('Homesteading on ' + token.toString(10) + ' should now be ' + val + ' which is ' + (val ? 'true' : 'false'))

            // Report it
            this.cache[keypath] = val
            this.emit(keypath, val)
          })

          this.watchers[keypath].push(filter2)

        }
      }
    } else if (['ultimateOwner', 'lowestOwnedParent', 'claimable'].includes(lastComponent(keypath))) {
      // We need to watch for:
      // Claim of the token itself
      // Transfer of the token itself
      // Transfer of the lowest claimed parent
      // Homesteading set on the lowest claimed parent
      // Claim of anything *between* the token and the lowest claimed parent...

      // We can't efficiently watch that last one alone, and if it happens we
      // have to re-determine and re-watch the lowest claimed parent somehow,
      // if we watch it specifically...

      // So we just watch all possible parents.

      // Pack the token value
      let token = mv.keypathToToken(parentOf(keypath))
      let wanted = lastComponent(keypath)

      // When we get any relevant events, re-check the chain
      let handle_watch = async (error, event_report) => {
        console.log('Saw event: ', event_report)
        if (event_report.removed == true || (typeof event_report.type != 'undefined' && event_report.type != 'mined')) {
          // This transaction hasn't confirmed, so ignore it
          return
        }

        if ((typeof event_report.args.tokenId != 'undefined' && event_report.args.tokenId.toString(10) == '0') ||
          (typeof event_report.args.token != 'undefined' && event_report.args.token.toString(10) == '0')) {
          // Wrong/broken subject!
          // TODO: This can happen because we're still using Web3 0.20 on newer providers.
          return
        }

        // Instead of recomputing, go re-get the value
        let result = await this.retrieveFromChain(keypath)

        this.cache[keypath] = result
        this.emit(keypath, result)
      }

      // Watch for transfers on the token itself
      let filter = this.real.Transfer({'tokenId': token}, {fromBlock: 'latest', toBlock: 'latest'})
      filter.watch(handle_watch)

      this.watchers[keypath] = [filter]

      // Make a list of all the parent tokens
      let parent_tokens = []
      for (let parent_keypath of allParentsOf(keypath)) {
        if (componentCount(parent_keypath) > 3) {
          // It's not a sector, so make it a token
          parent_tokens.push(mv.keypathToToken(parent_keypath))
        }
      }

      for (let parent_token of parent_tokens) {
        // Watch for the transfer of any parent
        let transfer_filter = this.real.Transfer({'tokenId': parent_token}, {fromBlock: 'latest', toBlock: 'latest'})
        transfer_filter.watch(handle_watch)
        // TODO: we will end up with a lot of watches on the same parents to update a lot of children.
        this.watchers[keypath].push(transfer_filter)

        // Watch for a change in the homesteading status of any parent
        let homesteading_filter = this.reg.Homesteading({'token': parent_token}, {fromBlock: 'latest', toBlock: 'latest'})
        homesteading_filter.watch(handle_watch)
        this.watchers[keypath].push(homesteading_filter)
      }
    } else {
      throw new Error('Unsupported keypath ' + keypath)
    }
  }

  // Stop listening for Ethereum events that back the given keypath.
  unwatchChain(keypath) {
    if (this.watchers[keypath] == undefined) {
      throw new Error('Trying to unwatch unwatched ' + keypath)
    }

    for (let watcher of this.watchers[keypath]) {
      // Stop all the watchers
      watcher.stopWatching()
    }

    // Claer them out
    this.watchers[keypath] = undefined
  }

  // Now we have a bunch of code to work with claims.
  // We locally store (in local storage) the keypath and nonce for every claim, by hash.
  // We also collect the commitment ID for the hash when we get a chance, by querying the events.
  // For now we don't implement recovery/searching for claims we don't have in local storage

  // Mint MRV using the mint functions available on testnet
  async mintMRV(wei) {
    let account = await eth.get_account()
    console.log('Minting ' + wei + ' wei for ' + account)
    // This will fail if we aren't actually on testnet, probably because the
    // contract lacks the method
    await this.mrv.mint(wei, {from: account})
  }

  // Send a certain number of MRV (in MRV-wei) to an arbitrary address
  async sendMRV(destination, wei) {
    // Work out our account
    let account = await eth.get_account()

    console.log('Sending ' + wei + ' wei from ' + account + ' to ' + destination)

    // Prompt for the transfer transaction on the ERC20
    // This always seems to work with the default gas.
    let receipt = await this.mrv.transfer(destination, wei, {from: account})

    console.log('Transfer receipt: ', receipt)
  }

  // Approve a certain number of MRV (in MRV-wei) as a deposit with the registry
  async approveDeposit(deposit) {
    // Work out our account
    let account = await eth.get_account()

    console.log('Approving deposit transfer by ' + this.reg.address)

    // Prompt for the approve transaction on the ERC20, for the deposit
    // This always seems to work with the default gas.
    await this.mrv.approve(this.reg.address, deposit, {from: account})

    console.log('Approved deposit')
  }

  // Make a claim for the given keypath. Prompt the user to approve the transaction and send it to the chain.
  // Deposit must be a BigNumber and already approved.
  // Returns an object containing: token, nonce, account
  async createClaim(keypath, deposit) {

    // Work out our account
    let account = await eth.get_account()

    // Pack up the token
    let token = mv.keypathToToken(keypath)

    // Roll a random secret nonce
    let nonce = mv.generateNonce()
    
    // Compute a hash
    let data_hash = mv.hashTokenAndNonce(token, nonce)

    console.log('Token: 0x' + token.toString(16))
    console.log('Nonce: 0x' + nonce.toString(16))
    console.log('Hash: ' + data_hash)
    console.log('Deposit: ' + deposit.toString())

    // Estimate commitment gas.
    // truffle-contract is too conservative (gives the conserved gas exactly,
    // which makes us hit 0) so we double it.
    let gas = await this.reg.commit.estimateGas(data_hash, deposit, {from: account}) * 2

    console.log('Commitment will probably take ' + gas + ' gas')

    // Commit for it
    await this.reg.commit(data_hash, deposit, {from: account, gas: gas})

    console.log('Commitment made')

    return {keypath, nonce, account}
  }

  // Given a {keypath, nonce, account} object for a successfully made claim, do the reveal.
  // Fails if the claim has not matured or has expired
  async revealClaim(claim_data) {
    // Load from the claim data
    let {keypath, nonce, account} = claim_data

    console.log('Keypath: ' + keypath)
    console.log('Nonce: ' + nonce)
    console.log('Account: ' + account)

    // Compute the actual token number
    let token = mv.keypathToToken(keypath)
    console.log('Token: ' + token)

    // Compute the hash the claim should be under
    let data_hash = mv.hashTokenAndNonce(token, nonce)
    console.log('Hash: ' + data_hash)

    let gas = await this.reg.reveal.estimateGas(token, nonce, {from: account}) * 2

    console.log('Reveal will probably take ' + gas + ' gas')

    await this.reg.reveal(token, nonce, {from: account, gas: gas})

    console.log('Commitment revealed successfully')
  }

  // Given a {keypath, nonce, account} object for a successfully made claim, cancel it.
  // Fails if the claim has been revealed.
  async cancelClaim(claim_data) {
    // Load from the claim data
    let {keypath, nonce, account} = claim_data

    console.log('Keypath: ' + keypath)
    console.log('Nonce: ' + nonce)
    console.log('Account: ' + account)

    // Compute the actual token number
    let token = mv.keypathToToken(keypath)
    console.log('Token: ' + token)

    // Compute the hash the claim should be under
    let data_hash = mv.hashTokenAndNonce(token, nonce)
    console.log('Hash: ' + data_hash)

    let gas = await this.reg.cancel.estimateGas(data_hash, {from: account}) * 2

    console.log('Cancel will probably take ' + gas + ' gas')

    await this.reg.cancel(data_hash, {from: account, gas: gas})

    console.log('Commitment canceled successfully')
  }

  // Send the NFT token for the given keypath to an arbitrary address
  async sendToken(destination, keypath) {
    // Work out our account
    let account = await eth.get_account()

    console.log('Sending ' + keypath + ' from ' + account + ' to ' + destination)

    // Compute the actual token number
    let token = mv.keypathToToken(keypath)

    let gas = await this.real.transferFrom.estimateGas(account, destination, token, {from: account}) * 2

    console.log('Send will probably take ' + gas + ' gas')

    let receipt = await this.real.transferFrom(account, destination, token, {from: account, gas: gas})

    console.log('Transfer receipt: ', receipt)
  }

  // Release the token for the given keypath.
  // We have to own it.
  // Token will be available to be claimed by someone else!
  async releaseToken(keypath) {
    console.log('Releasing keypath: ' + keypath)

    // Work out our account
    let account = await eth.get_account()

    // Compute the actual token number
    let token = mv.keypathToToken(keypath)

    let gas = await this.reg.release.estimateGas(token, {from: account}) * 2

    console.log('Release will probably take ' + gas + ' gas')

    await this.reg.release(token, {from: account, gas: gas})

    console.log('Token released successfully')
  }

  // Set homesteading under a token to on or off.
  async setHomesteading(keypath, is_enabled) {

    

    console.log('Setting homesteading on keypath ' + keypath + ' to ' + is_enabled)

    // Work out our account
    let account = await eth.get_account()

    // Compute the actual token number
    let token = mv.keypathToToken(keypath)

    let gas = await this.reg.setHomesteading.estimateGas(token, is_enabled, {from: account}) * 2

    console.log('Setting homesteading will probably take ' + gas + ' gas')

    await this.reg.setHomesteading(token, is_enabled, {from: account, gas: gas})

    console.log('Homesteading set successfully')
  }

}

/**
 * Represents a feed: a set of subscriptions to a Registry, bundled together.
 * You can add subscriptions with subscribe(), which returns nothing. Call
 * unsubscribe() to remove all the subscriptions.
 */
class Feed {
  /// Construct a Feed backed by the given Registry, possibly with the given parent.
  constructor(registry, parent) {
    // Hold the backing registry
    this.registry = registry
    // Track all subscriptions
    this.subscriptions = []
    // Track all children
    this.children = new Set()
    // Save the parent, which may be undefined
    this.parent = parent
  }
  
  /// Subscribe the given handler to the given keypath
  subscribe(keypath, handler) {
    this.subscriptions.push(this.registry.subscribe(keypath, handler))
  }

  /// Unsubscribe all handlers, and all children
  unsubscribe() {
    for (let subscription of this.subscriptions) {
      this.registry.unsubscribe(subscription)
    }
    this.subscriptions = []

    // Clean up children and sever connection to us.
    for (let child of this.children) {
      child.unsubscribe()
      child.parent = undefined
    }
    this.children = new Set()

    if (this.parent !== undefined) {
      // Don't let our parent unsubscribe us again
      this.parent.children.delete(this)
    }
  }

  /// Subscribe the given handler to the given list of keypaths.
  /// When any of them changes, the hander is called with an array of all of them.
  /// We wait for all of them to have values reported before making any handler calls.
  subscribeAll(keypaths, handler) {
    // This will hold the values as they come in.
    let values = []
    // This will hold flags for if the value has come in at all yet
    let have_value = []
    for (let i = 0; i < keypaths.length; i++) {
      values.push(undefined)
      have_value.push(false)
    }

    for (let i = 0; i < keypaths.length; i++) {
      // Subscribe to each keypath
      this.subscribe(keypaths[i], (val) => {
        // When it comes in, put it in the array
        values[i] = val
        // Record we have it
        have_value[i] = true

        if (!have_value.includes(false)) {
          // We have all the values
          // Call the handler with a shallow copy of the array (in case the values change later)
          handler(values.slice())
        }
      })
    }

    // When we unsubscribe all the subscriptions will go away and everything will be cleaned up.
  }

  /// Create a child Feed backed by the same Registry as this one.
  /// When this feed unsubscribes, so will the child feed, if it hasn't already.
  derive() {
    // Make the child
    let child = new Feed(this.registry, this)

    // Save it as a child
    this.children.add(child)

    // Return it
    return child
  }
}

// Async factory method for users to get a Registry. Actually exported.
// Needs to know where to find the smart contracts.
async function get_registry(basePath) {
  let reg = new Registry(basePath)
  await reg.init()
  return reg
}

module.exports = get_registry

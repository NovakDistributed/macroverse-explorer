//eth.js: wrapper functions for Ethereum, and basic Ethereum setup.
// We have this because web3 isn't necessarily stable.

// We want to set up web3 before truffle-contract because truffle-contract wants it
const Web3 = require('web3')
window.Web3 = Web3

// Override window web3
let web3 = new Web3(create_provider())
window.web3 = web3

// We will use Truffle Contract for loading up deployed contract pointers
const contract = require('@truffle/contract')

// We need Cool Browser Stuff like Fetch
const fetch = window.fetch

// Wrap a couple Ethereum things that we will have to change when the web3 API changes

// Get the web3 provider to use. Should be whatever is injected, unless we are
// in extra special debug mode, in which case it will be something that points
// at localhost for Truffle Develop.
function create_provider() {
  
  // This is for Metamask
  return window.ethereum

  const TRUFFLE_DEVELOP_URL='ws://localhost:9545'
  const GANACHE_DEVELOP_URL='ws://localhost:7545'
  let use = TRUFFLE_DEVELOP_URL
  // TODO: sometimes use real in-browser web3
  // TODO: Tell the difference between Truffle and Ganache
  console.log('Creating provider for url ' + use)
  return new Web3.providers.WebsocketProvider(use)
}

// Get the proivider in use
function get_provider() {
  return web3.currentProvider
}

// Returns a promise which resolves when the Etherum provider is enabled, if it
// needs enabling like Metamask does.
async function ensure_enabled() {
  
  // Find the provider
  let provider = get_provider()
  
  if (typeof provider.enable == 'undefined') {
    // Provider does not need enabling
    return
  }

  while(true) {
    // Otherwise, until enabled successfully
    try {
      console.log('Attempting to enable Ethereum provider...')
      let result = await provider.enable()
      console.log('Response to enable request: ' + result)

      // This can return before web3.eth.accounts is ready.
      // So we spin wait on it
      while (typeof get_account() == 'undefined') {
        console.log('Account is not available yet!')
        await new Promise((resolve) => {
          setTimeout(resolve, 100)
        })
      }

      return
    } catch (e) {
      // User rejected login. Tell them we need the permission to do anything.
      // TODO: make this pretty and not a dialog spam loop.
      console.log('Could not enable provider. Retrying...')
      alert("Unfortunately, the Macroverese Explorer requires access to your browser's Ethereum provider to work.")
    }
  }
}

// Get the network ID
async function get_network_id() {
  return await web3.eth.net.getId()
}

// Get the account to use.
// Asynchronous because I can't get web3 1.x to do it synchronously and I want to be ready for it.
function get_account() {
  return new Promise((resolve, reject) => {
    web3.eth.getAccounts((err, accounts) => {
      if (err) {
        reject(err)
      } else if (!accounts.length) {
        reject(new Error("No accounts available."))
      } else {
        resolve(accounts[0])
      }
    })
  })
}

// Download data with fetch and parse as JSON
async function fetch_json(url) {
  let response = await fetch(url)
  if (!response.ok) {
    throw new Error("Negative response from server for " + url + ": " + JSON.stringify(response))
  }
  return await response.json()
}

// Get an instance of a contract from a JSON URL.
async function get_instance(url) {
  // Grab contract JSON object
  let contract_description = await fetch_json(url)

  // Fluff up into contract, making sure to use the parsed JSON and not text
  let truffle_contract = contract(contract_description)
  // Show it the provider
  truffle_contract.setProvider(get_provider())

  // Find out the network we are on
  let current_network = await get_network_id()
  if (!truffle_contract.networks.hasOwnProperty(current_network)) {
    // Complain if the contract is not there
    throw new Error('Contract ' + url + ' unavailable on network ' + current_network)
  }

  // Find the instance
  let deployed = await truffle_contract.deployed()
  return deployed
}

// Return the latest block
async function latest_block() {
  return new Promise((resolve, reject) => {
    // Go look for the block in a promise
    web3.eth.getBlock('latest', (err, block) => {
      if (err) {
        // If we fail, reject
        return reject(err)
      }
  
      // Otherwise, resolve with the block
      return resolve(block)
    })
  })
}

// Watch for blocks.
// Returns an EventEmitter that emits 'data' for each new block, and must have unsubscribe() called on it when no longer needed.
function watch_block() {
  return web3.eth.subscribe('newBlockHeaders')
}

// Nobody should really have to use web3; we have this stuff.
module.exports = { ensure_enabled, get_instance, get_account, get_network_id, get_provider, latest_block, watch_block }

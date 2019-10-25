//eth.js: wrapper functions for Ethereum, and basic Ethereum setup.
// We have this because web3 isn't necessarily stable.

// We want to set up web3 before truffle-contract because truffle-contract wants it
const Web3 = require('web3')
window.Web3 = Web3

// Override window web3
let web3 = new Web3(create_provider())
window.web3 = web3

// We will use Truffle Contract for loading up deployed contract pointers
const contract = require('truffle-contract')

// We need Cool Browser Stuff like Fetch
const fetch = window.fetch

// Wrap a couple Ethereum things that we will have to change when the web3 API changes

// Get the web3 provider to use. Should be whatever is injected, unless we are
// in extra special debug mode, in which case it will be something that points
// at localhost for Truffle Develop.
function create_provider() {
  const TRUFFLE_DEVELOP_URL='http://localhost:9545'
  const GANACHE_DEVELOP_URL='http://localhost:7545'
  let use = TRUFFLE_DEVELOP_URL
  // TODO: sometimes use real in-browser web3
  // TODO: Tell the difference between Truffle and Ganache
  console.log('Creating provider for url ' + use)
  return new Web3.providers.HttpProvider(use)
}

// Get the proivider in use
function get_provider() {
  return web3.currentProvider
}

// Get the network ID
function get_network_id() {
  return web3.version.network
}

// Get the account to use
function get_account() {
  return web3.eth.accounts[0]
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
  let current_network = get_network_id()
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

// Watch for blocks and call the given callback when new ones come in.
// Returns a filter on which the user must call stopWatching() when done.
function watch_block(listener) {
  // Create a filter and start watching
  let block_filter = web3.eth.filter('latest')
  block_filter.watch((err, block_hash) => {
    if (err) {
      return console.error('Error watching blocks: ', err)
    }
    console.log('New block: ', block_hash)
    // Go get the block
    web3.eth.getBlock(block_hash, (err, block) => {
      if (err) {
        return console.error('Error getting block: ', err)
      }
      
      try {
        listener(block)
      } catch (err) {
        return console.error('Error running block listener: ', err)
      }
    })
  })

  return block_filter
}

// Nobody should really have to use web3; we have this stuff.
module.exports = { get_instance, get_account, get_network_id, get_provider, latest_block, watch_block }

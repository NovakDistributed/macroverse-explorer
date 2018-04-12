// main.js: main Javascript file for the Macroverse Explorer
// Handles setting up the Explorer and plugging the Ethereum stuff into the A-Frame stuff

// We will use A-Frame
const aframe = require('aframe')

// We want to set up web3 before truffle-contract because truffle-contract wants it
const Web3 = require('web3')
window.Web3 = Web3

// Override window web3
let web3 = new Web3(create_provider())
window.web3 = web3

// We will use Truffle Contract for loading up deployed contract pointers
const contract = require('truffle-contract')

// We want macroverse itself
const mv = require('macroverse')

// We also need Cool Browser Stuff like Fetch
const fetch = window.fetch

// Wrap a couple other Ethereum things that we will have to change when the web3 API changes

// Get the web3 provider to use. Should be whatever is injected, unless we are
// in extra special debug mode, in which case it will be something that points
// at localhost for Truffle Develop.
function create_provider() {
  const TRUFFLE_DEVELOP_URL='http://localhost:9545'
  // TODO: sometimes use real in-browser web3
  return new Web3.providers.HttpProvider(TRUFFLE_DEVELOP_URL)
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
    throw new Error("Negative response from server: " + response)
  }
  return await response.json()
}

// Get an instance of a contract from a JSON URL.
async function get_instance(url) {
  // Grab contract JSON object
  let contract_description = await fetch_json(url)


  // Fluff up into contract, making sure to use the parsed JSON and not text
  console.log('Fluffing up: ', contract_description)
  let truffle_contract = contract(contract_description)
  // Show it the provider
  truffle_contract.setProvider(get_provider())

  console.log('Contract ' + url + ' is on networks: ', Object.keys(truffle_contract.networks))

  // Find out the network we are on
  let current_network = get_network_id()
  if (!truffle_contract.networks.hasOwnProperty(current_network)) {
    // Complain if the contract is not there
    throw new Error('Contract ' + url + ' unavailable on network ' + current_network)
  }

  // Find the instance
  console.log('Looking for instance of ', truffle_contract)
  window.tc = truffle_contract
  
  let deployed = await truffle_contract.deployed()

  console.log('Found: ', deployed)
  window.dp = deployed
  return deployed
}

async function main() {

  console.log('Macroverse Explorer starting on Ethereum network ' + get_network_id())
  console.log('Using account ' + get_account())

  let instance_promise = get_instance('contracts/MacroverseStarGenerator.json')
  instance_promise.then((result) => {
    console.log('Got result: ', result)
  })

  // Fluff up into contract, making sure to use the parsed JSON and not text
  let MacroverseStarGenerator = await instance_promise
  window.msg = MacroverseStarGenerator

  // Do something with it
  console.log('Call a contract method')
  let result_promise = MacroverseStarGenerator.getGalaxyDensity.call(0, 0, 0)
  console.log('Contract result promise: ', result_promise)
  console.log('Contract number result: ' , mv.fromReal(await result_promise))

}

// Actually run the entry point
main()

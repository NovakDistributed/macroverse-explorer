// main.js: main Javascript file for the Macroverse Explorer
// Handles setting up the Explorer and plugging the Ethereum stuff into the A-Frame stuff

// We will use A-Frame
const aframe = require('aframe')

// We want macroverse itself
const mv = require('macroverse')

// Load all the other parts of the code
const Context = require('./Context.js')
const eth = require('./eth.js')

async function main() {

  console.log('Macroverse Explorer starting on Ethereum network ' + eth.get_network_id())
  console.log('Using account ' + eth.get_account())

  let ctx = await Context('contracts/')

  // Do something with it
  console.log('Call a contract method')
  let result_promise = ctx.stars.getObjectCount(0, 0, 0)
  console.log('Contract number result: ' , await result_promise)

}

// Actually run the entry point
main()

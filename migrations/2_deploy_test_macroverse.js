// Deploy a testing copy of Macroverse if one is needed.
// We can only see the artifacts from our dependencies thanks to scripts/install.js copying them over.
var RealMath = artifacts.require("RealMath")
var RNG = artifacts.require("RNG")
var MacroverseNFTUtils = artifacts.require("MacroverseNFTUtils")
var MacroverseStarGenerator = artifacts.require("MacroverseStarGenerator")
var MacroverseStarGeneratorPatch1 = artifacts.require("MacroverseStarGeneratorPatch1")
var MacroverseUniversalRegistry = artifacts.require("MacroverseUniversalRegistry")
var MacroverseRealEstate = artifacts.require("MacroverseRealEstate")
var MacroverseSystemGenerator = artifacts.require("MacroverseSystemGenerator")
var MacroverseSystemGeneratorPart1 = artifacts.require("MacroverseSystemGeneratorPart1")
var MacroverseSystemGeneratorPart2 = artifacts.require("MacroverseSystemGeneratorPart2")
var MacroverseExistenceChecker = artifacts.require("MacroverseExistenceChecker")
var MacroverseMoonGenerator = artifacts.require("MacroverseMoonGenerator")
var MinimumBalanceAccessControl = artifacts.require("MinimumBalanceAccessControl")
var TestnetMRVToken = artifacts.require("TestnetMRVToken")

// new Truffle doesn't give us free toWei
const Web3Utils = require('web3-utils')

module.exports = function(deployer, network, accounts) {
  
  if (network != "live") {
    // We are on a testnet. Deploy a new Macroverse
    
    console.log("On alternative network '" + network + "'; deploying test Macroverse")
    
    deployer.deploy(RealMath).then(function() {
      deployer.link(RealMath, RNG)
      return deployer.deploy(RNG)
    }).then(function() {
      return deployer.deploy(MacroverseNFTUtils)
    }).then(function() {
      return deployer.deploy(TestnetMRVToken, accounts[0], accounts[0])
    }).then(function() {
      return deployer.deploy(MinimumBalanceAccessControl, TestnetMRVToken.address, Web3Utils.toWei("100", "ether").toString())
    }).then(function() {
      deployer.link(RNG, MacroverseStarGenerator)
      deployer.link(RealMath, MacroverseStarGenerator)
      // New Truffle won't just coerce strings to bytes32
      return deployer.deploy(MacroverseStarGenerator, "0x46696174426c6f636b73", MinimumBalanceAccessControl.address)
    }).then(function() {
      deployer.link(RNG, MacroverseStarGeneratorPatch1)
      deployer.link(RealMath, MacroverseStarGeneratorPatch1)
      return deployer.deploy(MacroverseStarGeneratorPatch1, MinimumBalanceAccessControl.address)
    }).then(function() {
      deployer.link(RNG, MacroverseSystemGeneratorPart1)
      deployer.link(RealMath, MacroverseSystemGeneratorPart1)
      return deployer.deploy(MacroverseSystemGeneratorPart1)
    }).then(function() {
      deployer.link(RNG, MacroverseSystemGeneratorPart2)
      deployer.link(RealMath, MacroverseSystemGeneratorPart2)
      return deployer.deploy(MacroverseSystemGeneratorPart2)
    }).then(function() {
      deployer.link(MacroverseSystemGeneratorPart1, MacroverseSystemGenerator)
      deployer.link(MacroverseSystemGeneratorPart2, MacroverseSystemGenerator)
      return deployer.deploy(MacroverseSystemGenerator, MinimumBalanceAccessControl.address)
    }).then(function() {
      deployer.link(RNG, MacroverseMoonGenerator)
      deployer.link(RealMath, MacroverseMoonGenerator)
      return deployer.deploy(MacroverseMoonGenerator, MinimumBalanceAccessControl.address)
    }).then(function() {
      deployer.link(MacroverseNFTUtils, MacroverseExistenceChecker)
      return deployer.deploy(MacroverseExistenceChecker, MacroverseStarGenerator.address,
        MacroverseStarGeneratorPatch1.address, MacroverseSystemGenerator.address, MacroverseMoonGenerator.address)
    }).then(function() {
      return deployer.deploy(MacroverseRealEstate)
    }).then(function() {
      deployer.link(MacroverseNFTUtils, MacroverseUniversalRegistry)
      return deployer.deploy(MacroverseUniversalRegistry, MacroverseRealEstate.address,
        MacroverseExistenceChecker.address, TestnetMRVToken.address, Web3Utils.toWei("1000", "ether").toString(), '60')
    }).then(function() {
      return MacroverseRealEstate.deployed() 
    }).then(function(backend) {
      // Give the backend to the frontend
      return backend.transferOwnership(MacroverseUniversalRegistry.address)
    }).then(function() {
      console.log("Macroverse deployed!")
    })
  } else {
    console.log("On main network; using real Macroverse")    
  }
}


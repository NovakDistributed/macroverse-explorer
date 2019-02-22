// Deploy a testing copy of Macroverse if one is needed.
// We can only see the artifacts from our dependencies thanks to scripts/install.js copying them over.
var RealMath = artifacts.require("RealMath")
var RNG = artifacts.require("RNG")
var MacroverseStarGenerator = artifacts.require("MacroverseStarGenerator")
var MacroverseStarGeneratorPatch1 = artifacts.require("MacroverseStarGeneratorPatch1")
var MacroverseUniversalRegistry = artifacts.require("MacroverseUniversalRegistry")
var MacroverseSystemGenerator = artifacts.require("MacroverseSystemGenerator")
var MacroverseMoonGenerator = artifacts.require("MacroverseMoonGenerator")
var MinimumBalanceAccessControl = artifacts.require("MinimumBalanceAccessControl")
var MRVToken = artifacts.require("MRVToken")

module.exports = function(deployer, network, accounts) {
  
  if (network != "live") {
    // We are on a testnet. Deploy a new Macroverse
    
    console.log("On alternative network '" + network + "'; deploying test Macroverse with test universe seed")
    
    deployer.deploy(RealMath)
    deployer.link(RealMath, RNG)
    deployer.deploy(RNG)
    deployer.link(RNG, MacroverseStarGenerator)
    deployer.link(RealMath, MacroverseStarGenerator)
    deployer.link(RNG, MacroverseStarGeneratorPatch1)
    deployer.link(RealMath, MacroverseStarGeneratorPatch1)
    deployer.link(RNG, MacroverseSystemGenerator)
    deployer.link(RealMath, MacroverseSystemGenerator)
    deployer.link(RNG, MacroverseMoonGenerator)
    deployer.link(RealMath, MacroverseMoonGenerator)

    
    // Deploy the token
    deployer.deploy(MRVToken, accounts[0], accounts[0]).then(function() {
      return deployer.deploy(MinimumBalanceAccessControl, MRVToken.address, web3.toWei(100, "ether"))
    }).then(function() {
      return deployer.deploy(MacroverseStarGenerator, "FiatBlocks", MinimumBalanceAccessControl.address)
    }).then(function() {
      return deployer.deploy(MacroverseStarGeneratorPatch1, MinimumBalanceAccessControl.address)
    }).then(function() {
      return deployer.deploy(MacroverseSystemGenerator, MinimumBalanceAccessControl.address)
    }).then(function() {
      return deployer.deploy(MacroverseMoonGenerator, MinimumBalanceAccessControl.address)
    }).then(function() {
      return deployer.deploy(MacroverseUniversalRegistry, MRVToken.address, web3.toWei(1000, "ether"))
    }).then(function() {
      console.log("Macroverse deployed!")
    })
  } else {
    console.log("On main network; using real Macroverse")    
  }
}


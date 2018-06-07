// Infobox.js: Defines an Infobox class which can be told to display
// information on a star, planet, etc. in an element.

const mv = require('macroverse')

class Infobox {
  
  /// Construct an infobox rooted at the given HTML element
  constructor(infobox) {
    this.infobox = infobox
    this.infobox.classList.add('infobox')
  }
  
  /// Show the infobox for the given star
  showStar(star) {
    this.infobox.classList.remove('infobox-planet')
    this.infobox.classList.add('infobox-star')
    this.infobox.innerHtml = `
      <table>
        <tr>
          <td>Object Class</td>
          <td>${mv.objectClasses[star.objClass]}</td>
        </tr>
        <tr>
          <td>Spectral Type</td>
          <td>${mv.spectralTypes[star.objType]}</td>
        </tr>
        <tr>
          <td>Mass</td>
          <td>${star.objMass} M<sub>☉</sub></td>
        </tr>
      </table>
    `
  }

  /// Show the infobox for the given planet, orbiting the given star
  showPlanet(planet, star) {
    this.infobox.classList.remove('infobox-star')
    this.infobox.classList.add('infobox-planet')
    this.infobox.innerHtml = `
      This is a planet. 
    `
  }
}


module.exports = Infobox

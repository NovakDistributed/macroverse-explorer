// Infobox.js: Defines an Infobox class which can be told to display
// information on a star, planet, etc. in an element.

const mv = require('macroverse')

// TODO: Move this stuff to the macroverse module
let planetClasses = ['Lunar', 'Terrestrial', 'Uranian', 'Jovian', 'AsteroidBelt']

class Infobox {
  
  /// Construct an infobox rooted at the given HTML element
  constructor(infobox) {
    this.infobox = infobox
    this.infobox.classList.add('infobox')
  }
  
  /// Show the infobox for a sector
  /// TODO: Create a sector object
  showSector(x, y, z, count) {
    this.infobox.classList.remove('infobox-star')
    this.infobox.classList.remove('infobox-planet')
    this.infobox.classList.add('infobox-sector')
    this.infobox.innerHTML = `
      <div class="infobox-title">Sector ${x},${y},${z}</div>
      <div class="infobox-body">
        <table class="infobox-table">
          <tr>
            <td>Number of Systems</td>
            <td>${count}</td>
          </tr>
        </table>
      </div>
    `
  }

  /// Show the infobox for the given star
  showStar(star) {
    this.infobox.classList.remove('infobox-planet')
    this.infobox.classList.remove('infobox-sector')
    this.infobox.classList.add('infobox-star')
    this.infobox.innerHTML = `
      <div class="infobox-title">Star ${star.sectorX},${star.sectorY},${star.sectorZ}/${star.number}</div>
      <div class="infobox-body">
        <table class="infobox-table">
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
            <td>${star.objMass.toFixed(2)} M<sub>☉</sub></td>
          </tr>
          <tr>
            <td>Luminosity</td>
            <td>${star.luminosity.toFixed(2)} L<sub>☉</sub></td>
          </tr>
          <tr>
            <td>Planets?</td>
            <td class="${star.hasPlanets ? "yes" : "no"}">${star.hasPlanets ? "Yes" : "No"}</td>
          </tr>
        </table>
      </div>
    `
  }

  /// Show the infobox for the given planet, orbiting the given star
  showPlanet(planet, star) {
    this.infobox.classList.remove('infobox-star')
    this.infobox.classList.remove('infobox-sector')
    this.infobox.classList.add('infobox-planet')
    this.infobox.innerHTML = `
      <div class="infobox-title">Planet ${star.sectorX},${star.sectorY},${star.sectorZ}/${star.number}/${planet.number}</div>
      <div class="infobox-body">
        <table class="infobox-table">
          <tr>
            <td>Planet Class</td>
            <td colspan="2">${planetClasses[planet.planetClass]}</td>
          </tr>
          <tr>
            <td>Mass</td>
            <td colspan="2">${planet.planetMass.toFixed(2)} M<sub>⊕</sub></td>
          </tr>
          <tr>
            <td rowspan="4">Orbit</td>
            <td>Minimum</td>
            <td>${(planet.orbit.periapsis / mv.AU).toFixed(2)} AU</td>
          </tr>
          <tr>
            <td>Maximum</td>
            <td>${(planet.orbit.apoapsis / mv.AU).toFixed(2)} AU</td>
          </tr>
          <tr>
            <td>Period</td>
            <td>${(planet.orbit.period / mv.SIDERIAL_YEAR).toFixed(2)} Y<sub>s</sub></td>
          </tr>
          <tr>
            <td>Inclination</td>
            <td>${mv.degrees(planet.orbit.inclination).toFixed(2)}&deg;</td>
          </tr>
          <tr>
            <td>Climate</td>
            <td>Normal Irradiance</td>
            <!-- Earth is like 1.3-1.5k or something -->
            <td>${planet.apoapsisIrradiance.toFixed(2)} - ${planet.periapsisIrradiance.toFixed(2)} W/m<sup>2</sup></td>
          </tr>
        </table>
      </div>
    `
  }
}


module.exports = Infobox

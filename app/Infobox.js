// Infobox.js: Defines an Infobox class which can be told to display
// information on a star, planet, etc. in an element.

const mv = require('macroverse')

// TODO: Move this stuff to the macroverse module
let planetClasses = ['Lunar', 'Terrestrial', 'Uranian', 'Jovian', 'AsteroidBelt']

class Infobox {
  
  /// Construct an infobox rooted at the given HTML element, getting data to display from the given Datasource
  constructor(infobox, datasource) {
    // Save and set up the root element
    this.infobox = infobox
    this.infobox.classList.add('infobox')

    // Save the Datasource
    this.ds = datasource

    // Set up our unique ID generator.
    // TODO: No more than 1 Infobox per page unless we unique-ify this!
    this.nextId = 0
  }

  /// Show the infobox for a sector
  showSector(keypath) {
    // Prep the infobox
    this.infobox.classList.remove('infobox-star')
    this.infobox.classList.remove('infobox-planet')
    this.infobox.classList.add('infobox-sector')

    // Set up the main template
    this.infobox.innerHTML = `
      <div class="infobox-header">
        <span class="infobox-title">
          Sector ${keypath}
        </span>
      </div>
      <div class="infobox-body">
        <table class="infobox-table">
          <tr>
            <td>Number of Systems</td>
            <td>${this.when(keypath + '.objectCount')}</td>
          </tr>
        </table>
      </div>
    `
  }

  /// Show the infobox for the given star. If the user goes back, call the given callback.
  showStar(keypath, back) {
    this.infobox.classList.remove('infobox-planet')
    this.infobox.classList.remove('infobox-sector')
    this.infobox.classList.add('infobox-star')
    this.infobox.innerHTML = `
      <div class="infobox-header">
        <button class="infobox-back" id="infobox-back">&lt;</button>
        <span class="infobox-title">
          Star ${keypath}
        </span>
      </div>
      <div class="infobox-body">
        <table class="infobox-table">
          <tr>
            <td>Object Class</td>
            <td>${this.when(keypath + '.objClass', (x) => mv.objectClasses[x])}</td>
          </tr>
          <tr>
            <td>Spectral Type</td>
            <td>${this.when(keypath + '.objType', (x) => mv.spectralTypes[x])}</td>
          </tr>
          <tr>
            <td>Mass</td>
            <td>${this.when(keypath + '.objMass', (x) => x.toFixed(2))} M<sub>☉</sub></td>
          </tr>
          <tr>
            <td>Luminosity</td>
            <td>${this.when(keypath + '.luminosity', (x) => x.toFixed(2))} L<sub>☉</sub></td>
          </tr>
          <tr>
            <td>Habitable Zone</td>
            <td>${this.when(keypath + '.habitableZone.start', (x) => (x / mv.AU).toFixed(2))} - 
            ${this.when(keypath + '.habitableZone.end', (x) => (x / mv.AU).toFixed(2))} AU</td>
          </tr>
          <tr>
            <td>Planets</td>
            <td>${this.when(keypath + '.planetCount')}</td>
          </tr>
        </table>
      </div>
    `

    // Listen for back clicks
    this.infobox.querySelector('#infobox-back').addEventListener('click', back)
  }

  /// Show the infobox for the given planet, orbiting the given star. If the user goes back, call the given callback.
  showPlanet(planet, star, back) {
    this.infobox.classList.remove('infobox-star')
    this.infobox.classList.remove('infobox-sector')
    this.infobox.classList.add('infobox-planet')
    this.infobox.innerHTML = `
      <div class="infobox-header">
        <button class="infobox-back" id="infobox-back">&lt;</button>
        <span class="infobox-title">
          Planet ${star.sectorX},${star.sectorY},${star.sectorZ}/${star.number}/${planet.number}
        </span>
      </div>
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

    // Listen for back clicks
    this.infobox.querySelector('#infobox-back').addEventListener('click', back)
  }

  /// Internal function to lazy-load and format data from the Datasource.
  /// Takes a string keypath.
  /// Returns the text for an HTML element that looks like a throbber, and
  /// later replaces itself with the text returned from the callback called with
  /// the keypath's value, when it arrives.
  when(keypath, callback) {
    // Come up with a unique HTML ID for the element we will return.
    let id = 'infobox-when-' + this.nextId
    this.nextId++

    // Define the throbber HTML
    let throbber = `<span id="${id}" class="infobox-throbber">???</span>`

    // Set up the event handler
    this.ds.once(keypath, (value) => {
      let waiting = document.getElementById(id)
      if (waiting) {
        // It's still there and not gone.
        if (callback) {
          // Replace it with the returned string, parsed as HTML
          waiting.outerHTML = callback(value)
        } else {
          // Replace it with the text of the actual value, not parsed as HTML
          waiting.parentNode.insertBefore(document.createTextNode(value), waiting)
          // Delete the throbber itself
          waiting.parentNode.removeChild(waiting)
        }
      }
    })
    // Ask for the thing to actually be sent to us
    this.ds.request(keypath)

    // TODO: We assume the throbber makes it on to the actual page before the event handler can possibly run
    return throbber
  }
}


module.exports = Infobox

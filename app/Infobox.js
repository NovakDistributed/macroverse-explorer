// Infobox.js: Defines an Infobox class which can be told to display
// information on a star, planet, etc. in an element.

const timers = require('timers')

const { parentOf, lastComponent } = require('./keypath.js')

const mv = require('macroverse')

// TODO: Move this stuff to the macroverse module
let planetClasses = ['Lunar', 'Terrestrial', 'Uranian', 'Jovian', 'AsteroidBelt']

class Infobox {
  
  /// Construct an infobox rooted at the given HTML element, getting data to display from the given Datasource
  constructor(infobox, context) {
    // Save and set up the root element
    this.infobox = infobox
    this.infobox.classList.add('infobox')

    // Save the context
    this.ctx = context

    // Set up our unique ID generator.
    // TODO: No more than 1 Infobox per page unless we unique-ify this!
    this.nextId = 0

    // Set up listeners to context show messages, so we know what to look at
    this.ctx.on('show', (keypath) => {
      let parts = keypath.split('.')

      if (parts.length == 3) {
        // We want a sector
        this.showSector(keypath)
      } else if (parts.length == 4) {
        // This is a star
        this.showStar(keypath) 
      } else if (parts.length == 5) {
        // This is a planet
        this.showPlanet(keypath)
      }
    })
  }

  // Everything that needs a child picker can use this one
  // Turns a keypath and a number of children into a dropdown that shows the child selected
  makeChildPicker(keypath, count) {
    if (count == 0) {
      return 'None'
    }

    let root = document.createElement('select')
    root.classList.add('infobox-child-list')

    // Have an option that is a header/please-select value
    let header = document.createElement('option')
    header.innerText = 'Select...'
    root.appendChild(header)

    root.addEventListener('change', () => {
      // When an option is chosen, show the star
      if (root.selectedIndex == 0) {
        // They picked the placeholder header
        return
      }
      // Tell the context bus what we want to look at
      this.ctx.emit('show', keypath + '.' + (root.selectedIndex - 1))
    })
    
    for (let i = 0; i < count; i++) {
      // Make a button for each star
      let option = document.createElement('option')
      option.classList.add('infobox-child')
      option.innerText = i
      root.appendChild(option)
    }

    return root
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
          <tr>
            <td>Children</td>
            <td>${this.when(keypath + '.objectCount', (x) => this.makeChildPicker(keypath, x))}</td>
          </td>
        </table>
      </div>
    `
  }

  /// Show the infobox for the given star.
  showStar(keypath) {
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
          <tr>
            <td>Children</td>
            <td>${this.when(keypath + '.planetCount', (x) => this.makeChildPicker(keypath, x))}</td>
          </td>
        </table>

      </div>
    `

    // Listen for back clicks
    this.infobox.querySelector('#infobox-back').addEventListener('click', () => {
      this.ctx.emit('show', parentOf(keypath))  
    })
  }

  /// Show the infobox for the given planet, orbiting the given star.
  async showPlanet(keypath) {
    this.infobox.classList.remove('infobox-star')
    this.infobox.classList.remove('infobox-sector')
    this.infobox.classList.add('infobox-planet')
    this.infobox.innerHTML = `
      <div class="infobox-header">
        <button class="infobox-back" id="infobox-back">&lt;</button>
        <span class="infobox-title">
          Planet ${keypath}
        </span>
      </div>
      <div class="infobox-body">
        <table class="infobox-table">
          <tr>
            <td>Planet Class</td>
            <td colspan="2">${this.when(keypath + '.planetClass', (x) => planetClasses[x])}</td>
          </tr>
          <tr>
            <td>Mass</td>
            <td colspan="2">${this.when(keypath + '.planetMass', (x) => x.toFixed(2))} M<sub>⊕</sub></td>
          </tr>
          <tr>
            <td rowspan="4">Orbit</td>
            <td>Minimum</td>
            <td>${this.when(keypath + '.orbit.periapsis', (x) => (x / mv.AU).toFixed(2))} AU</td>
          </tr>
          <tr>
            <td>Maximum</td>
            <td>${this.when(keypath + '.orbit.apoapsis', (x) => (x / mv.AU).toFixed(2))} AU</td>
          </tr>
          <tr>
            <td>Period</td>
            <td>${this.when(keypath + '.orbit.period', (x) => (x / mv.SIDERIAL_YEAR).toFixed(2))} Y<sub>s</sub></td>
          </tr>
          <tr>
            <td>Inclination</td>
            <td>${this.when(keypath + '.orbit.inclination', (x) => mv.degrees(x).toFixed(2))}&deg;</td>
          </tr>
          <tr>
            <td>Climate</td>
            <td>Normal Irradiance</td>
            <!-- Earth is like 1.3-1.5k or something -->
            <td>${this.when(keypath + '.apoapsisIrradiance', (x) => x.toFixed(2))} - ${this.when(keypath + '.periapsisIrradiance', (x) => x.toFixed(2))} W/m<sup>2</sup></td>
          </tr>
        </table>
      </div>
    `

    // Listen for back clicks
    this.infobox.querySelector('#infobox-back').addEventListener('click', () => {
      this.ctx.emit('show', parentOf(keypath))
    })
  }

  /// Internal function to lazy-load and format data from the Datasource.
  /// Takes a string keypath and an optional callback.
  /// Returns the text for an HTML element that looks like a throbber, and
  /// later replaces itself with the text or DOM node returned from the callback called with
  /// the keypath's value, or the text value if there is no callback, when it arrives.
  when(keypath, callback) {
    // Come up with a unique HTML ID for the element we will return.
    let id = 'infobox-when-' + this.nextId
    this.nextId++

    // Define the throbber HTML
    let throbber = `<span id="${id}" class="infobox-throbber">???</span>`

    // Set up the event handler
    this.ctx.ds.once(keypath, (value) => {
      let waiting = document.getElementById(id)
      if (waiting) {
        // It's still there and not gone.
        if (callback) {
          // Run the callback with the value
          let result = callback(value)

          if (result instanceof HTMLElement) {
            // It is a dom node, so replace this one
            waiting.parentNode.insertBefore(result, waiting)
            waiting.parentNode.removeChild(waiting)
          } else {
            // Replace it with the returned string, parsed as HTML
            waiting.outerHTML = callback(value)
          }
        } else {
          // Replace it with the text of the actual value, not parsed as HTML
          waiting.parentNode.insertBefore(document.createTextNode(value), waiting)
          // Delete the throbber itself
          waiting.parentNode.removeChild(waiting)
        }
      }
    })
    timers.setImmediate(() => {
      // Ask for the thing to actually be sent to us.
      // But not until the caller has a chance to put the element in the page.
      this.ctx.ds.request(keypath)
    })
    
    // TODO: We assume the throbber makes it on to the actual page before the event handler can possibly run
    return throbber
  }
}


module.exports = Infobox

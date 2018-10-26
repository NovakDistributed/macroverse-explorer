// Infobox.js: Defines an Infobox class which can be told to display
// information on a star, planet, etc. in an element.

const timers = require('timers')

const { parentOf, lastComponent } = require('./keypath.js')

const mv = require('macroverse')

// Make a number fixed precision, with commas
function format(number) {
  if (number > 0.01) {
    // It is big enough to do 2 digits.
    return parseFloat(number.toFixed(2)).toLocaleString()
  } else {
    // Go out to 4 digits, for some really dim luminosities
    return number.toFixed(4)
  }
}

// Given a number and two corresponding lists of units, find the best unit and display the value
function formatWithUnits(number, unitNames, unitValues) {
  let bestIndex = 0
  let bestBadness = 99999

  if (number != 0) {
    // If 0, just use that first unit
    for (let index = 0; index < unitValues.length; index++) {
      // We just use exhaustive search
      let inUnit = number / unitValues[index]
      // The larger the absolute value of the logarithm, the less 1-y the number is
      let badness = Math.abs(Math.log(inUnit))
      if (badness < bestBadness) {
        // New winner!
        bestIndex = index
        bestBadness = badness
      }
    }
  }
  // Format in the given unit
  return format(number / unitValues[bestIndex]) + ' ' + unitNames[bestIndex]
  
}

// Define some units

// For mass all the unit values need to be in Earth masses
// We only use these for planets and moons, not stars
// We use nano-Earths as a convenient measure for asteroid-like things.
const MASS_UNIT_NAMES = ['M<sub>⊕</sub>', 'M<sub>L</sub>', 'nM<sub>⊕</sub>', 'kg']
const MASS_UNIT_VALUES = [1, 1/mv.LUNAR_MASSES_PER_EARTH_MASS, 1E-9, 1/mv.EARTH_MASS]

// For distance everything is in meters
const DISTANCE_UNIT_NAMES = ['AU', 'Δ<sub>⊕L</sub>', 'km']
const DISTANCE_UNIT_VALUES = [mv.AU, mv.LD, 1000]

// For time everything is in seconds
const TIME_UNIT_NAMES = ['Y<sub>s</sub>', 'D', 'H', 'M', 'S']
const TIME_UNIT_VALUES = [mv.SIDERIAL_YEAR, mv.DAY, 60 * 60, 60]

// Define a dedicated callback for formatting masses with units
function formatMass(number) {
  return formatWithUnits(number, MASS_UNIT_NAMES, MASS_UNIT_VALUES)
}

// And a dedicated callback for formatting distances with units
function formatDistance(number) {
  return formatWithUnits(number, DISTANCE_UNIT_NAMES, DISTANCE_UNIT_VALUES)
}

// And a dedicated callback for formatting times with units
function formatTime(number) {
  return formatWithUnits(number, TIME_UNIT_NAMES, TIME_UNIT_VALUES)
}

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
      } else if (parts.length == 6) {
        // This is a moon
        this.showMoon(keypath)
      }
    })
  }

  // Everything that needs a child picker can use this one
  // Turns a keypath and a number of children into a dropdown that shows the child selected
  // If callback is specified, puts the HTML returned by callback in the option, after the number.
  makeChildPicker(keypath, count, callback) {
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
      if (callback) {
        // Option text should be the number and the callback result
        option.innerHTML = i + ' - ' + callback(i)
      } else {
        // Option text is just the number
        option.innerText = i
      }
      root.appendChild(option)
    }

    return root
  }

  /// Clear off all the classes specific to infoboxes for particular kinds of thing
  clearClasses() {
    let classes = ['infobox-sector', 'infobox-star', 'infobox-planet', 'infobox-moon']
    for (let className of classes) {
      this.infobox.classList.remove(className)
    }
  }

  /// Show the infobox for a sector
  showSector(keypath) {
    // Prep the infobox
    this.clearClasses()
    this.infobox.classList.add('infobox-sector')

    // Define a function to make short star summaries for the child picker
    let starDescriptionCallback = (i) => {
      // The description will have the class and type in it
      return this.when(keypath + '.' + i + '.objClass', (x) =>  mv.objectClasses[x]) + ' ' +
        this.when(keypath + '.' + i + '.objType', (x) => mv.spectralTypes[x])
    }

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
            <td>${this.when(keypath + '.objectCount', (x) => this.makeChildPicker(keypath, x, starDescriptionCallback))}</td>
          </td>
        </table>
      </div>
    `
  }

  /// Show the infobox for the given star.
  showStar(keypath) {
    this.clearClasses()
    this.infobox.classList.add('infobox-star')

    // Define a function to make short planet summaries for the child picker
    let planetDescriptionCallback = (i) => {
      // The description will have the class in it
      return this.when(keypath + '.' + i + '.planetClass', (x) =>  mv.worldClasses[x])
    }

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
            <td>${this.when(keypath + '.objMass', (x) => format(x))} M<sub>☉</sub></td>
          </tr>
          <tr>
            <td>Luminosity</td>
            <td>${this.when(keypath + '.luminosity', (x) => format(x))} L<sub>☉</sub></td>
          </tr>
          <tr>
            <td>Habitable Zone</td>
            <td>${this.when(keypath + '.habitableZone.start', (x) => format(x / mv.AU))} - 
            ${this.when(keypath + '.habitableZone.end', (x) => format(x / mv.AU))} AU</td>
          </tr>
          <tr>
            <td>Planets</td>
            <td>${this.when(keypath + '.planetCount')}</td>
          </tr>
          <tr>
            <td>Children</td>
            <td>${this.when(keypath + '.planetCount', (x) => this.makeChildPicker(keypath, x, planetDescriptionCallback))}</td>
          </td>
        </table>

      </div>
    `

    // Listen for back clicks
    this.infobox.querySelector('#infobox-back').addEventListener('click', () => {
      this.ctx.emit('show', parentOf(keypath))  
    })
  }

  /// Show the infobox for the given planet.
  async showPlanet(keypath) {
    this.clearClasses()
    this.infobox.classList.add('infobox-planet')

    // Define a function to make short moon summaries for the child picker
    let moonDescriptionCallback = (i) => {
      // The description will have the class in it
      return this.when(keypath + '.' + i + '.planetClass', (x) =>  mv.worldClasses[x])
    }

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
            <td colspan="2">${this.when(keypath + '.planetClass', (x) => mv.worldClasses[x])}</td>
          </tr>
          <tr>
            <td>Mass</td>
            <td colspan="2">${this.when(keypath + '.planetMass', (x) => formatMass(x), '???? M<sub>⊕</sub>')}</td>
          </tr>
          <tr>
            <td rowspan="4">Orbit</td>
            <td>Minimum</td>
            <td>${this.when(keypath + '.orbit.periapsis', (x) => formatDistance(x), '???? AU')}</td>
          </tr>
          <tr>
            <td>Maximum</td>
            <td>${this.when(keypath + '.orbit.apoapsis', (x) => formatDistance(x), '???? AU')}</td>
          </tr>
          <tr>
            <td>Period</td>
            <td>${this.when(keypath + '.orbit.period', (x) => formatTime(x), '???? Y<sub>s</sub>')}</td>
          </tr>
          <tr>
            <td>Inclination</td>
            <td>${this.when(keypath + '.orbit.inclination', (x) => format(mv.degrees(x)))}&deg;</td>
          </tr>
          <tr>
            <td>Climate</td>
            <td>Normal Irradiance</td>
            <!-- Earth is like 1.3-1.5k or something -->
            <td>${this.when(keypath + '.apoapsisIrradiance', (x) => format(x))} -
            ${this.when(keypath + '.periapsisIrradiance', (x) => format(x))} W/m<sup>2</sup></td>
          </tr>
          <tr>
            <td>Children</td>
            <td colspan="2">${this.when(keypath + '.moonCount', (x) => this.makeChildPicker(keypath, x, moonDescriptionCallback))}</td>
          </td>
        </table>
      </div>
    `

    // Listen for back clicks
    this.infobox.querySelector('#infobox-back').addEventListener('click', () => {
      this.ctx.emit('show', parentOf(keypath))
    })
  }

  /// Show the infobox for the given moon.
  async showMoon(keypath) {
    this.clearClasses()
    this.infobox.classList.add('infobox-moon')
    this.infobox.innerHTML = `
      <div class="infobox-header">
        <button class="infobox-back" id="infobox-back">&lt;</button>
        <span class="infobox-title">
          Moon ${keypath}
        </span>
      </div>
      <div class="infobox-body">
        <table class="infobox-table">
          <tr>
            <td>Planet Class</td>
            <td colspan="2">${this.when(keypath + '.planetClass', (x) => mv.worldClasses[x])}</td>
          </tr>
          <tr>
            <td>Mass</td>
            <td colspan="2">${this.when(keypath + '.planetMass',  (x) => formatMass(x), '???? M<sub>L</sub>')}</td>
          </tr>
          <tr>
            <td rowspan="4">Orbit</td>
            <td>Minimum</td>
            <td>${this.when(keypath + '.orbit.periapsis', (x) => formatDistance(x), '???? Δ<sub>⊕L</sub>')}</td>
          </tr>
          <tr>
            <td>Maximum</td>
            <td>${this.when(keypath + '.orbit.apoapsis', (x) => formatDistance(x), '???? Δ<sub>⊕L</sub>')}</td>
          </tr>
          <tr>
            <td>Period</td>
            <td>${this.when(keypath + '.orbit.period', (x) => formatTime(x), '???? D')}</td>
          </tr>
          <tr>
            <td>Inclination</td>
            <td>${this.when(keypath + '.orbit.inclination', (x) => format(mv.degrees(x)))}&deg;</td>
          </tr>
          <tr>
            <td>Climate</td>
            <td>Normal Irradiance</td>
            <!-- Earth is like 1.3-1.5k or something -->
            <td>${this.when(keypath + '.apoapsisIrradiance', (x) => format(x))} -
            ${this.when(keypath + '.periapsisIrradiance', (x) => format(x))} W/m<sup>2</sup></td>
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
  /// Takes a string keypath, an optional callback, and an optional custopm placeholder.
  /// Returns the text for an HTML element that looks like a throbber, and
  /// later replaces itself with the text or DOM node returned from the callback called with
  /// the keypath's value, or the text value if there is no callback, when it arrives.
  when(keypath, callback, placeholder) {
    // Come up with a unique HTML ID for the element we will return.
    let id = 'infobox-when-' + this.nextId
    this.nextId++
    
    if (placeholder === undefined) {
      // Provide a placeholder
      placeholder = '????'
    }

    // Define the throbber HTML
    let throbber = `<span id="${id}" class="infobox-throbber">${placeholder}</span>`

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

// Loading.js: defines a loading screen that can display and hide itself, and
// update progress, according to messages on the main EventEmitter bus.

const { placeDomNode } = require('./halfact.js')

class LoadingScreen {
  // Construct a LoadingScreen that reads from the given event bus and displays itself in the element with the given ID
  constructor(bus, elementId) {
    
    // Save the message bus
    this.bus = bus

    // Save the element to display in
    this.element = document.getElementById(elementId)

    // Hide to start
    this.element.style.display = 'none'

    // Add something to distract the user in the middle
    this.element.innerHTML = `
      <div class="loading-distraction"></div>
    `

    // Make progress bars
    this.bars = []
    // And captions
    this.captions = []
    // And the units that hold them and are shown/hidden
    this.units = []
    for (let i = 0; i < 3; i++) {
      let barHolder = document.createElement('div')
      barHolder.classList.add('loading-level')
      let bar = document.createElement('progress')
      bar.classList.add('loading-bar')
      let caption = document.createElement('p')
      caption.classList.add('loading-caption')
      this.bars.push(bar)
      this.captions.push(caption)
      this.units.push(barHolder)

      barHolder.appendChild(caption)
      barHolder.appendChild(bar)

      this.element.appendChild(barHolder)
    }

    // We will map in here from level to {nonce, total, done} objects
    this.in_progress = {}
  
    // Listen to loading start events
    this.bus.on('load-start', (level, nonce, items) => {
      // Start loading the given number of things at the given level, using the given nonce
      // Level 0 = sector, 1 = system, 2 = moon system

      this.in_progress[level] = {nonce: nonce, total: items, done: 0}
    
      // Show the screen
      this.update(level)
    })

    this.bus.on('load-item', (level, nonce) => {
      // Mark an item at the given level, with the given nonce, as loaded

      if (this.in_progress[level] && this.in_progress[level].nonce == nonce) {
        this.in_progress[level].done++

        // Re-render the loading screen
        this.update(level)

        if (this.in_progress[level].done >= this.in_progress[level].total) {
          // Loading is done for this level!
          this.hide(level)
        }
      }

    })

    this.bus.on('show', (keypath) => {
      // Catch when a new item is going to be shown.
      // Cancel loading at higher levels.

      let parts = keypath.split('.')

      for (let i = 2; i >= 0; i--) {
        if (parts.length <= 3 + i) {
          // We're moving to a new thing at this level or lower.
          // Stop the load at this level.
          this.in_progress[i] = undefined
          this.hide(i)
        }
      }
    })
  }

  hide(level) {
    // Hide the loading unit
    this.units[level].style.display = 'none'

    // If all levels are done, hide the loading screen
    let anythingLoading = false
    for (let i = 0; i < 3; i++) {
      if (this.in_progress[i]) {
        anythingLoading = true
      }
    }
    
    if (!anythingLoading) {
      this.element.style.display = 'none'
    }
  }

  update(level) {
    // Show the loading div
    this.units[level].style.display = 'block'

    // Work out what this is
    let kind = (level == 0 ? 'sector' : (level == 1 ? 'star system' : 'lunar system'))

    // Set the caption
    this.captions[level].innerText = 'Loading ' + kind + '...'

    // Set up the bar
    this.bars[level].setAttribute('max', this.in_progress[level].total)
    this.bars[level].setAttribute('value', this.in_progress[level].done)

    this.element.style.display = 'flex' 

  }



}


module.exports = LoadingScreen

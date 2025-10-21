// This module implements the UI indicating that a scan is running

import { Stylable } from '/js/mixins.mjs';
import { createElement as E } from '/js/util.mjs';

class ScanProgress extends Stylable(HTMLElement) {
    #progresses;
    #child;

    constructor() {
        super();
        this.addStylesheet('components/scan-progress.css');
        this.#progresses = {};
        this.#child = this.shadowRoot;
    }

    // Add a progress frame
    add(name) {
        this.#child = this.#child.appendElement({ tag: 'div', className: 'progress', attributes: { dataRadio: name } });
        this.#progresses[name] = this.#child;
        this.set(name, 0);
    }

    // Set the value of a progress frame ([0..1] range)
    set(name, value) {
        this.#progresses[name].style.setProperty('--progress', `${value * 100}%`);
    }

    // Set a progress frame as complete
    done(name) {
        const progress = this.#progresses[name];
        progress.style.setProperty('--progress', `100%`);
        progress.classList.add('done');
    }
}

try {
    customElements.define('scan-progress', ScanProgress);
}
catch (e) {
  if (!(e instanceof DOMException))
    throw e;
}

// This module implements the UI wheel

import { Stylable } from '/js/mixins.mjs';
import { createElement } from '/js/util.mjs';

class MagicWheel extends Stylable(HTMLElement) {
    constructor() {
        super();
        this.addStylesheet('components/magic-wheel.css');

        const manualBtn = createElement('div', null, null, "SCAN");
        this.appendToShadow(manualBtn);
        manualBtn.addEventListener('click', () => document.scene.requestMeasurement());
    }
}

try {
    customElements.define('magic-wheel', MagicWheel);
}
catch (e) {
  if (!(e instanceof DOMException))
    throw e;
}

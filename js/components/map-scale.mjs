// This module implements a metric and imperial scale for the minimap

import { Stylable } from '/js/mixins.mjs';
import { createElement } from '/js/util.mjs';

class MapScale extends Stylable(HTMLElement) {
    #metric;
    #metricDiv;
    #imperial;
    #imperialDiv;

    constructor() {
        super();

        this.#metricDiv = createElement('div', 'metric');
        this.appendToShadow(this.#metricDiv);
        this.#imperialDiv = createElement('div', 'imperial');
        this.appendToShadow(this.#imperialDiv);

        this.#metric = [];
        this.#imperial = [];
        for (let i = 0; i < 5; i++) {
            const mDiv = createElement('div')
            const iDiv = createElement('div')
            this.#metric.push(mDiv);
            this.#imperial.push(iDiv);
            this.#metricDiv.appendChild(mDiv);
            this.#imperialDiv.appendChild(iDiv);
        }

        this.addStylesheet('components/map-scale.css');
    }

    #closestN(n) {
        for (const k of [1, 2, 5, 10, 20, 50, 100, 200, 500]) {
            if (k >= n) {
                return k;
            }
        }
        return 1000;
    }

    #rescale(scale) {
        const metricN = this.#closestN(20 / scale);
        const metricWidth = metricN * scale;
        const imperialN = this.#closestN(65.6168 / scale);
        const imperialWidth = imperialN * scale * .3048;

        this.#metricDiv.style.setProperty('--metric-width', `${metricWidth}px`);
        this.#imperialDiv.style.setProperty('--imperial-width', `${imperialWidth}px`);

        for (let i = 0; i < 5; i++) {
            this.#metric[i].dataset.scale = (i + 1) * metricN;
            this.#imperial[i].dataset.scale = (i + 1) * imperialN;
        }
    }

    static get observedAttributes() {
        return ['scale'];
    }

    attributeChangedCallback(name, old, current) {
        switch (name) {
            case 'scale':
                this.#rescale(parseFloat(current));
                break;
        }
    }
}

try {
    customElements.define('map-scale', MapScale);
}
catch (e) {
  if (!(e instanceof DOMException))
    throw e;
}

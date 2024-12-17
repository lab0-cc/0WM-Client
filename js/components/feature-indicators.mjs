// This module implements indicators for Web API features

import { Stylable } from '/js/mixins.mjs';
import { createElement } from '/js/util.mjs';

const STATES = { prompt: "pending", granted: "enabled", denied: "disabled", unsupported: "not supported" }

class FeatureIndicators extends Stylable(HTMLElement) {
    #features;

    constructor() {
        super();

        this.#features = { xr: { description: "WebXR", div: null },
                           planes: { description: "Plane detection", div: null },
                           gps: { description: "GPS", div: null } };
        for (const feature in this.#features) {
            const featureDiv = createElement('div', feature);
            this.#features[feature].div = featureDiv;
            this.appendToShadow(featureDiv);
        }

        // TODO: die
        if (navigator.xr === undefined) {
            this.update('xr', 'unsupported');
            this.update('planes', 'unsupported');
        }
        else {
            this.update('xr', 'prompt');
            this.update('planes', 'prompt');
        }

        if (navigator.geolocation === undefined) {
            this.update('gps', 'unsupported');
        }
        else {
            this.#getPermission('geolocation').then(e => this.update('gps', e));
        }

        this.addStylesheet('components/feature-indicators.css');

        this.addEventListener('click', this.#toggleDisplay);
    }

    async #getPermission(permission) {
        try {
            return (await navigator.permissions.query({ name: permission })).state;
        }
        catch (error) {
            return 'unsupported';
        }
    }

    update(feature, state) {
        const feat = this.#features[feature];
        feat.div.className = `${feature} ${state}`;
        feat.div.textContent = `${feat.description} ${STATES[state]}`;
    }

    activate(feature) {
        this.#features[feature].div.classList.add('active');
        setTimeout(() => this.#features[feature].div.classList.remove('active'), 100);
    }

    #toggleDisplay() {
        if (this.classList.contains('open'))
            this.classList.remove('open');
        else
            this.classList.add('open');
    }
}

try {
    customElements.define('feature-indicators', FeatureIndicators);
}
catch (e) {
  if (!(e instanceof DOMException))
    throw e;
}

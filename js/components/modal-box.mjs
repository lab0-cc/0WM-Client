// This module implements modal boxes

import { Stylable } from '/js/mixins.mjs';
import { createElement } from '/js/util.mjs';

class ModalBox extends Stylable(HTMLElement) {
    #childrenObserver;
    #closable;
    #inner;

    constructor() {
        super();

        const outer = createElement('div', 'outer');
        this.appendToShadow(outer);

        this.#inner = createElement('div', 'inner');
        this.appendToShadow(this.#inner);

        this.addStylesheet('components/modal-box.css');
        this.#closable = true;

        outer.addEventListener('click', this.#close.bind(this));
        this.#childrenObserver = new MutationObserver(() => this.#childrenReady());
    }

    connectedCallback() {
        this.#childrenObserver.observe(this, { childList: true, subtree: true });
        if (this.hasChildNodes())
            this.#childrenReady();
    }

    #childrenReady() {
      [...this.children].forEach(e => this.#inner.appendChild(e));
    }

    #close() {
        if (this.#closable)
            this.remove();
    }

    static get observedAttributes() {
        return ['closable', 'height', 'width'];
    }

    attributeChangedCallback(name, old, current) {
        switch (name) {
            case 'closable':
                this.#closable = current != 'no';
                break;
            case 'height':
                this.#inner.style.height = `${current}px`;
                break;
            case 'width':
                this.#inner.style.width = `${current}px`;
                break;
        }
    }
}

try {
    customElements.define('modal-box', ModalBox);
}
catch (e) {
  if (!(e instanceof DOMException))
    throw e;
}

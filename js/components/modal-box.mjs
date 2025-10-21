// This module implements modal boxes

import { Stylable } from '/js/mixins.mjs';
import { createElement as E } from '/js/util.mjs';

class ModalBox extends Stylable(HTMLElement) {
    #childrenObserver;
    #closable;
    #inner;
    #progress;
    #progressOnly;

    constructor() {
        super();

        const outer = this.appendToShadow(E('div', 'outer'));
        this.#inner = this.appendToShadow(E('div', 'inner'));

        this.addStylesheet('components/modal-box.css');
        this.#closable = true;

        outer.addEventListener('click', this.#close.bind(this));
        this.#childrenObserver = new MutationObserver(() => this.#childrenReady());

        this.#progress = new Map();
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

    addProgress(key, text) {
        const oldProgress = this.#progress.get(key);
        if (oldProgress !== undefined)
            oldProgress.remove();
        const progress = this.#inner.appendElement({ tag: 'span', className: 'progress', content: text });
        progress.appendElement({ tag: 'span', className: 'progress-indicator' });
        this.#progress.set(key, progress);
        this.#updateProgress();
        return progress;
    }

    removeProgress(key) {
        const progress = this.#progress.get(key);
        if (progress === undefined)
            return
        progress.remove();
        this.#progress.delete(key);
        this.#updateProgress();
    }

    clearProgress() {
        for (const [key, progress] of this.#progress) {
            progress.remove();
            this.#progress.delete(key);
        }
    }

    completeProgress(key, collect=true) {
        const progress = this.#progress.get(key);
        if (progress === undefined)
            return
        progress.classList.add('ok');
        if (collect)
            progress.classList.add('collect');
        this.#updateProgress();
    }

    errProgress(key, collect=true) {
        const progress = this.#progress.get(key);
        if (progress === undefined)
            return
        progress.classList.add('error');
        if (collect)
            progress.classList.add('collect');
        this.#updateProgress();
    }

    #updateProgress() {
        if (this.#progressOnly && this.#progress.values().every(e => e.classList.contains('collect'))) {
            this.style.display = 'none';
            this.clearProgress();
        }
        else {
            this.style.removeProperty('display');
        }
    }

    static get observedAttributes() {
        return ['closable', 'height', 'progress', 'width'];
    }

    attributeChangedCallback(name, old, current) {
        switch (name) {
            case 'closable':
                this.#closable = current != 'no';
                break;
            case 'height':
                this.#inner.style.height = `${current}px`;
                break;
            case 'progress':
                this.#progressOnly = current != 'no';
                this.#updateProgress();
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

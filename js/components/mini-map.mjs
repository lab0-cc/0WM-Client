// This module implements the minimap features of the webapp

import { Context2D } from '/js/context2d.mjs';
import { Angle2, BoundingBox2, Matrix2, Point2, Polygon2, Quaternion, Vector2 } from '/js/linalg.mjs';
import { Stylable } from '/js/mixins.mjs';
import { createElement, jfetch } from '/js/util.mjs';

const MODES = [{ id: 'manual', title: 'Manual mode', description: 'Fully manual map positioning' },
               { id: 'assisted', title: 'Assisted mode', description: 'The server helps you select a floor plan (requires GPS)' },
               { id: 'automatic', title: 'Automatic mode', description: 'The server helps you select and position a floor plan (requires GPS and wall detection)' }];

class MiniMap extends Stylable(HTMLElement) {
    // Canvas variables
    //-- Canvas elements
    #canvas;
    #ctx;
    #mapScale;
    //-- Technical variables
    #center;
    #savedOrientation;
    #savedPath;
    #savedWalls;
    #scale;
    //-- Cosmetic variables
    #arrowLength;
    #arrowWidth;
    #pathWidth;

    // Floor plan variables
    //-- Placement modes
    #currentMode;
    #modeSelector;
    //-- Floor plan browser
    #mapSelector;
    //-- Touch variables
    #trackedTouches;
    #additionalTouches;
    //-- Technical variables
    #mapImage;
    #mapTransform;
    #mapOrigin;
    #savedMapOrigin;
    #mapAngle;
    #savedMapAngle;
    #heatmap;
    #heatmapBB;

    constructor() {
        super();

        const width = 150 * (window.devicePixelRatio || 1);
        this.#canvas = createElement('canvas', null, { height: width, width });
        this.appendToShadow(this.#canvas);
        this.#ctx = this.#canvas.getContext('2d');
        Object.setPrototypeOf(this.#ctx, Context2D.prototype);
        this.#pathWidth = .5;
        this.#arrowLength = .666;
        this.#arrowWidth = .333;
        this.#savedOrientation = null;
        this.#savedPath = [new Point2(0, 0)];
        this.#savedWalls = [];

        const topBar = createElement('div', 'top-bar');
        this.appendToShadow(topBar);

        const editor = createElement('div', 'map-editor');
        const container = createElement('div', 'container');
        const editBtn = createElement('div', 'button right');
        editBtn.textContent = "Edit";
        container.appendChild(editBtn);
        this.#modeSelector = createElement('div', 'select');
        container.appendChild(this.#modeSelector);
        this.#mapSelector = createElement('div', 'select incomplete');
        this.#mapSelector.textContent = 'No map selected';
        container.appendChild(this.#mapSelector);
        editor.appendChild(container);
        topBar.appendChild(editor);
        this.#modeSelector.addEventListener('click', this.#editMode.bind(this));
        this.#setMode(MODES[0]);
        this.#mapSelector.addEventListener('click', this.#browseFloorplans.bind(this));

        const closeBtn = createElement('div', 'close');
        topBar.appendChild(closeBtn);

        this.#mapScale = createElement('map-scale');
        this.appendToShadow(this.#mapScale);

        this.#trackedTouches = new Map();
        this.#additionalTouches = new Map();

        this.#heatmap = null;

        this.addStylesheet('components/mini-map.css');

        this.#canvas.addEventListener('touchstart', this.#touchStart.bind(this));
        this.#canvas.addEventListener('touchmove', this.#touchMove.bind(this));
        this.#canvas.addEventListener('touchend', this.#touchEnd.bind(this));
        this.#canvas.addEventListener('touchcancel', this.#touchEnd.bind(this));

        this.addEventListener('click', this.#zoom);
        this.addEventListener('transitionend', this.#resize);
        closeBtn.addEventListener('click', this.#unzoom.bind(this));

        this.#updateViewport();
        // Browsers behave differently if the floor plan is not explicitely in the DOM. Let’s put it
        // in the body, with a hidden visibility to force loading and proper sizing (which we will
        // correct later).
        // TODO: custom loading
        this.#mapImage = createElement('img', null, { src: '/placeholder.svg' });
        this.#mapImage.addEventListener('load', this.#resetMapTransform.bind(this));
        this.#mapImage.style.visibility = 'hidden';
        this.#mapTransform = new Matrix2(.05);
        document.body.appendChild(this.#mapImage);
    }

    // Save the floor plan state before touch transformations are applied
    #saveMapData() {
        this.#savedMapOrigin = this.#mapOrigin;
        this.#savedMapAngle = this.#mapAngle;
    }

    // Convert a TouchList into an (identifier => { x, y }) map, with global coordinates
    #buildTouchMap(touches) {
        const map = new Map();
        const { x, y } = this.#canvas.getBoundingClientRect();
        for (const { identifier, clientX, clientY } of touches) {
            map.set(identifier, this.#scaleFromViewport(new Point2(clientX - x, clientY - y)));
        }
        return map;
    }

    // Handle the touchstart event for the floor plan
    #touchStart(e) {
        const touches = this.#buildTouchMap(e.touches);
        const { x, y } = this.#canvas.getBoundingClientRect();
        for (const { identifier, clientX, clientY } of e.changedTouches) {
            const touch = this.#scaleFromViewport(new Point2(clientX - x, clientY - y));
            switch (this.#trackedTouches.size) {
                // If we are tracking a single point, update it, as we are changing the touch
                // behavior
                case 1:
                    this.#trackedTouches.forEach((_, id, m) => m.set(id, touches.get(id)));
                // If we are tracking zero or one point, add the new point to those tracked and save
                // the current state
                case 0:
                    this.#trackedTouches.set(identifier, touch);
                    this.#saveMapData();
                    break;
                // We do not handle more than two touch points, but we are keeping the others in
                // case a point is no longer tracked
                default:
                    this.#additionalTouches.set(identifier, touch);
                    break;
            }
        }
    }

    // Handle the touchend and touchcancel events for the floor plan
    #touchEnd(e) {
        const touches = this.#buildTouchMap(e.touches);
        for (const { identifier } of e.changedTouches) {
            // Remove untracked points when they disappear
            if (this.#additionalTouches.delete(identifier))
                continue;

            if (this.#trackedTouches.delete(identifier)) {
                // If additional points are untracked, track the first one in insertion order and
                // update it
                if (this.#additionalTouches.size > 0) {
                    const [id, touch] = this.#additionalTouches.entries().next().value;
                    this.#additionalTouches.delete(id);
                    this.#trackedTouches.set(id, touch)
                }
                // Update the tracked points, as we are changing (or resetting) the touch behavior
                this.#trackedTouches.forEach((_, id, m) => m.set(id, touches.get(id)));
                this.#saveMapData();
            }
        }
    }

    // Handle the touchmove event for the floor plan
    #touchMove(e) {
        const touches = this.#buildTouchMap(e.touches);
        const anchors = [];
        this.#trackedTouches.forEach((touch, id, _) => anchors.push({ from: touch, to: touches.get(id) }));
        switch (this.#trackedTouches.size) {
            // The one-point handler moves the floor plan origin
            case 1:
                this.#mapOrigin = this.#savedMapOrigin.plus(anchors[0].from.to(anchors[0].to));
                break;
            // The two-point handler finds the only direct similarity mapping the two initial points
            // to the two current ones, and applies it to the floor plan origin and scaling factor
            default:
                const fromV = anchors[0].from.to(anchors[1].from);
                const toV = anchors[0].to.to(anchors[1].to);
                // Compute the rigid transformation
                const delta = Math.atan2(toV.y, toV.x) - Math.atan2(fromV.y, fromV.x);
                this.#mapAngle = this.#savedMapAngle + delta;
                const fromHalf = anchors[0].from.plus(fromV.scaled(.5));
                const toHalf = anchors[0].to.plus(toV.scaled(.5));
                this.#mapOrigin = toHalf.plus(fromHalf.to(this.#savedMapOrigin)
                                        .rotated(new Angle2(delta)));
                break;
        }
        this.#redraw();
    }

    // Resize the viewport depending on the displayed elements
    #updateViewport(viewport = null, ratio = 1) {
        let scale;
        if (viewport === null) {
            scale = 20;
        }
        else {
            this.#center = viewport.center();
            scale = Math.min(20, .8 * this.#canvas.width / (ratio * viewport.width()),
                                 .8 * this.#canvas.height / (ratio * viewport.height()));
        }
        if (this.#scale !== scale) {
            this.#scale = scale;
            this.#mapScale.setAttribute('scale', scale);
        }
    }

    // Transform a point from the viewport to global coordinates
    #scaleFromViewport(p) {
        return new Point2(this.#center.x + (p.x - this.#canvas.width / 2) / this.#scale,
                          this.#center.y + (p.y - this.#canvas.height / 2) / this.#scale);
    }

    // Zoom the minimap
    #zoom() {
        if (!this.classList.contains('zoomed')) {
            this.classList.add('zoomed');
            this.classList.add('zooming');
        }
    }

    // Unzoom the minimap
    #unzoom(e) {
        this.classList.add('zooming');
        this.classList.remove('zoomed');
        e.stopPropagation();
    }

    // Update the minimap canvas after zoom/unzoom transition
    #resize() {
        const width = window.getComputedStyle(this).width.slice(0, -2) * (window.devicePixelRatio || 1);
        this.#canvas.height = width;
        this.#canvas.width = width;
        this.#redraw();
        this.classList.remove('zooming');
    }

    // Set the floor plan placement mode
    #setMode(mode) {
        this.#currentMode = mode.id;
        this.#modeSelector.textContent = mode.title;
    }

    // Edit the floor plan placement mode
    #editMode() {
        const modal = createElement('modal-box', null, { width: 260 });
        for (const mode of MODES) {
            const choice = createElement('div', 'choice');
            const radio = createElement('input', null, { type: 'radio', name: 'mode', id: `mode-${mode.id}` });
            if (this.#currentMode === mode.id)
                radio.checked = true;
            choice.appendChild(radio);
            const label = createElement('label', null, { for: radio.id });
            const title = createElement('span', 'title');
            title.textContent = mode.title;
            label.appendChild(title);
            const description = createElement('span', 'description');
            description.textContent = mode.description;
            label.appendChild(description);
            choice.appendChild(label);
            modal.appendChild(choice);
            radio.addEventListener('click', e => {
                this.#setMode(mode);
                modal.remove();
            });

            // TODO: implement the rest
            if (mode.id !== 'manual') {
                radio.disabled = true;
                choice.classList.add('disabled');
            }
        }
        document.body.appendChild(modal);
    }

    // Browse the available floorplans
    #browseFloorplans() {
        const modal = createElement('modal-box', null, { width: 300 });
        const items = createElement('div', 'map-items');
        modal.appendChild(items);
        const api = window.app.api();
        jfetch(`${api}/maps?recurse`, data => {
            for (const { name, path, anchors } of Object.values(data)) {
                const src = `${api}/${path.replace(/\.([^.]+)$/, '_thumb.$1')}`;
                const item = createElement('div', 'map-item');
                item.appendChild(createElement('img', null, { src, alt: name }));
                item.appendChild(createElement('div', null, null, name));
                item.addEventListener('click', () => {
                    this.#projectMap(anchors);
                    this.#mapImage.src = `${api}/${path}`;
                    this.#mapSelector.textContent = name;
                    this.#mapSelector.classList.remove('incomplete');
                    modal.remove();
                })
                items.appendChild(item);
            }
        });
        document.body.appendChild(modal);
    }

    // Draw the scene on the minimap
    draw(orientation, path, walls=[]) {
        // Precompute the viewport dimensions
        const ratio = window.devicePixelRatio || 1;
        this.#updateViewport(new Polygon2(path.concat(walls.flat())).boundingBox(), ratio);
        const scale = this.#scale * ratio;

        // Save the current data for redraws
        this.#savedOrientation = orientation;
        this.#savedPath = path;
        this.#savedWalls = walls;

        // Reset the context
        this.#ctx.clearRect(new Point2(0, 0), new Vector2(this.#canvas.width, this.#canvas.height));
        this.#ctx.lineCap = 'round';
        this.#ctx.lineJoin = 'round';

        const center = new Point2(this.#canvas.width, this.#canvas.height)
                           .scaled(.5).minus(this.#center.scaled(scale));

        // Compute the transformation matrix for the floor plan
        this.#ctx.setTransform(new Matrix2(scale, new Angle2(this.#mapAngle)).mul(this.#mapTransform),
                               center.plus(this.#mapOrigin.scaled(scale)));
        this.#ctx.drawImage(this.#mapImage, Point2.origin);

        // Switch to a simple viewport homothety
        this.#ctx.setTransform(new Matrix2(scale), center);

        if (this.#heatmap !== null) {
            this.#ctx.globalCompositeOperation = 'darken';
		    this.#ctx.drawImage(this.#heatmap, this.#heatmapBB.min,
                                new Vector2(this.#heatmapBB.width(), this.#heatmapBB.height()));
            this.#ctx.globalCompositeOperation = 'source-over';
        }

        // If we have a path to show, do it
        if (path.length > 1) {
            this.#ctx.lineWidth = this.#pathWidth;

            let alpha = 1;

            const colors = ['#00f'];
            length = 0;
            for (let i = path.length - 2; i >= 0; i--) {
                length += path[i].to(path[i + 1]).norm();
                alpha = Math.max(1 - length / 20, .1);
                colors.push(`rgb(0 0 255 / ${alpha})`);
            }

            this.#ctx.strokeGradient(path.toReversed(), colors);
        }

        // Draw the walls
        this.#ctx.strokeStyle = 'purple';
        this.#ctx.lineWidth = this.#pathWidth;
        this.#ctx.beginPath();
        for (const [min, max] of walls) {
            this.#ctx.moveTo(min);
            this.#ctx.lineTo(max);
        }
        this.#ctx.stroke();

        // Draw the current position as a red arrow
        if (orientation !== null) {
            const p = path[path.length - 1];
            // The 2D orientation we want is the yaw, negated because canvases are left handed
            const yaw = new Quaternion(orientation.w, orientation.x, orientation.y,
                                       orientation.z).yaw().neg();

            this.#ctx.fillStyle = 'red';
            this.#ctx.beginPath();
            this.#ctx.moveTo(p.plus(new Vector2(this.#arrowLength, 0).rotated(yaw)));
            const v = new Vector2(0, this.#arrowWidth).rotated(yaw);
            this.#ctx.lineTo(p.plus(v));
            this.#ctx.lineTo(p.minus(v));
            this.#ctx.closePath();
            this.#ctx.fill();
        }

        this.#ctx.resetTransform();
    }

    #redraw() {
        this.draw(this.#savedOrientation, this.#savedPath, this.#savedWalls);
    }

    // Attach a heatmap to the minimap
    attachHeatmap(svg, bb) {
        const img = new Image();
        if (this.#heatmap !== null) {
            URL.revokeObjectURL(this.#heatmap.src);
        }
        img.addEventListener('load', async () => {
            this.#heatmap = img;
            this.#heatmapBB = new BoundingBox2(bb.min, bb.max);
            this.#redraw();
        });
        img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    }

    // Reset the map rigid transformation
    #resetMapTransform() {
        this.#mapOrigin = this.#mapTransform.appliedTo(new Point2(this.#mapImage.width, this.#mapImage.height).scaled(-.5));
        this.#savedMapOrigin = this.#mapOrigin;
        this.#mapAngle = 0;
        this.#savedMapAngle = this.#mapAngle;
        this.#redraw();
    }

    // Project the map onto the local viewport
    #projectMap(anchors) {
        const phi = Angle2.deg2rad(anchors[0].lat);

        // https://gis.stackexchange.com/a/75535
        const dLng = 111412.877331 * Math.cos(phi) - 93.504117 * Math.cos(3 * phi)
                   + 0.117744 * Math.cos(5 * phi) - .000165 * Math.cos(7 * phi);
        const dLat = 111132.95255 - 559.84957 * Math.cos(2 * phi) + 1.17514 * Math.cos(4 * phi)
                   - .00230 * Math.cos(6 * phi);

        const p = new Point2(anchors[0]);
        const srcV = p.to(anchors[1]);
        const srcV2 = p.to(anchors[2]);
        const dstV = new Vector2((anchors[1].lng - anchors[0].lng) * dLng,
                                 (anchors[1].lat - anchors[0].lat) * dLat);
        const dstV2 = new Vector2((anchors[2].lng - anchors[0].lng) * dLng,
                                  (anchors[2].lat - anchors[0].lat) * dLat);
        const det = srcV.cross(srcV2);

        this.#mapTransform = new Matrix2((dstV.x * srcV2.y - dstV2.x * srcV.y) / det,
                                         (dstV2.x * srcV.x - dstV.x * srcV2.x) / det,
                                         (dstV2.y * srcV.y - dstV.y * srcV2.y) / det,
                                         (dstV.y * srcV2.x - dstV2.y * srcV.x) / det);
    }
}

try {
    customElements.define('mini-map', MiniMap);
}
catch (e) {
  if (!(e instanceof DOMException))
    throw e;
}

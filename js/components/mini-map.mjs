// This module implements the minimap features of the webapp

import { Context2D } from '/js/context2d.mjs';
import { Angle2, BoundingBox2, Matrix2, Point2, Polygon2, Quaternion, Vector2 } from '/js/linalg.mjs';
import { Stylable } from '/js/mixins.mjs';
import { createElement as E, jfetch } from '/js/util.mjs';

const MODES = [{ id: 1, title: 'Manual mode', description: 'Center the map and make it face north (fully manual positioning)' },
               { id: 2, title: 'Automatic mode', description: 'Try to align the map with the detected walls (one-shot, requires wall detection)' },
               { id: 3, title: 'Continuous mode', description: 'Try to align the map with the detected walls (continuous, requires wall detection)' }];

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
    #editing;
    #editBtn;

    constructor() {
        super();

        const width = 150 * (window.devicePixelRatio || 1);
        this.#canvas = this.appendToShadow(E('canvas', null, { height: width, width }));
        this.#ctx = this.#canvas.getContext('2d');
        Object.setPrototypeOf(this.#ctx, Context2D.prototype);
        this.#pathWidth = .5;
        this.#arrowLength = .666;
        this.#arrowWidth = .333;
        this.#savedOrientation = null;
        this.#savedPath = [new Point2(0, 0)];
        this.#savedWalls = [];

        const topBar = this.appendToShadow(E('div', 'top-bar'));

        const [editor, closeBtn] = topBar.appendElements(
            { tag: 'div', className: 'map-editor' },
            { tag: 'div', className: 'close' }
        );

        const container = editor.appendElement({ tag: 'div', className: 'container' });
        this.#editing = false;
        let autoBtn;
        [this.#editBtn, this.#mapSelector, autoBtn] = container.appendElements(
            { tag: 'div', className: 'button right', content: 'Edit' },
            { tag: 'div', className: 'select incomplete', content: 'No map selected' },
            { tag: 'div', className: 'button', content: 'Auto-place' }
        );
        this.#editBtn.addEventListener('click', this.#toggleEdit.bind(this));
        autoBtn.addEventListener('click', this.#autoPlace.bind(this));
        this.#mapSelector.addEventListener('click', this.#browseFloorplans.bind(this));

        this.#mapScale = this.appendToShadow(E('map-scale'));

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
        this.#mapImage = E('img');
        // Let’s play safe here and load the placeholder after attaching the event listener
        this.#mapImage.addEventListener('load', this.#resetMapTransform.bind(this));
        this.#mapImage.src = '/placeholder.svg';
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
        if (!this.#editing) return;
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
        if (!this.#editing) return;
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
        if (!this.#editing) return;
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
        if (this.#editing)
            this.#toggleEdit();
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
        if (mode.id === 1) {
            this.#resetMapTransform();
        }
    }

    // Switch to edit mode
    #toggleEdit() {
        if (this.#editing) {
            this.#editing = false;
            this.#editBtn.classList.remove('selected');
            this.#editBtn.textContent = "Edit";
        }
        else {
            this.#editing = true;
            this.#editBtn.classList.add('selected');
            this.#editBtn.textContent = "Ok";
        }
    }

    // Place the floorplan automatically
    #autoPlace() {
        const modal = document.body.appendElement({ tag: 'modal-box', attributes: { width: 280 } });
        for (const mode of MODES) {
            const choice = modal.appendElement({ tag: 'div', className: 'choice' });
            const id = `mode-${mode.id}`;
            const [radio, label] = choice.appendElements(
                { tag: 'input', attributes: { type: 'radio', name: 'mode', id } },
                { tag: 'label', attributes: { for: id } }
            );
            const [title, description] = label.appendElements(
                { tag: 'span', className: 'title', content: mode.title },
                { tag: 'span', className: 'description', content: mode.description },
            );
            radio.addEventListener('click', e => {
                this.#setMode(mode);
                modal.remove();
            });

            // TODO: change how this actually works
            if (mode.id > 1) {
                radio.disabled = true;
                choice.classList.add('disabled');
            }
        }
    }

    // Browse the available floorplans
    #browseFloorplans() {
        const modal = document.body.appendElement({ tag: 'modal-box', attributes: { width: 330 } });
        const api = window.app.api();
        let url = `${api}/maps?recurse`;
        if (this.hasAttribute('latitude'))
            url += `&latitude=${this.getAttribute('latitude')}`;
        if (this.hasAttribute('longitude'))
            url += `&longitude=${this.getAttribute('longitude')}`;
        if (this.hasAttribute('altitude'))
            url += `&altitude=${this.getAttribute('altitude')}`;
        if (this.hasAttribute('accuracy'))
            url += `&accuracy=${this.getAttribute('accuracy')}`;
        if (this.hasAttribute('altitude-accuracy'))
            url += `&altitude-accuracy=${this.getAttribute('altitude-accuracy')}`;
        // The order is conveniently preserved by the JSON parser
        jfetch(url, data => {
            const entries = Object.entries(data);
            if (entries.length === 0) {
                modal.appendElement({ tag: 'div', className: 'message', content: 'No floorplan found' });
            }
            else {
                const items = modal.appendElement({ tag: 'div', className: 'map-items' });
                for (const [id, entry] of entries) {
                    let name, path, anchors;
                    const item = items.appendElement({ tag: 'div', className: 'map-item' });
                    if ('confidence' in entry) {
                        ({ name, path, anchors } = entry.map);
                        if (entry.confidence == 'Invalid')
                            item.appendElement({ tag: 'span', className: 'invalid', content: `${Math.round(entry.distance)} m` });
                        else
                            item.appendElement({ tag: 'span', className: 'valid' });
                    }
                    else
                        ({ name, path, anchors } = entry);
                    const src = `${api}/${path.replace(/\.([^.]+)$/, '_thumb.$1')}`;
                    item.appendElements(
                        { tag: 'img', attributes: { src, alt: name } },
                        { tag: 'div', content: name }
                    );
                    item.addEventListener('click', () => {
                        this.#projectMap(anchors);
                        this.#mapID = id;
                        this.#mapImage.src = `${api}/${path}`;
                        this.#mapSelector.textContent = name;
                        this.#mapSelector.classList.remove('incomplete');
                        modal.remove();
                    })
                }
            }
        });
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

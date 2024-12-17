// This module implements the application’s scene management

import { BoundedSurface3, Point2, Polygon2 } from '/js/linalg.mjs';

export class Scene {
    #featureIndicators;
    #miniMap;
    #orientation;
    #path;
    #refSpace;
    #startModal;

    constructor() {
        this.#path = [];
        this.#miniMap = document.createElement('mini-map');
        document.body.appendChild(this.#miniMap);
        this.#featureIndicators = document.createElement('feature-indicators');
        document.body.appendChild(this.#featureIndicators);
        this.#startModal = document.createElement('modal-box');
        this.#startModal.setAttribute('closable', 'no');
        this.#startModal.setAttribute('width', 180);
        this.#startModal.setAttribute('height', 60);
        const start = document.createElement('div');
        start.className = 'button';
        start.textContent = 'Click here to start';
        this.#startModal.appendChild(start);
        document.body.appendChild(this.#startModal);

        this.init = this.init.bind(this);
        start.addEventListener('click', this.init);
    }

    async #init() {
        const session = await navigator.xr.requestSession('immersive-ar', {
            requiredFeatures: ['local-floor', 'dom-overlay'],
            optionalFeatures: ['plane-detection'],
            domOverlay: { root: document.body }
        });

        const gl = document.createElement('canvas').getContext('webgl', { xrCompatible: true });
        session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });

        this.#refSpace = await session.requestReferenceSpace('local-floor');

        session.requestAnimationFrame(this.#processFrame.bind(this));
    }

    init() {
        this.#init().then(() => this.#featureIndicators.update('xr', 'granted')).catch(e => {
            console.error(e);
            this.#featureIndicators.update('xr', 'denied');
            this.#featureIndicators.update('planes', 'denied');
        });

        this.#startModal.remove();

        navigator.geolocation.watchPosition(this.#processGPS.bind(this), null, { enableHighAccuracy: true, timeout: 5000 });
    }

    // Add a point to the path
    #addPoint(p) {
        if (this.#path.length > 0) {
            const previousP = this.#path[this.#path.length - 1];
            if (previousP.to(p).norm() < .1)
                return;
            p.x = previousP.x * 0.8 + p.x * 0.2;
            p.y = previousP.y * 0.8 + p.y * 0.2;
        }
        this.#path.push(p);
    }

    // Process an XR frame
    #processFrame(time, frame) {
        const pose = frame.getViewerPose(this.#refSpace);
        if (pose !== null) {
            let { x, z } = pose.transform.position;
            this.#addPoint(new Point2(x, z));
            this.#orientation = pose.transform.orientation;

            const walls = [];
            if (frame.detectedPlanes === undefined) {
                this.#featureIndicators.update('planes', 'denied');
            }
            else {
                this.#featureIndicators.update('planes', 'granted');
                for (const plane of frame.detectedPlanes) {
                    if (plane.polygon.length > 0) {
                        const polygon = new Polygon2(plane.polygon.map(({z, x}) => new Point2(z, x)));
                        const pose = frame.getPose(plane.planeSpace, this.#refSpace);
                        const surf = new BoundedSurface3(polygon, pose.transform.matrix);
                        // Filter out artifacts (non-vertical planes and small surfaces)
                        if (surf.normal.y < .05 && surf.area() > 1 && surf.height() > 1) {
                            const [min, max] = surf.lineProjection();
                            walls.push([new Point2(min.x, min.z), new Point2(max.x, max.z)]);
                        }
                    }
                }
            }

            this.#miniMap.draw(this.#orientation, this.#path, walls);
        }

        frame.session.requestAnimationFrame(this.#processFrame.bind(this));
    }

    #processGPS(pos) {
        //const crd = pos.coords;
        //console.log("Your current position is:");
        //console.log(`Latitude : ${crd.latitude}`);
        //console.log(`Longitude: ${crd.longitude}`);
        //console.log(`More or less ${crd.accuracy} meters.`);
        this.#featureIndicators.update('gps', 'granted');
        this.#featureIndicators.activate('gps');
    }
}

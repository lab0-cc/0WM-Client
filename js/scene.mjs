// This module implements the application’s scene management

import { Context } from '/js/gl.mjs';
import { createHUD } from '/js/hud.mjs';
import { BoundedSurface3, Matrix4, Point2, Point3, Polygon2, Vector2 } from '/js/linalg.mjs';
import { M } from '/js/meshes.mjs';

export class Scene {
    #ctx;
    #featureIndicators;
    #m;
    #magicWheel;
    #measurements;
    #miniMap;
    #orientation;
    #path;
    #pose;
    #refSpace;
    #session;
    #startModal;

    constructor() {
        this.#path = [];
        this.#miniMap = document.createElement('mini-map');
        document.body.appendChild(this.#miniMap);
        this.#featureIndicators = document.createElement('feature-indicators');
        document.body.appendChild(this.#featureIndicators);
        this.#magicWheel = document.createElement('magic-wheel');
        document.body.appendChild(this.#magicWheel);
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
        document.scene = this;
        this.#measurements = [];
    }

    async #init() {
        this.#session = await navigator.xr.requestSession("immersive-ar", {
            requiredFeatures: ['local-floor', 'dom-overlay'],
            optionalFeatures: ['plane-detection'],
            domOverlay: { root: document.body }
        });
        this.#ctx = new Context(document.createElement('canvas'));
        this.#m = new M(this.#ctx);
        this.#ctx.attachTo(this.#session);
        this.#refSpace = await this.#session.requestReferenceSpace('local-floor');
        this.#session.requestAnimationFrame(this.#processFrame.bind(this));
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

    // Draw the minimap data
    #drawMiniMap(frame) {
        let { x, z } = this.#pose.transform.position;
        this.#addPoint(new Point2(x, z));
        this.#orientation = this.#pose.transform.orientation;

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

    // Draw the measurements
    #drawMeasurements() {
        const glLayer = this.#session.renderState.baseLayer;
        this.#ctx.bindFramebuffer(glLayer.framebuffer);

        for(const view of this.#pose.views){
            this.#ctx.updateViewport(glLayer.getViewport(view));

            const proj = new Matrix4(view.projectionMatrix);
            const viewMat = new Matrix4(view.transform.inverse.matrix);
            const rot = new Matrix4(view.transform.matrix).rot();

            let yaw = new Vector2(rot.l[5], rot.l[1]).angle();
            const counterYaw = new Matrix4([
                yaw.cos, -yaw.sin, 0, 0,
                yaw.sin, yaw.cos,  0, 0,
                0,       0,        1, 0,
                0,       0,        0, 1
            ]);
            const camPos = new Point3(view.transform.position);

            const sortedMeasurements = this.#measurements.reduce((acc, s) => {
                s.camD2 = camPos.to(s.position).sqnorm();
                if (s.camD2 > .05)
                    acc.push(s);
                return acc;
            }, []).sort((a, b) => b.camD2 - a.camD2);

            for (const measurement of sortedMeasurements) {
                const hudMat = viewMat.mul(rot.mul(counterYaw).translated(measurement.position));
                // First, draw a sphere
                this.#m.mSphere.use(this.#m.pSphere, {
                    projectionMatrix: proj,
                    modelViewMatrix: viewMat.mul(measurement.position.trans4()),
                    color: [.2, .7, 1.0],
                    alpha: .5
                }).draw();
                // Then draw lines
                this.#m.mLines.use(this.#m.pLines, {
                    projectionMatrix: proj,
                    color: [1, 1, 1],
                    alpha: 1,
                    modelViewMatrix: hudMat
                }).draw('lineStrip');
                // Then draw the info box
                this.#m.mInfo.use(this.#m.pInfo, {
                    UV: this.#m.uvInfo,
                    projectionMatrix: proj,
                    modelViewMatrix: hudMat,
                    texture: measurement.texture
                }).draw('triangleStrip');
            }
        }
    }

    // Process an XR frame
    #processFrame(time, frame) {
        this.#pose = frame.getViewerPose(this.#refSpace);
        if (this.#pose !== null) {
            this.#drawMiniMap(frame);
            this.#drawMeasurements();
        }

        frame.session.requestAnimationFrame(this.#processFrame.bind(this));
    }

    // Request a Wi-Fi scan
    requestMeasurement() {
        // For now, this is a dumb mock
        if(!this.#pose) return;
        const canvas = createHUD([
            {ssid: "Network 1", signal: -54, mhz: 2400},
            {ssid: "Network 2", signal: -65, mhz: 5100},
            {ssid: "Network 3 foo bar baz", signal: -83, mhz: 2400}
        ]);
        this.#measurements.push({
            position: new Point3(this.#pose.transform.position),
            texture: this.#ctx.create2DTexture(canvas, 'clamp')
        });
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

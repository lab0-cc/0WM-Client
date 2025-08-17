// This module implements the application’s scene management

import { Context } from '/js/gl.mjs';
import { createHUD } from '/js/hud.mjs';
import { BoundedSurface3, Matrix4, Point2, Point3, Polygon2, Vector2 } from '/js/linalg.mjs';
import { mad, med } from '/js/math.mjs';
import { M } from '/js/meshes.mjs';
import { createElement } from '/js/util.mjs';
import { WS } from '/js/ws.mjs';

export class App {
    #ap;
    #api;
    #apRounds;
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
    #uuid;
    #ws;

    constructor() {
        this.#path = [];
        this.#miniMap = createElement('mini-map');
        document.body.appendChild(this.#miniMap);
        this.#featureIndicators = createElement('feature-indicators');
        document.body.appendChild(this.#featureIndicators);
        this.#magicWheel = createElement('magic-wheel');
        document.body.appendChild(this.#magicWheel);
        const startModal = createElement('modal-box', null, {closable: 'no'});
        const start = createElement('div', 'button', null, 'Click here to start');
        startModal.appendChild(start);
        document.body.appendChild(startModal);
        document.body.appendChild(createElement('span', null, {id: 'ap'}, '<No reachable AP>'));
        document.scene = this;
        this.#measurements = [];
        this.#uuid = null;

        fetch('/config.json').then(r => r.json().then(data => {
            this.#api = data.api;
            start.addEventListener('click', () => {
                startModal.remove();
                this.init();
            });
        }));
    }

    async #init() {
        this.#session = await navigator.xr.requestSession("immersive-ar", {
            requiredFeatures: ['local-floor', 'dom-overlay'],
            optionalFeatures: ['plane-detection'],
            domOverlay: { root: document.body }
        });
        this.#ctx = new Context(createElement('canvas'));
        this.#m = new M(this.#ctx);
        this.#ctx.attachTo(this.#session);
        this.#refSpace = await this.#session.requestReferenceSpace('local-floor');
        this.#session.requestAnimationFrame(this.#processFrame.bind(this));
    }

    #spawnMessage(id, message) {
        const modal = createElement('modal-box', null, {closable: 'no', id});
        const msg = createElement('span', null, null, message);
        modal.appendChild(msg);
        document.body.appendChild(modal);
        return [modal, msg];
    }

    init() {
        this.#init().then(() => this.#featureIndicators.update('xr', 'granted')).catch(e => {
            console.error(e);
            this.#featureIndicators.update('xr', 'denied');
            this.#featureIndicators.update('planes', 'denied');
        });

        navigator.geolocation.watchPosition(this.#processGPS.bind(this), null, { enableHighAccuracy: true, timeout: 5000 });

        this.#spawnMessage('connect-ws', 'Connecting to the server…');
        this.#initWS();
        this.#initAP();
    }

    #sendWS(cmd, arg = null) {
        if (arg === null)
            this.#ws.send(cmd);
        else
            this.#ws.send(`${cmd}\x00${JSON.stringify(arg, null, null)}`);
    }

    #initWS() {
        this.#ws = new WS(`${this.#api}/ws`);
        this.#ws.addEventListener('message', e => {
            const [command, data] = e.data.split('\x00');
            this.#wsCallback(command, JSON.parse(data));
        });
        this.#ws.addEventListener('open', async () => {
            this.#sendWS('INIT', this.#uuid);
            document.getElementById('connect-ws')?.remove();
        });
        this.#ws.addEventListener('close', () => {
            if (document.getElementById('connect-ws') === null)
                this.#spawnMessage('connect-ws', 'Connection lost. Reconnecting to the server…');
        });
    }

    #pingAP(host) {
        document.getElementById('connect-ap')?.remove();
        const [modal, msg] = this.#spawnMessage('connect-ap', `Contacting the AP (${host})…`);
        return fetch(`${host}/cgi-bin/info`).then(r => r.json().then(data => {
            const model = data.model;
            msg.textContent = `Listing radios (${host})…`;
            return fetch(`${host}/cgi-bin/list`).then(r => r.json().then(data => {
                document.getElementById('ap').textContent = model;
                const names = Object.keys(data);
                this.#ap = { host, model, radios: Object.fromEntries(names.map(e => [e, []])) };
                msg.textContent = `Calibrating radios (${host}, [${names.join(', ')}])…`;
                // TODO: show more context, i.e. when a single radio has finished.
                const start = performance.now();
                return Promise.all(names.map(name => {
                    return fetch(`${host}/cgi-bin/scan/${name}`)
                           .then(r => r.arrayBuffer().then (() => {
                        this.#ap.radios[name].push(performance.now() - start);
                    }));
                })).then(() => {
                    modal.remove();
                    this.#apRounds = 0;
                });
            }));
        }));
    }

    #initAP() {
        this.#ap = null;
        this.#apRounds = 0;
        this.#pingAP('http://ap.local').catch(this.#sendWS('NOAP'));
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
        if(!this.#pose) return;
        const progress = createElement('scan-progress');
        document.body.appendChild(progress);
        const start = performance.now();
        // TODO: handle disconnection
        // TODO: fail if the user moves too much
        Promise.all(Object.entries(this.#ap.radios).map(([name, times]) => {
            progress.add(name);
            const median = med(times);
            const t90 = .9 * median;
            const r0 = .1 * median;
            const tau = r0 * (1 + (1.4826 * mad(times, median) / median)) / Math.log(r0 / 50);
            const interval = setInterval(() => {
                const elapsed = performance.now() - start;
                let p
                if (elapsed < t90)
                    p = elapsed / median;
                else
                    p = 1 - .1 * Math.exp((t90 - elapsed) / tau);
                progress.set(name, p);
            }, 50);
            return fetch(`${this.#ap.host}/cgi-bin/scan/${name}`).then(r => r.json().then(data => {
                this.#ap.radios[name].push(performance.now() - start);
                progress.done(name);
                return data.results;
            })).finally(() => clearInterval(interval));
        })).then(l => {
            progress.remove();
            const {x, y, z} = this.#pose.transform.position;
            const scan = {position: {x, y, z}, timestamp: Date.now(), measurements: l.flat()};
            this.#sendWS('SCAN', scan);
        });
    }

    #wsCallback(command, data) {
        switch (command) {
        case 'DISP':
            const canvas = createHUD(data.measurements);
            this.#measurements.push({
                position: new Point3(data.position),
                texture: this.#ctx.create2DTexture(canvas, 'clamp')
            });
            break;
        case 'TRYL':
            (async () => {
              for (const host of data) {
                  try {
                      await this.#pingAP(host).catch();
                      return;
                  }
                  catch {}
              }
              if (++this.#apRounds >= 3) {
                  const modal = createElement('modal-box', null, {closable: 'no'});
                  const retry = createElement('div', 'button', null,
                                              'Failed to join the AP. Click here to retry.');
                  modal.appendChild(retry);
                  document.body.appendChild(modal);
                  document.getElementById('connect-ap')?.remove();
                  retry.addEventListener('click', () => {
                      modal.remove();
                      this.#initAP();
                  });
              }
              else {
                  this.#sendWS('NOAP');
              }
            })();
            break;
        case 'UUID':
            this.#uuid = data;
            break;
        }
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

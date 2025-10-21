// This module implements the application’s scene management

import { Context } from '/js/gl.mjs';
import { createHUD } from '/js/hud.mjs';
import { BoundedSurface3, Matrix4, Point2, Point3, Polygon2, Vector2 } from '/js/linalg.mjs';
import { mad, med } from '/js/math.mjs';
import { M } from '/js/meshes.mjs';
import { createElement as E, jfetch } from '/js/util.mjs';
import { WS } from '/js/ws.mjs';

const DEFAULT_AP = 'http://ap.local';
const NO_REACHABLE_AP = '<No reachable AP>';

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
    #progressModal;
    #refSpace;
    #session;
    #uuid;
    #ws;

    constructor() {
        this.#path = [];
        let startModal;
        [this.#miniMap, this.#featureIndicators, this.#magicWheel, startModal, this.#progressModal,] =
            document.body.appendElements(
                'mini-map',
                'feature-indicators',
                'magic-wheel',
                { tag: 'modal-box', attributes: { closable: 'no' } },
                { tag: 'modal-box', attributes: { closable: 'no', progress: 'yes' } },
                { tag: 'span', attributes: { id: 'ap' }, content: NO_REACHABLE_AP }
            );
        const start = startModal.appendElement({ tag: 'div', className: 'button', content: 'Click here to start' });
        document.scene = this;
        this.#measurements = [];
        this.#uuid = null;

        jfetch('/config.json', data => {
            this.#api = data.api;
            start.addEventListener('click', () => {
                startModal.remove();
                this.init();
            });
        });
    }

    async #init() {
        this.#session = await navigator.xr.requestSession("immersive-ar", {
            requiredFeatures: ['local-floor', 'dom-overlay'],
            optionalFeatures: ['plane-detection'],
            domOverlay: { root: document.body }
        });
        this.#ctx = new Context(E('canvas'));
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

        navigator.geolocation.watchPosition(this.#processGPS.bind(this), null, { enableHighAccuracy: true, timeout: 5000 });

        this.#progressModal.addProgress('connect-ws', 'Connecting to the server');
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
            this.#progressModal.completeProgress('connect-ws');
        });
        this.#ws.addEventListener('close', () => {
            this.#progressModal.addProgress('connect-ws', 'Connection lost, reconnecting to the server');
        });
    }

    #pingAP(host) {
        const idx = host.indexOf("://");
        let displayHost;
        if (idx === -1)
            displayHost = host;
        else
            displayHost = host.slice(idx + 3);
        const connectAP = this.#progressModal.addProgress(`connect-ap-${host}`, 'Contacting ');
        connectAP.appendElement({ tag: 'code', content: displayHost });
        return jfetch(`${host}/cgi-bin/info`, data => {
            const model = data.model;
            this.#progressModal.addProgress('list-radios', 'Listing radios');
            this.#progressModal.completeProgress(`connect-ap-${host}`);
            return jfetch(`${host}/cgi-bin/list`, data => {
                document.getElementById('ap').textContent = model;
                const names = Object.keys(data);
                this.#ap = { host, model, radios: Object.fromEntries(names.map(e => [e, []])) };
                const start = performance.now();
                const res = Promise.all(names.map(name => {
                    const calibrateRadio = this.#progressModal.addProgress(`calibrate-radio-${name}`, 'Calibrating ');
                    calibrateRadio.appendElement({ tag: 'code', content: name });
                    return fetch(`${host}/cgi-bin/scan/${name}`).then(r => r.arrayBuffer().then(() => {
                        this.#ap.radios[name].push(performance.now() - start);
                        this.#progressModal.completeProgress(`calibrate-radio-${name}`);
                    })).catch(() => {
                        this.#progressModal.errProgress(`calibrate-radio-${name}`);
                    })
                })).then(() => {
                    this.#apRounds = 0;
                });
                this.#progressModal.completeProgress('list-radios');
                return res;
            });
        });
    }

    #initAP() {
        this.#ap = null;
        this.#apRounds = 0;
        this.#pingAP(DEFAULT_AP).catch(() => {
            this.#progressModal.errProgress(`connect-ap-${DEFAULT_AP}`);
            this.#sendWS('NOAP');
        });
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
        const progress = document.body.appendElement('scan-progress');
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
            return jfetch(`${this.#ap.host}/cgi-bin/scan/${name}`, data => {
                this.#ap.radios[name].push(performance.now() - start);
                progress.done(name);
                return data.results;
            }).finally(() => clearInterval(interval));
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
            this.#sendWS('RQHT');
            break;
        case 'HEAT':
            this.#miniMap.attachHeatmap(data[0], data[1]);
            break;
        case 'TRYL':
            (async () => {
              for (const host of data) {
                  try {
                      await this.#pingAP(host).catch();
                      return;
                  }
                  catch {
                      document.getElementById('ap').textContent = NO_REACHABLE_AP;
                      this.#progressModal.errProgress(`connect-ap-${host}`);
                      this.#progressModal.errProgress('list-radios');
                  }
              }
              if (++this.#apRounds >= 3) {
                  const modal = document.body.appendElement({ tag: 'modal-box', attributes: { closable: 'no' } });
                  const retry = modal.appendElement({ tag: 'div', className: 'button', content: 'Failed to join the AP. Click here to retry.' });
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

    api() {
        return this.#api;
    }
}

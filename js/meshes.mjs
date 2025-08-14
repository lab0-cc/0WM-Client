// This module provides the application’s WebGL data


import { Code, Context, Mesh, Program, Sphere } from '/js/gl.mjs';
import { Point2, Point3 } from '/js/linalg.mjs';


// Common definitions
const modelU = {modelViewMatrix: 'mat4', projectionMatrix: 'mat4'};
const colorU = {color: 'vec3', alpha: 'float'};


export class M {
    constructor(ctx) {
        // Sphere vertex shader
        const vsSphere = ctx.createVertexShader(
            Code.project({vNormal: 'normal'}),
            {a: {position: 'vec3', normal: 'vec3'}, u: modelU, v: {vNormal: 'vec3'}}
        );

        // Sphere fragment shader
        const fsSphere = ctx.createFragmentShader(`
            void main() {
                vec3 L = normalize(vec3(0.5, 1.0, 0.75));
                float diff = max(dot(normalize(vNormal), L), 0.0);
                gl_FragColor = vec4(color * diff, alpha);
            }`, {u: colorU, v: {vNormal: 'vec3'}}
        );

        // Sphere program
        this.pSphere = ctx.create(Program, vsSphere, fsSphere, {depthMask: false, cullFace: true});

        // Sphere mesh
        this.mSphere = ctx.create(Sphere, 20, 20, 0.05);


        // HUD info vertex shader
        const vsInfo = ctx.createVertexShader(
            Code.project({vUV: 'UV'}),
            {a: {position: 'vec3', UV: 'vec2'}, u: modelU, v: {vUV: 'vec2'}}
        );

        // HUD info fragment shader
        const fsInfo = ctx.createFragmentShader(`
            void main() {
                gl_FragColor = texture2D(texture, vUV);
            }`, {u: {texture: 'sampler2D'}, v: {vUV: 'vec2'}}
        );

        // HUD info program
        this.pInfo = ctx.create(Program, vsInfo, fsInfo);

        // HUD info mesh
        this.mInfo = ctx.create(Mesh, [
            new Point3(.1, .115, 0),
            new Point3(.3, .115, 0),
            new Point3(.1, .035, 0),
            new Point3(.3, .035, 0)
        ]);

        // HUD info UV
        this.uvInfo = ctx.createBuffer([
            new Point2(0, 0), new Point2(1, 0), new Point2(0, 1), new Point2(1,1)
        ]);


        // Lines vertex shader
        const vsLines = ctx.createVertexShader(Code.project(), {a: {position: 'vec3'}, u: modelU});

        // Lines fragment shader
        const fsLines = ctx.createFragmentShader(`
            void main() {
                gl_FragColor = vec4(color, alpha);
            }`, {u: colorU}
        );

        // Lines program
        this.pLines = ctx.create(Program, vsLines, fsLines);

        // Lines mesh
        this.mLines = ctx.create(Mesh, [
            new Point3(.035355, .035355, 0),
            new Point3(.075, .075, 0), 
            new Point3(.1, .075, 0)
        ]);
    }
}

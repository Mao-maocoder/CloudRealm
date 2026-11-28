import * as T from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { bridgeArtEnabled, bridgePool, bridgeReflectionLayer } from '../world/geo/bridge-look';
import { waterLevelAt } from '../world/geo/geo-core';
import { atmosphereUniforms } from '../rendering/aerial-perspective';

/** A single low-resolution, clipped reflection pass for the main stone bridge. */
export class BridgeReflection {
    private readonly mirror = new Reflector(new T.PlaneGeometry(1,1), {
        textureWidth: 384, textureHeight: 216, multisample: 0, clipBias: .0015,
    });
    readonly uniforms = {
        uBridgeReflection: { value: this.mirror.getRenderTarget().texture },
        uBridgeMirrorMatrix: { value: new T.Matrix4() },
        uBridgeMirrorOn: { value: 0 },
    };
    readonly stats = { calls: 0, triangles: 0 };
    enabled = true;
    private readonly center = new T.Vector3(bridgePool.x,bridgePool.y,bridgePool.z);
    private readonly normal = new T.Vector3(0,1,(waterLevelAt(bridgePool.z-1)-waterLevelAt(bridgePool.z+1))*.5).normalize();
    private readonly area = new T.Sphere(this.center, 55);
    private readonly frustum = new T.Frustum();
    private readonly viewProjection = new T.Matrix4();
    private readonly reflectionGroup = new T.Group();
    private readonly skyColor = new T.Color('#94c3da');
    private readonly lastCamPos = new T.Vector3(Infinity, Infinity, Infinity);
    private readonly lastCamDir = new T.Vector3();
    private readonly curCamDir = new T.Vector3();
    private frameParity = 0;

    constructor(private readonly scene: T.Scene) {
        this.mirror.camera.layers.set(bridgeReflectionLayer);
        this.mirror.position.copy(this.center);
        this.mirror.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),this.normal);
        this.mirror.updateMatrixWorld();
    }

    render(renderer: T.WebGLRenderer, camera: T.PerspectiveCamera) {
        this.stats.calls = this.stats.triangles = 0;
        if (!this.enabled || !bridgeArtEnabled || camera.position.distanceToSquared(this.center) > 118**2) {
            this.uniforms.uBridgeMirrorOn.value = 0;
            return;
        }
        if (this.normal.dot(camera.position) - this.normal.dot(this.center) < .45) {
            this.uniforms.uBridgeMirrorOn.value = 0;
            return;
        }
        camera.updateMatrixWorld();
        this.viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.viewProjection,camera.coordinateSystem);
        if (!this.frustum.intersectsSphere(this.area)) {
            this.uniforms.uBridgeMirrorOn.value = 0;
            return;
        }

        // Skip redundant reflection passes when camera is stationary, and throttle to every 4th frame while moving.
        camera.getWorldDirection(this.curCamDir);
        const moved = this.lastCamPos.distanceToSquared(camera.position) > 0.014
            || this.lastCamDir.dot(this.curCamDir) < 0.99994;
        if (this.uniforms.uBridgeMirrorOn.value > .5 && (!moved || (++this.frameParity % 4) !== 0)) return;
        this.lastCamPos.copy(camera.position);
        this.lastCamDir.copy(this.curCamDir);

        const background = this.scene.background;
        this.skyColor.copy(atmosphereUniforms.uWaterSkyLow.value);
        this.scene.background = this.skyColor;
        const material = this.mirror.material as T.ShaderMaterial;
        this.mirror.onBeforeRender(renderer,this.scene,camera,this.mirror.geometry,material,this.reflectionGroup);
        this.scene.background = background;
        this.stats.calls = renderer.info.render.calls;
        this.stats.triangles = renderer.info.render.triangles;
        this.uniforms.uBridgeMirrorMatrix.value.copy(material.uniforms.textureMatrix.value)
            .multiply(this.viewProjection.copy(this.mirror.matrixWorld).invert());
        this.uniforms.uBridgeMirrorOn.value = 1;
    }

    dispose() {
        this.mirror.geometry.dispose();
        this.mirror.dispose();
    }
}

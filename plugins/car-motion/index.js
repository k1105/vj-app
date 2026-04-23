/**
 * car-motion v0.2 — static drift-stop scene, orbiting camera
 *
 * Car is frozen in drift-stop pose. Camera orbits via params:
 *   camAngle  0-360 (step=60 for button-style 6-position orbit)
 *   camRadius 2-20
 *   camHeight 0.5-15
 *   fov       20-90
 *
 * Canvas plugin with own WebGLRenderer + EffectComposer.
 * GlowPass + MotionBlurPass inlined (no CDN).
 */

const ASSET_BASE = "vj-asset://local/plugins/car-motion/assets";

const ROAD_Y = 0;
const ROAD_WIDTH = 6;
const TILE_ASPECT = 16 / 9;
const STOP_LEN = ROAD_WIDTH * TILE_ASPECT;

// Yaw frozen at drift-stop moment (≈ -30°)
const CAR_YAW = -0.521;

// ── Easing ────────────────────────────────────────────────────────────────────
// d3.easeCubicInOut equivalent — smooth acceleration and deceleration
function easeCubicInOut(t) {
  t = Math.max(0, Math.min(1, t));
  return ((t *= 2) <= 1 ? t * t * t : (t -= 2) * t * t + 2) / 2;
}

// Shortest-path lerp helper (not used for main camera — kept for reference)
function lerpAngleDeg(from, to, t) {
  const diff = ((to - from + 540) % 360) - 180;
  return from + diff * t;
}

// ── GlowPass ──────────────────────────────────────────────────────────────────
function makeGlowPass(THREE, Pass, FullScreenQuad, width, height, strength, sigma) {
  const w = Math.max(1, Math.floor(width / 2));
  const h = Math.max(1, Math.floor(height / 2));

  class GlowPass extends Pass {
    constructor() {
      super();
      this.rtA = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
      this.rtB = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });

      this.blurMat = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse:    { value: null },
          uDir:        { value: new THREE.Vector2(1, 0) },
          uResolution: { value: new THREE.Vector2(w, h) },
          uSigma:      { value: sigma },
        },
        vertexShader: `varying vec2 vUv;
          void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uDir,uResolution; uniform float uSigma;
          varying vec2 vUv; const int R=32;
          void main(){ vec2 t=1.0/uResolution; vec3 acc=vec3(0.0); float tot=0.0;
            for(int i=-R;i<=R;i++){ float fi=float(i); float ww=exp(-(fi*fi)/(2.0*uSigma*uSigma));
              acc+=texture2D(tDiffuse,vUv+uDir*t*fi).rgb*ww; tot+=ww; }
            gl_FragColor=vec4(acc/tot,1.0); }`,
      });

      this.combineMat = new THREE.ShaderMaterial({
        uniforms: {
          tBase:     { value: null },
          tBloom:    { value: null },
          uStrength: { value: strength },
        },
        vertexShader: `varying vec2 vUv;
          void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `uniform sampler2D tBase,tBloom; uniform float uStrength; varying vec2 vUv;
          void main(){ vec4 b=texture2D(tBase,vUv); vec3 g=texture2D(tBloom,vUv).rgb;
            gl_FragColor=vec4(b.rgb+g*uStrength,b.a); }`,
      });

      this.blurQuad    = new FullScreenQuad(this.blurMat);
      this.combineQuad = new FullScreenQuad(this.combineMat);
    }

    render(renderer, writeBuffer, readBuffer) {
      this.blurMat.uniforms.tDiffuse.value = readBuffer.texture;
      this.blurMat.uniforms.uDir.value.set(1, 0);
      renderer.setRenderTarget(this.rtA); renderer.clear();
      this.blurQuad.render(renderer);

      this.blurMat.uniforms.tDiffuse.value = this.rtA.texture;
      this.blurMat.uniforms.uDir.value.set(0, 1);
      renderer.setRenderTarget(this.rtB); renderer.clear();
      this.blurQuad.render(renderer);

      this.combineMat.uniforms.tBase.value  = readBuffer.texture;
      this.combineMat.uniforms.tBloom.value = this.rtB.texture;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      if (this.clear) renderer.clear();
      this.combineQuad.render(renderer);
    }

    setSize(nw, nh) {
      const sw = Math.max(1, Math.floor(nw / 2));
      const sh = Math.max(1, Math.floor(nh / 2));
      this.rtA.setSize(sw, sh); this.rtB.setSize(sw, sh);
      this.blurMat.uniforms.uResolution.value.set(sw, sh);
    }

    dispose() {
      this.rtA.dispose(); this.rtB.dispose();
      this.blurMat.dispose(); this.combineMat.dispose();
      this.blurQuad.dispose(); this.combineQuad.dispose();
    }
  }
  return new GlowPass();
}

// ── MotionBlurPass ────────────────────────────────────────────────────────────
function makeMotionBlurPass(THREE, Pass, FullScreenQuad, width, height, blend) {
  class MotionBlurPass extends Pass {
    constructor() {
      super();
      this.blend = blend;
      this.rtA = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType });
      this.rtB = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType });
      this._useA = true;

      this.mat = new THREE.ShaderMaterial({
        uniforms: {
          tCurrent: { value: null },
          tPrev:    { value: null },
          uBlend:   { value: blend },
        },
        vertexShader: `varying vec2 vUv;
          void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `uniform sampler2D tCurrent,tPrev; uniform float uBlend; varying vec2 vUv;
          void main(){ gl_FragColor=mix(texture2D(tCurrent,vUv),texture2D(tPrev,vUv),uBlend); }`,
      });
      this.quad = new FullScreenQuad(this.mat);
    }

    render(renderer, writeBuffer, readBuffer) {
      const rtPrev = this._useA ? this.rtA : this.rtB;
      const rtNext = this._useA ? this.rtB : this.rtA;
      this._useA = !this._useA;

      this.mat.uniforms.tCurrent.value = readBuffer.texture;
      this.mat.uniforms.tPrev.value    = rtPrev.texture;
      this.mat.uniforms.uBlend.value   = this.blend;
      renderer.setRenderTarget(rtNext); renderer.clear();
      this.quad.render(renderer);

      this.mat.uniforms.tCurrent.value = rtNext.texture;
      this.mat.uniforms.uBlend.value   = 0;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      if (this.clear) renderer.clear();
      this.quad.render(renderer);
    }

    setSize(w, h) { this.rtA.setSize(w, h); this.rtB.setSize(w, h); }

    dispose() {
      this.rtA.dispose(); this.rtB.dispose();
      this.mat.dispose(); this.quad.dispose();
    }
  }
  return new MotionBlurPass();
}

// ── Main plugin ───────────────────────────────────────────────────────────────

export default class CarMotion {
  setup(ctx) {
    const THREE = ctx.THREE;
    this._THREE = THREE;

    const canvas = document.createElement("canvas");
    canvas.width  = ctx.width;
    canvas.height = ctx.height;
    this._canvas = canvas;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(ctx.width, ctx.height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    this._scene = scene;

    const camera = new THREE.PerspectiveCamera(50, ctx.width / ctx.height, 0.1, 1000);
    this._camera = camera;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new ctx.RoomEnvironment(), 0.8).texture;
    pmrem.dispose();

    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(5, 10, 5);
    scene.add(key);

    const composer = new ctx.EffectComposer(renderer);
    composer.addPass(new ctx.RenderPass(scene, camera));
    composer.addPass(makeGlowPass(THREE, ctx.Pass, ctx.FullScreenQuad, ctx.width, ctx.height, 1.2, 3.5));
    composer.addPass(makeMotionBlurPass(THREE, ctx.Pass, ctx.FullScreenQuad, ctx.width, ctx.height, 0.65));
    composer.addPass(new ctx.OutputPass());
    this._composer = composer;

    // road-stop only, centered at origin
    this._roadReady = false;
    this._setupRoad(THREE, scene);

    // car, frozen at drift-stop
    this._carData = { mesh: null, carLift: 0 };
    this._loadCar(THREE, ctx.GLTFLoader, scene);

    // camera animation state
    // _renderAngle: the single source of truth for the camera orbit angle.
    //   auto-rotate mode   → incremented by rotateSpeed * dt every frame
    //   manual (ease) mode → driven by easeCubicInOut animation
    //   step button press  → adds delta to _renderAngle (relative, not absolute)
    this._renderAngle    = 0;
    this._easeFrom       = 0;   // _renderAngle at start of current ease
    this._easeDiff       = 0;   // angular displacement to ease through
    this._easeStart      = -1e9; // -1e9 = animation done
    this._easeDur        = 600; // ms
    this._lastParamAngle = 0;   // last seen camAngle param — used for delta detection
    this._wasAutoRotate  = false;
    // radius / height: exponential lerp (continuous sliders)
    this._camRadius = 8;
    this._camHeight = 4;
    this._camInit   = false;

    return canvas;
  }

  _setupRoad(THREE, scene) {
    const texLoader = new THREE.TextureLoader();
    const stopTex = texLoader.load(
      `${ASSET_BASE}/road-stop.png`,
      () => { this._roadReady = true; },
      undefined,
      () => { this._roadReady = true; },
    );
    stopTex.wrapS = THREE.ClampToEdgeWrapping;
    stopTex.wrapT = THREE.ClampToEdgeWrapping;
    stopTex.flipY = false;
    stopTex.repeat.x = -1;
    stopTex.offset.x = 1;
    stopTex.anisotropy = 16;
    stopTex.colorSpace = THREE.SRGBColorSpace;
    this._stopTex = stopTex;

    const stopMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_WIDTH, STOP_LEN),
      new THREE.MeshBasicMaterial({ map: stopTex, transparent: true }),
    );
    stopMesh.rotation.x = -Math.PI / 2;
    stopMesh.position.y = ROAD_Y;
    scene.add(stopMesh);
    this._stopMesh = stopMesh;
  }

  _loadCar(THREE, GLTFLoader, scene) {
    const loader = new GLTFLoader();
    loader.load(
      `${ASSET_BASE}/mersedes-benz_e55_w211.glb`,
      (gltf) => {
        const obj = gltf.scene;
        const wrapper = new THREE.Group();

        const box    = new THREE.Box3().setFromObject(obj);
        const center = box.getCenter(new THREE.Vector3());
        const size   = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        obj.position.sub(center);
        wrapper.add(obj);
        wrapper.scale.setScalar(3 / maxDim);

        const scaled = new THREE.Box3().setFromObject(wrapper);
        const carLift = -scaled.min.y;
        this._carData.carLift = carLift;

        // Place car at origin, frozen in drift-stop yaw
        wrapper.position.set(0, carLift + ROAD_Y, 0);
        wrapper.rotation.y = CAR_YAW;

        scene.add(wrapper);
        this._carData.mesh = wrapper;
      },
      undefined,
      (err) => console.error("[car-motion] GLTF load error:", err),
    );
  }

  update({ global, params }) {
    if (!this._roadReady) {
      this._renderer.render(this._scene, this._camera);
      return;
    }

    const THREE = this._THREE;
    const dt = (global.delta || (1000 / 60)) / 1000; // convert ms → seconds

    const autoRotate   = params.autoRotate === true || params.autoRotate === 1;
    const rotateSpeed  = typeof params.rotateSpeed === 'number' ? params.rotateSpeed : 30;
    const camAngleParam = typeof params.camAngle  === 'number' ? params.camAngle  : 0;
    const targetRadius  = typeof params.camRadius === 'number' ? params.camRadius : 8;
    const targetHeight  = typeof params.camHeight === 'number' ? params.camHeight : 4;
    const fov           = typeof params.fov       === 'number' ? params.fov       : 50;

    if (!this._camInit) {
      this._renderAngle    = 0;
      this._easeFrom       = 0;
      this._easeDiff       = 0;
      this._easeStart      = -1e9;
      this._lastParamAngle = camAngleParam;
      this._wasAutoRotate  = autoRotate;
      this._camRadius      = targetRadius;
      this._camHeight      = targetHeight;
      this._camInit = true;
    }

    // ── Mode switch: auto-rotate → manual ─────────────────────────────────────
    if (this._wasAutoRotate && !autoRotate) {
      // Freeze ease state at current render angle so easing can resume cleanly
      this._easeFrom  = this._renderAngle;
      this._easeDiff  = 0;
      this._easeStart = -1e9;
    }
    this._wasAutoRotate = autoRotate;

    // ── Step button press: detect delta in camAngle param ─────────────────────
    const paramDelta = camAngleParam - this._lastParamAngle;
    if (Math.abs(paramDelta) > 0.001) {
      if (autoRotate) {
        // Auto-rotate: instant offset — continuous motion masks the snap
        this._renderAngle += paramDelta;
      } else {
        // Manual: start/chain easeCubicInOut animation
        const now0 = performance.now();
        const curT = easeCubicInOut(Math.min(1, (now0 - this._easeStart) / this._easeDur));
        const currentAngle = this._easeFrom + this._easeDiff * curT;
        this._easeFrom  = currentAngle;
        this._easeDiff  = paramDelta;
        this._easeStart = now0;
        this._renderAngle = currentAngle; // keep in sync for if auto-rotate turns on
      }
      this._lastParamAngle = camAngleParam;
    }

    // ── Update renderAngle ────────────────────────────────────────────────────
    if (autoRotate) {
      this._renderAngle += rotateSpeed * dt;
    } else {
      const elapsed = performance.now() - this._easeStart;
      const t = easeCubicInOut(Math.min(1, elapsed / this._easeDur));
      this._renderAngle = this._easeFrom + this._easeDiff * t;
    }

    // ── camRadius / camHeight: exponential lerp (continuous sliders) ──────────
    const k = 1 - Math.exp(-5 * dt);
    this._camRadius += (targetRadius - this._camRadius) * k;
    this._camHeight += (targetHeight - this._camHeight) * k;

    const camAngle = ((this._renderAngle % 360) + 360) % 360;
    const rad = camAngle * (Math.PI / 180);
    this._camera.position.set(
      Math.sin(rad) * this._camRadius,
      this._camHeight,
      Math.cos(rad) * this._camRadius,
    );

    // LookAt mid-car height
    const carMidY = (this._carData.carLift || 0) * 0.5 + ROAD_Y;
    this._camera.lookAt(new THREE.Vector3(0, carMidY, 0));

    if (this._camera.fov !== fov) {
      this._camera.fov = fov;
      this._camera.updateProjectionMatrix();
    }

    this._composer.render();
  }

  dispose() {
    if (this._carData?.mesh) {
      this._scene.remove(this._carData.mesh);
      this._carData.mesh.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material?.dispose();
          }
        }
      });
    }

    if (this._stopMesh) {
      this._stopMesh.geometry?.dispose();
      this._stopMesh.material?.dispose();
    }

    this._stopTex?.dispose();
    this._composer?.dispose();
    this._renderer?.dispose();

    this._carData  = null;
    this._scene    = null;
    this._camera   = null;
    this._composer = null;
    this._renderer = null;
    this._canvas   = null;
  }
}

/**
 * Mercedes-Benz E55 W211
 * mode "orbit"    : car rotates on X/Y/Z axes, camera fixed outside
 * mode "interior" : rotation frozen, camera inside cabin via camX/Y/Z sliders
 */

const MODEL_URL = "vj-asset://local/plugins/three-mercedes-e55/mersedes-benz_e55_w211.glb";

export default class MercedesE55 {
  setup(ctx) {
    this.THREE = ctx.THREE;
    this.scene = ctx.scene;
    this.camera = ctx.camera;
    this.group = null;
    this.lights = [];
    // Orbit and interior maintain independent rotation states
    this.orbitAngleX = 0;
    this.orbitAngleY = 0;
    this.orbitAngleZ = 0;
    this.lastOriginReset = 0;
    this.envTexture = null;
    this.glassMeshes = [];
    this.prevMode = null;

    ctx.scene.background = null;

    // Initial camera position (orbit view default)
    ctx.camera.position.set(0, 0.3, 4);
    ctx.camera.lookAt(0, 0, 0);
    ctx.camera.fov = 23;
    ctx.camera.updateProjectionMatrix();

    // PBR environment
    const pmrem = new ctx.THREE.PMREMGenerator(ctx.renderer);
    pmrem.compileEquirectangularShader();
    const envTexture = pmrem.fromScene(new ctx.RoomEnvironment(ctx.renderer)).texture;
    ctx.scene.environment = envTexture;
    pmrem.dispose();
    this.envTexture = envTexture;

    // Lights
    const ambient = new ctx.THREE.AmbientLight(0xffffff, 1.5);
    const key = new ctx.THREE.DirectionalLight(0xffffff, 3.0);
    key.position.set(5, 8, 5);
    const fill = new ctx.THREE.DirectionalLight(0xaabbff, 1.0);
    fill.position.set(-5, 3, -3);
    const rim = new ctx.THREE.DirectionalLight(0xffffff, 1.5);
    rim.position.set(0, 5, -6);
    ctx.scene.add(ambient, key, fill, rim);
    this.lights = [ambient, key, fill, rim];

    const loader = new ctx.GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => {
        const model = gltf.scene;

        // Classify meshes: save glass candidates, force all opaque initially
        model.traverse((obj) => {
          if (!obj.isMesh) return;
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          const isGlass = mats.some((mat) => {
            if (!mat) return false;
            const name = (mat.name + " " + obj.name).toLowerCase();
            return mat.transparent
              || name.includes("glass")
              || name.includes("window")
              || name.includes("windshield")
              || name.includes("wind")
              || name.includes("screen");
          });
          if (isGlass) this.glassMeshes.push(obj);
          mats.forEach((mat) => {
            if (!mat) return;
            mat.transparent = false;
            mat.opacity = 1;
            mat.alphaTest = 0;
            mat.needsUpdate = true;
          });
        });

        // Center and scale
        const box = new ctx.THREE.Box3().setFromObject(model);
        const center = box.getCenter(new ctx.THREE.Vector3());
        const size = box.getSize(new ctx.THREE.Vector3());
        model.position.sub(center);
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) model.scale.setScalar(2.0 / maxDim);

        const group = new ctx.THREE.Group();
        group.add(model);
        ctx.scene.add(group);
        this.group = group;
        console.log(`[mercedes] glass meshes found: ${this.glassMeshes.length}`,
          this.glassMeshes.map((m) => m.name));
      },
      undefined,
      (err) => console.error("[mercedes] load failed:", err),
    );
  }

  update({ global, params }) {
    const delta  = Math.max(0, (global?.delta ?? 16)) / 1000;
    const mode   = params?.mode ?? "orbit";
    const rotX   = typeof params?.rotX === "number" ? params.rotX : 0;
    const rotY   = typeof params?.rotY === "number" ? params.rotY : 0.5;
    const rotZ   = typeof params?.rotZ === "number" ? params.rotZ : 0;
    const fov    = mode === "orbit"
      ? (typeof params?.fovOrbit    === "number" ? params.fovOrbit    : 23)
      : (typeof params?.fovInterior === "number" ? params.fovInterior : 87);
    const height = typeof params?.height === "number" ? params.height : 0;
    const camX   = typeof params?.camX  === "number" ? params.camX  : 0;
    const camY   = typeof params?.camY  === "number" ? params.camY  : -0.31;
    const camZ   = typeof params?.camZ  === "number" ? params.camZ  : 0.07;
    const lookX      = typeof params?.lookX      === "number"  ? params.lookX      : 0;
    const lookY      = typeof params?.lookY      === "number"  ? params.lookY      : 0;
    const lookZ      = typeof params?.lookZ      === "number"  ? params.lookZ      : 3;
    const cruise     = params?.cruise === true || params?.cruise === 1;
    const cruiseAmp  = typeof params?.cruiseAmp  === "number"  ? params.cruiseAmp  : 0.3;
    const cruiseSpeed= typeof params?.cruiseSpeed=== "number"  ? params.cruiseSpeed: 0.3;

    // Toggle glass visibility when mode changes
    if (mode !== this.prevMode && this.glassMeshes.length > 0) {
      const showGlass = mode === "orbit";
      this.glassMeshes.forEach((m) => { m.visible = showGlass; });
      this.prevMode = mode;
    }

    if (mode === "orbit") {
      // originReset trigger: fire when value changes
      const originReset = params?.originReset ?? 0;
      if (originReset !== this.lastOriginReset) {
        this.lastOriginReset = originReset;
        this.orbitAngleX = 0;
        this.orbitAngleY = 0;
        this.orbitAngleZ = 0;
      }

      // Orbit: accumulate rotation independently
      this.orbitAngleX += rotX * delta;
      this.orbitAngleY += rotY * delta;
      this.orbitAngleZ += rotZ * delta;

      if (this.group) {
        this.group.rotation.set(this.orbitAngleX, this.orbitAngleY, this.orbitAngleZ);
        this.group.position.y = height;
      }

      this.camera.position.set(0, height, 4);
      this.camera.lookAt(0, height, 0);

    } else {
      // Interior: fixed rotation (0,0,0), independent from orbit state
      if (this.group) {
        this.group.rotation.set(0, 0, 0);
        this.group.position.y = 0;
      }

      // Camera placed at camX/Y/Z, looking straight ahead (–Z)
      this.camera.position.set(camX, camY, camZ);
      // cruise: figure-8 (Lissajous 1:2) — X at f, Y at 2f
      const t = (global?.time ?? 0) * 0.001 * cruiseSpeed;
      const cruiseOffsetX = cruise ? Math.sin(t)       * cruiseAmp : 0;
      const cruiseOffsetY = cruise ? Math.sin(t * 2)   * cruiseAmp : 0;
      this.camera.lookAt(camX + lookX + cruiseOffsetX, camY + lookY + cruiseOffsetY, camZ + lookZ);
    }

    if (Math.abs(this.camera.fov - fov) > 0.1) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose() {
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.geometry?.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m?.dispose());
      });
      this.group = null;
    }
    for (const l of this.lights) this.scene.remove(l);
    this.lights = [];
    if (this.envTexture) {
      this.scene.environment = null;
      this.envTexture.dispose();
      this.envTexture = null;
    }
  }
}

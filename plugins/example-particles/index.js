/**
 * example-particles — reference implementation of a material plugin.
 *
 * プラグインは PluginHost (src/output/PluginHost.ts) から Blob URL 経由で
 * dynamic import される。Blob URL は "three" のような bare specifier を
 * 解決できないので、THREE は ctx.THREE で受け取ること。
 */
export default class ExampleParticles {
  setup(ctx) {
    const THREE = ctx.THREE;
    this.root = new THREE.Group();
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.PointsMaterial({ size: 0.02, color: 0x00ff9c });
    const count = 200;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 2;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 2;
    }
    this.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.points = new THREE.Points(this.geometry, this.material);
    this.root.add(this.points);
    return this.root;
  }

  update({ global, params }) {
    this.points.rotation.y += 0.005 * (params?.speed ?? 1) * (1 + (global?.beat ?? 0));
  }

  dispose() {
    this.geometry?.dispose();
    this.material?.dispose();
    this.root?.parent?.remove(this.root);
    this.root = null;
    this.geometry = null;
    this.material = null;
    this.points = null;
  }
}

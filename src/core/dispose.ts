import * as THREE from "three";

/**
 * Safely dispose a THREE.Object3D subtree: geometries, materials, textures.
 * Follow this pattern in every MaterialPlugin.dispose().
 */
export function disposeObject3D(root: THREE.Object3D | null | undefined): void {
  if (!root) return;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (mat) {
      if (Array.isArray(mat)) mat.forEach(disposeMaterial);
      else disposeMaterial(mat);
    }
  });
  root.parent?.remove(root);
}

export function disposeMaterial(mat: THREE.Material): void {
  // dispose every texture-valued property
  for (const key of Object.keys(mat) as (keyof THREE.Material)[]) {
    const val = (mat as unknown as Record<string, unknown>)[key as string];
    if (val instanceof THREE.Texture) val.dispose();
  }
  mat.dispose();
}

/** Release an HTMLVideoElement completely (required to free GPU memory). */
export function disposeVideo(video: HTMLVideoElement | null | undefined): void {
  if (!video) return;
  try {
    video.pause();
    video.removeAttribute("src");
    video.load();
  } catch {
    /* noop */
  }
}

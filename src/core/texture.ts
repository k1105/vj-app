import * as THREE from "three";

/** Make a render target sized for a given resolution. Dispose before replacing. */
export function createRenderTarget(
  width: number,
  height: number,
  opts: Partial<THREE.RenderTargetOptions> = {},
): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
    ...opts,
  });
}

/** Build a VideoTexture and keep the video playing muted + inline. */
export function createVideoTexture(filePath: string): {
  video: HTMLVideoElement;
  texture: THREE.VideoTexture;
} {
  const video = document.createElement("video");
  video.src = filePath;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.play().catch(() => {
    /* browser may defer until user gesture */
  });
  const texture = new THREE.VideoTexture(video);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return { video, texture };
}

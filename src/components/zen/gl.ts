import * as THREE from "three";
import type { ExpoWebGLRenderingContext } from "expo-gl";

/**
 * three.js renderer on an expo-gl context. three expects a <canvas>, so it gets
 * a stand-in with the drawing-buffer size; frames are presented with
 * gl.endFrameEXP() after each render.
 */
export function createRenderer(gl: ExpoWebGLRenderingContext) {
  if (!(gl as { supportsWebGL2?: boolean }).supportsWebGL2) throw new Error("WebGL 2 isn't available on this device");
  const { drawingBufferWidth: width, drawingBufferHeight: height } = gl;
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    getContext: () => gl,
  } as unknown as HTMLCanvasElement;
  // expo-gl's WebGL2 context extends WebGLRenderingContext (a browser's doesn't),
  // so three's `instanceof WebGLRenderingContext` check takes it for WebGL 1 and
  // throws. Hide that global just while the renderer is set up.
  const g = globalThis as { WebGLRenderingContext?: unknown };
  const webgl1 = g.WebGLRenderingContext;
  g.WebGLRenderingContext = undefined;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, context: gl as unknown as WebGL2RenderingContext, antialias: true });
  } finally {
    g.WebGLRenderingContext = webgl1;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  return renderer;
}

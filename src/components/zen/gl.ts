import * as THREE from "three";
import type { ExpoWebGLRenderingContext } from "expo-gl";

/**
 * three.js renderer on an expo-gl context. three expects a <canvas>, so it gets
 * a stand-in with the drawing-buffer size; frames are presented with
 * gl.endFrameEXP() after each render.
 */
export function createRenderer(gl: ExpoWebGLRenderingContext) {
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
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl as unknown as WebGL2RenderingContext, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  return renderer;
}

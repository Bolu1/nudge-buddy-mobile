import * as THREE from "three";
import { makeSurface, type Surface } from "./office/canvas";

// Focus cards in Zen: a little deck of flashcards that sits somewhere in every
// scene. Hover or click it and Buddy fetches (or summons) the top card, the
// camera swings round onto it, and the flashcards UI opens over it.

/** Index-card proportions, in metres. */
export const CARD_W = 0.16;
export const CARD_H = 0.11;

const UI = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const MINT = "#6fcf86";
const INK = "#24323a";
const CARD_COLORS = ["#f4a6b4", "#9fd3ff", "#f2b84b", "#b892e0"];

export interface CardFace {
  title: string;
  subtitle: string;
  /** Header colour; a theme image fills the card behind the text when given (web only — phones draw with Skia, which has no drawImage here). */
  accent: string;
  image?: CanvasImageSource | null;
}

export const DEFAULT_FACE: CardFace = { title: "Focus cards", subtitle: "Quiz yourself", accent: MINT };
/** Just the ruled card, for when the flashcards UI is laid over it. */
export const BLANK_FACE: CardFace = { title: "", subtitle: "", accent: MINT };

function drawFace(s: Surface, face: CardFace) {
  const { ctx, w, h } = s;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fffaf2";
  ctx.fillRect(0, 0, w, h);
  if (face.image) {
    ctx.drawImage(face.image, 0, (h - w) / 2, w, w);
    ctx.fillStyle = "rgba(20,18,16,0.72)";
    ctx.beginPath();
    ctx.roundRect(w * 0.1, h * 0.3, w * 0.8, h * 0.4, 18);
    ctx.fill();
  } else {
    // Ruled index card with a coloured header band.
    ctx.fillStyle = face.accent;
    ctx.fillRect(0, 0, w, h * 0.2);
    ctx.fillStyle = "rgba(111,182,224,0.35)";
    for (let y = h * 0.42; y < h * 0.95; y += h * 0.13) ctx.fillRect(w * 0.08, y, w * 0.84, 2);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = face.image ? "#f3efe9" : INK;
  ctx.font = `700 ${Math.round(h * 0.13)}px ${UI}`;
  ctx.fillText(face.title.length > 26 ? `${face.title.slice(0, 25)}…` : face.title, w / 2, h * (face.image ? 0.45 : 0.55));
  ctx.fillStyle = face.image ? "#c3c8bf" : "#5b6770";
  ctx.font = `500 ${Math.round(h * 0.075)}px ${UI}`;
  ctx.fillText(face.subtitle, w / 2, h * (face.image ? 0.6 : 0.72));
  s.commit();
}

/** The top card: a thin slab whose front (+Z) carries a drawn face. */
function buildCard() {
  const surface = makeSurface(512, 352);
  drawFace(surface, DEFAULT_FACE);
  const edge = new THREE.MeshStandardMaterial({ color: "#f3ede2", roughness: 0.8 });
  const back = new THREE.MeshStandardMaterial({ color: "#e9dfcf", roughness: 0.8 });
  const front = new THREE.MeshStandardMaterial({ color: "#ffffff", map: surface.tex, roughness: 0.75 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, CARD_H, 0.003), [edge, edge, edge, edge, front, back]);
  mesh.castShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return { group, surface };
}

export interface FocusDeck {
  /** The deck itself (box + stack + glow), placed in the scene. */
  group: THREE.Group;
  /** The top card, parented to the scene so it can be carried anywhere. */
  card: THREE.Group;
  /** Where the card rests on the deck (world space). */
  restPos: THREE.Vector3;
  restQuat: THREE.Quaternion;
  /** Generous invisible box for pointer hit-testing. */
  hit: THREE.Mesh;
  /** World point to anchor the "use focus cards?" prompt on. */
  anchor: THREE.Vector3;
  setHover(on: boolean): void;
  setFace(face: CardFace): void;
  update(t: number, dt: number): void;
  dispose(): void;
}

/**
 * A wooden tray of index cards with a soft halo so it reads as something to
 * touch. `scale` grows it for scenes viewed from further away.
 */
export function createFocusDeck(scene: THREE.Scene, at: THREE.Vector3, yaw = 0, scale = 1): FocusDeck {
  const group = new THREE.Group();
  group.position.copy(at);
  group.rotation.y = yaw;
  group.scale.setScalar(scale);

  const wood = new THREE.MeshStandardMaterial({ color: "#b07a4f", roughness: 0.6 });
  const trayW = CARD_W + 0.03;
  const trayD = CARD_H + 0.03;
  const base = new THREE.Mesh(new THREE.BoxGeometry(trayW, 0.012, trayD), wood);
  base.position.y = 0.006;
  group.add(base);
  for (const [w, d, x, z] of [[trayW, 0.01, 0, trayD / 2], [trayW, 0.01, 0, -trayD / 2], [0.01, trayD, trayW / 2, 0], [0.01, trayD, -trayW / 2, 0]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), wood);
    wall.position.set(x, 0.02, z);
    group.add(wall);
  }
  // A stack of cards in the tray, slightly fanned so they read as separate cards.
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(
      new THREE.BoxGeometry(CARD_W, 0.003, CARD_H),
      new THREE.MeshStandardMaterial({ color: i % 2 ? "#fffaf2" : CARD_COLORS[(i / 2) % CARD_COLORS.length | 0], roughness: 0.8 }),
    );
    c.position.set(Math.sin(i * 2.1) * 0.004, 0.015 + i * 0.0035, Math.cos(i * 1.7) * 0.003);
    c.rotation.y = Math.sin(i * 1.3) * 0.05;
    c.castShadow = true;
    group.add(c);
  }
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  // Halo ring on the surface under the deck — brightens on hover.
  const haloMat = new THREE.MeshBasicMaterial({ color: "#bff2cd", transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false });
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.14, 40).rotateX(-Math.PI / 2), haloMat);
  halo.position.y = 0.002;
  group.add(halo);
  // Little motes circling above the deck.
  const moteMat = new THREE.MeshBasicMaterial({ color: "#e9fff0", transparent: true, opacity: 0.8, toneMapped: false });
  const motes = Array.from({ length: 3 }, () => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), moteMat);
    group.add(m);
    return m;
  });

  const hit = new THREE.Mesh(new THREE.BoxGeometry(trayW + 0.08, 0.16, trayD + 0.08), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.06;
  group.add(hit);
  scene.add(group);
  group.updateMatrixWorld(true);

  const { group: card, surface } = buildCard();
  // Scale the slab, not the group: holders grow the group from 1 when they pick it up.
  card.children[0].scale.setScalar(scale);
  // Lies face-up on top of the stack.
  const restPos = new THREE.Vector3(0, 0.038, 0).applyMatrix4(group.matrixWorld);
  const restQuat = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
  card.position.copy(restPos);
  card.quaternion.copy(restQuat);
  scene.add(card);

  const anchor = new THREE.Vector3(0, 0.12, 0).applyMatrix4(group.matrixWorld);
  let hover = 0;
  let hoverTarget = 0;

  return {
    group,
    card,
    restPos,
    restQuat,
    hit,
    anchor,
    setHover(on) {
      hoverTarget = on ? 1 : 0;
    },
    setFace(face) {
      drawFace(surface, face);
    },
    update(t, dt) {
      hover += (hoverTarget - hover) * Math.min(1, dt * 8);
      haloMat.opacity = 0.18 + 0.1 * Math.sin(t * 2) + hover * 0.5;
      halo.scale.setScalar(1 + hover * 0.25 + 0.04 * Math.sin(t * 2));
      motes.forEach((m, i) => {
        const a = t * (0.8 + hover) + (i / motes.length) * Math.PI * 2;
        m.position.set(Math.cos(a) * 0.12, 0.08 + 0.03 * Math.sin(t * 1.7 + i), Math.sin(a) * 0.1);
      });
    },
    dispose() {
      surface.tex.dispose();
    },
  };
}

/** Point along a hop from `from` to `to`, `height` above the straight line at the middle. */
export function arcPoint(from: THREE.Vector3, to: THREE.Vector3, k: number, height: number, out: THREE.Vector3) {
  return out.lerpVectors(from, to, k).setY(out.y + Math.sin(Math.PI * k) * height);
}

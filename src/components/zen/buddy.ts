import * as THREE from "three";

// Nudge Buddy — the app mascot: a floating mint robot with a screen face,
// a heart-leaf sprout, ear pods, stubby arms and a hover ring beneath.

const MINT = "#6fcf86";
const MINT_DEEP = "#4fb06e";
const LEAF = "#63c97a";
const RING = "#4cc29a";
const SCREEN = "#0c1413";
const GLOW = "#5ff0f5";

const BODY_R = 0.2;
const HOVER_Y = 0.46;
// Face screen: an ellipsoid pushed slightly out of the body sphere.
const VISOR = { z: 0.122, rx: 0.19, ry: 0.138, rz: 0.092 };

function soft(color: string) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, sheen: 0.25, sheenColor: new THREE.Color("#e8fff0"), clearcoat: 0.2, clearcoatRoughness: 0.6 });
}

function heartShape(s: number) {
  const h = new THREE.Shape();
  h.moveTo(0, -s * 0.9);
  h.bezierCurveTo(s * 0.2, -s * 0.6, s * 1.0, -s * 0.2, s * 0.9, s * 0.35);
  h.bezierCurveTo(s * 0.8, s * 0.9, s * 0.15, s * 0.95, 0, s * 0.45);
  h.bezierCurveTo(-s * 0.15, s * 0.95, -s * 0.8, s * 0.9, -s * 0.9, s * 0.35);
  h.bezierCurveTo(-s * 1.0, -s * 0.2, -s * 0.2, -s * 0.6, 0, -s * 0.9);
  return h;
}

function leafShape(s: number) {
  const l = new THREE.Shape();
  l.moveTo(0, 0);
  l.bezierCurveTo(s * 0.55, s * 0.25, s * 0.5, s * 1.0, 0, s * 1.3);
  l.bezierCurveTo(-s * 0.5, s * 1.0, -s * 0.55, s * 0.25, 0, 0);
  return l;
}

/** Puffy extruded shape — the bevel gives the soft vinyl-toy look. */
function puffy(shape: THREE.Shape, bevel: number) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: bevel * 0.6, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 24 });
  geo.translate(0, 0, -bevel * 0.3);
  return geo;
}

/** z on the visor surface at (x, y), so face features sit right on the screen. */
function visorZ(x: number, y: number) {
  const k = 1 - (x / VISOR.rx) ** 2 - (y / VISOR.ry) ** 2;
  return VISOR.z + VISOR.rz * Math.sqrt(Math.max(0, k));
}

function glowArc(radius: number, tube: number, x: number, y: number, flip: boolean, arc = Math.PI) {
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 10, 28, arc),
    new THREE.MeshBasicMaterial({ color: GLOW, toneMapped: false }),
  );
  if (flip) m.rotation.z = Math.PI;
  const holder = new THREE.Group();
  holder.position.set(x, y, visorZ(x, y) + 0.004);
  // Tilt to follow the screen's curve.
  holder.rotation.set(-(y / VISOR.ry) * 0.45, (x / VISOR.rx) * 0.6, 0);
  holder.add(m);
  return holder;
}

export type BuddyRig = ReturnType<typeof buildBuddyRig>;

/**
 * The mascot's meshes and joints with no behaviour attached, so different
 * scenes (Explore, Workspace) can drive it their own way.
 */
export function buildBuddyRig() {
  const group = new THREE.Group();
  const hover = new THREE.Group(); // bob / hop
  hover.position.y = HOVER_Y;
  group.add(hover);
  const body = new THREE.Group(); // lean / spin
  hover.add(body);

  body.add(new THREE.Mesh(new THREE.SphereGeometry(BODY_R, 48, 32), soft(MINT)));

  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 32),
    new THREE.MeshPhysicalMaterial({ color: SCREEN, roughness: 0.12, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 }),
  );
  visor.scale.set(VISOR.rx, VISOR.ry, VISOR.rz);
  visor.position.z = VISOR.z;
  body.add(visor);

  // Face: happy ∩ ∩ eyes and a small smile, all glowing.
  const face = new THREE.Group();
  body.add(face);
  const eyes = [glowArc(0.033, 0.0095, -0.068, 0.022, false), glowArc(0.033, 0.0095, 0.068, 0.022, false)];
  const mouth = glowArc(0.019, 0.0075, 0, -0.04, true);
  face.add(...eyes, mouth);

  // Ear pods.
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.SphereGeometry(0.078, 32, 20), soft(MINT_DEEP));
    pod.scale.set(0.5, 1, 1);
    pod.position.set(side * 0.192, -0.01, -0.01);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.056, 28, 16), soft(MINT));
    cap.scale.set(0.35, 1, 1);
    cap.position.set(side * 0.226, -0.01, -0.01);
    body.add(pod, cap);
  }

  // Heart sprout on top, on a short stem.
  const sprout = new THREE.Group();
  sprout.position.y = BODY_R - 0.01;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.01, 0.06, 8), soft(LEAF));
  stem.position.y = 0.03;
  const heart = new THREE.Mesh(puffy(heartShape(0.045), 0.012), soft(LEAF));
  heart.position.y = 0.09;
  sprout.add(stem, heart);
  body.add(sprout);

  // Side leaf sticking out up-left.
  const sideLeaf = new THREE.Group();
  sideLeaf.position.set(-0.15, 0.12, 0.02);
  sideLeaf.rotation.z = 0.95;
  sideLeaf.add(new THREE.Mesh(puffy(leafShape(0.06), 0.01), soft(LEAF)));
  body.add(sideLeaf);

  // Stubby arms — pivot at the shoulder so they can wave.
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.165, -0.06, 0.095);
    const nub = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 16), soft(MINT));
    nub.scale.set(0.8, 1.1, 0.85);
    nub.position.set(side * 0.03, -0.06, 0);
    shoulder.add(nub);
    body.add(shoulder);
    arms.push(shoulder);
  }

  // Hover ring and the little drop "tail" beneath — part of the float, not the body.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.13, 0.017, 16, 48),
    new THREE.MeshPhysicalMaterial({ color: RING, roughness: 0.35, emissive: RING, emissiveIntensity: 0.15, clearcoat: 0.5 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.26;
  hover.add(ring);
  const drop = new THREE.Mesh(new THREE.SphereGeometry(0.04, 24, 16), soft(RING));
  drop.scale.set(1, 0.55, 1);
  drop.position.y = -0.34;
  hover.add(drop);

  // Extras for the Workspace scenes — hidden until a scene uses them.
  // Wide "o o" eyes for surprise.
  const wideEyes = [glowArc(0.026, 0.009, -0.068, 0.02, false, Math.PI * 2), glowArc(0.026, 0.009, 0.068, 0.02, false, Math.PI * 2)];
  wideEyes.forEach((e) => (e.visible = false));
  face.add(...wideEyes);

  // Headphones for focus mode.
  const headphones = new THREE.Group();
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.014, 10, 40, Math.PI), soft("#3d4a52"));
  band.position.y = 0.0;
  const cupMat = soft("#3d4a52");
  for (const side of [-1, 1]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 24), cupMat);
    cup.rotation.z = Math.PI / 2;
    cup.position.set(side * 0.232, -0.01, -0.01);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.052, 24), soft(GLOW));
    pad.rotation.z = Math.PI / 2;
    pad.position.set(side * 0.236, -0.01, -0.01);
    headphones.add(cup, pad);
  }
  headphones.add(band);
  headphones.visible = false;
  body.add(headphones);

  // Pen held in the right hand.
  const pen = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 10), soft("#f2b84b"));
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.02, 10), soft("#2a2a2a"));
  tip.position.y = -0.07;
  tip.rotation.x = Math.PI;
  pen.add(barrel, tip);
  pen.position.set(0.03, -0.1, 0.03);
  pen.rotation.x = 0.5;
  pen.visible = false;
  arms[1].add(pen);

  return { group, hover, body, face, eyes, mouth, wideEyes, arms, sprout, sideLeaf, ring, drop, headphones, pen };
}

export const BUDDY_HOVER_Y = HOVER_Y;

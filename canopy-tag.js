import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

/* ----------------------------------------------------------------------
   CANOPY TAG — a small WebXR arm-swinging forest game.
   Locomotion: grip a controller and move your hand; the world moves the
   opposite direction, like pulling yourself through the air. No thumbstick
   locomotion, no snap-turn — you physically turn your body to steer.
------------------------------------------------------------------------- */

// ---------- basic state ----------
let mode = 'casual';                 // 'casual' | 'infection'
let playing = false;
let survivalStart = 0;
let bananaCount = 0;
const WORLD_BOUND = 58;              // invisible fence radius around the stump
const ARM_STRENGTH = 1.35;           // how much a given arm-pull moves you
const FRICTION = 0.92;               // per-frame velocity decay while coasting
const GRAVITY = 9.8;

// ---------- renderer / scene / camera ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x25361f);
scene.fog = new THREE.Fog(0x2b3d24, 12, 70);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 200);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// the "dolly" is what actually moves through the forest. The camera's local
// position inside it is driven entirely by the headset.
const dolly = new THREE.Group();
dolly.add(camera);
scene.add(dolly);

// ---------- lighting ----------
const hemi = new THREE.HemisphereLight(0xbfd8a0, 0x33291d, 0.9);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff1c9, 1.1);
sun.position.set(30, 45, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
sun.shadow.camera.far = 120;
scene.add(sun);

// ---------- ground ----------
const groundMat = new THREE.MeshStandardMaterial({ color: 0x3c552e, roughness: 1 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 64), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// a subtle darker forest floor ring texture via scattered patches
for (let i = 0; i < 40; i++) {
  const r = 6 + Math.random() * 80;
  const a = Math.random() * Math.PI * 2;
  const patch = new THREE.Mesh(
    new THREE.CircleGeometry(1.5 + Math.random() * 3, 10),
    new THREE.MeshStandardMaterial({ color: 0x33481f, roughness: 1 })
  );
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(Math.cos(a) * r, 0.01, Math.sin(a) * r);
  patch.receiveShadow = true;
  scene.add(patch);
}

// ---------- stump (spawn point) ----------
function makeRingTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c9a876';
  ctx.fillRect(0, 0, 256, 256);
  const cx = 128, cy = 128;
  for (let r = 120; r > 4; r -= 6 + Math.random() * 3) {
    ctx.strokeStyle = `rgba(90,60,35,${0.25 + Math.random() * 0.25})`;
    ctx.lineWidth = 1.5 + Math.random() * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // a small crack
  ctx.strokeStyle = 'rgba(60,40,25,0.5)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 90, cy - 10);
  ctx.lineTo(cx + 70, cy + 30);
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}

const stumpGroup = new THREE.Group();
const stumpTrunk = new THREE.Mesh(
  new THREE.CylinderGeometry(1.3, 1.5, 1.1, 20),
  new THREE.MeshStandardMaterial({ color: 0x5c4630, roughness: 1 })
);
stumpTrunk.position.y = 0.55;
stumpTrunk.castShadow = true;
stumpTrunk.receiveShadow = true;
stumpGroup.add(stumpTrunk);

const stumpTop = new THREE.Mesh(
  new THREE.CylinderGeometry(1.32, 1.32, 0.06, 20),
  new THREE.MeshStandardMaterial({ map: makeRingTexture(), roughness: 0.9 })
);
stumpTop.position.y = 1.13;
stumpTop.castShadow = true;
stumpGroup.add(stumpTop);

stumpGroup.position.set(0, 0, 0);
scene.add(stumpGroup);

// spawn a little back from the stump, facing it
dolly.position.set(0, 0, 4.5);

// ---------- trees ----------
function makeTree(scale) {
  const g = new THREE.Group();
  const trunkH = 3.2 * scale;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22 * scale, 0.32 * scale, trunkH, 8),
    new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 1 })
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  g.add(trunk);

  const foliageColor = Math.random() > 0.5 ? 0x2f4a26 : 0x35521f;
  const layers = 3;
  for (let i = 0; i < layers; i++) {
    const coneH = 2.1 * scale * (1 - i * 0.12);
    const coneR = 1.5 * scale * (1 - i * 0.18);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(coneR, coneH, 9),
      new THREE.MeshStandardMaterial({ color: foliageColor, roughness: 1 })
    );
    cone.position.y = trunkH - i * coneH * 0.55 + coneH * 0.4;
    cone.castShadow = true;
    cone.receiveShadow = true;
    g.add(cone);
  }
  return g;
}

const treePositions = [];
let attempts = 0;
while (treePositions.length < 130 && attempts < 4000) {
  attempts++;
  const r = 7 + Math.random() * 78;
  const a = Math.random() * Math.PI * 2;
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  let ok = true;
  for (const p of treePositions) {
    if ((p.x - x) ** 2 + (p.z - z) ** 2 < 9) { ok = false; break; }
  }
  if (ok) treePositions.push({ x, z });
}
for (const p of treePositions) {
  const scale = 0.8 + Math.random() * 0.9;
  const tree = makeTree(scale);
  tree.position.set(p.x, 0, p.z);
  tree.rotation.y = Math.random() * Math.PI * 2;
  scene.add(tree);
}

// a boundary of thicker trees so the forest feels enclosed
for (let a = 0; a < Math.PI * 2; a += 0.12) {
  const r = 82 + Math.random() * 6;
  const tree = makeTree(1.1 + Math.random() * 0.5);
  tree.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  scene.add(tree);
}

// ---------- controllers & arm-swing locomotion ----------
const controllerModelFactory = new XRControllerModelFactory();
const controllers = [];
const grips = [];
const prevPos = [new THREE.Vector3(), new THREE.Vector3()];
const tracked = [false, false];       // true once we have a valid previous-frame position
const velocity = new THREE.Vector3();
const MOVE_DEADZONE = 0.0009;         // per-frame squared-distance threshold to ignore hand tremor

function fistMesh() {
  const m = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.055, 0),
    new THREE.MeshStandardMaterial({ color: 0x6b8f5a, emissive: 0x0a0a0a })
  );
  return m;
}

for (let i = 0; i < 2; i++) {
  const controller = renderer.xr.getController(i);
  dolly.add(controller);

  const fist = fistMesh();
  controller.add(fist);
  controller.userData.fist = fist;

  // no buttons involved in movement — we just start/stop tracking a hand
  // as it connects/disconnects, so the very first frame doesn't jump.
  controller.addEventListener('connected', () => {
    prevPos[i].copy(controller.position);
    tracked[i] = true;
  });
  controller.addEventListener('disconnected', () => {
    tracked[i] = false;
  });

  const grip = renderer.xr.getControllerGrip(i);
  grip.add(controllerModelFactory.createControllerModel(grip));
  dolly.add(grip);

  controllers.push(controller);
  grips.push(grip);
}

// ---------- VR button + dom-overlay wiring ----------
const hud = document.getElementById('hud');
const overlay = document.getElementById('overlay');

const vrButton = VRButton.createButton(renderer, {
  optionalFeatures: ['dom-overlay'],
  domOverlay: { root: hud }
});
document.getElementById('vr-slot').appendChild(vrButton);

if (!('xr' in navigator)) {
  document.getElementById('novr-msg').style.display = 'block';
}

renderer.xr.addEventListener('sessionstart', () => {
  overlay.style.display = 'none';
  hud.style.display = 'block';
  startRound();
});
renderer.xr.addEventListener('sessionend', () => {
  overlay.style.display = 'flex';
  hud.style.display = 'none';
  playing = false;
});

document.getElementById('exit-btn').addEventListener('click', () => {
  const session = renderer.xr.getSession();
  if (session) session.end();
});

// mode picker (desktop menu)
document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    mode = btn.dataset.mode;
  });
});

const hudModeLabel = document.getElementById('hud-mode-label');
const hudLine = document.getElementById('hud-line');
const hudStatus = document.getElementById('hud-status');

function flashStatus(text, ms = 2200) {
  hudStatus.textContent = text;
  hudStatus.style.opacity = '1';
  clearTimeout(flashStatus._t);
  flashStatus._t = setTimeout(() => (hudStatus.style.opacity = '0'), ms);
}

// ---------- bananas (casual mode) ----------
const bananaGroup = new THREE.Group();
scene.add(bananaGroup);
const bananaMat = new THREE.MeshStandardMaterial({ color: 0xf3d13f, roughness: 0.5 });

function spawnBanana() {
  const geo = new THREE.TorusGeometry(0.16, 0.055, 8, 12, Math.PI * 1.3);
  const m = new THREE.Mesh(geo, bananaMat);
  const r = 3 + Math.random() * 55;
  const a = Math.random() * Math.PI * 2;
  m.position.set(Math.cos(a) * r, 0.9 + Math.random() * 0.6, Math.sin(a) * r);
  m.rotation.z = Math.random() * Math.PI;
  m.userData.spin = 0.4 + Math.random() * 0.6;
  bananaGroup.add(m);
}

function resetBananas() {
  bananaGroup.clear();
  bananaCount = 0;
  for (let i = 0; i < 16; i++) spawnBanana();
}

// ---------- bots (infection tag mode) ----------
const botGroup = new THREE.Group();
scene.add(botGroup);

function makeBot(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.55, 4, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
  );
  body.position.y = 0.75;
  body.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 12, 10),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
  );
  head.position.y = 1.28;
  head.castShadow = true;
  g.add(body, head);
  g.userData.bodyMesh = body;
  g.userData.headMesh = head;
  return g;
}

const SURVIVOR_COLOR = 0x6ea84e;
const INFECTED_COLOR = 0xb43a2f;
const BOT_COUNT = 5;
const TAG_RADIUS = 1.0;
let playerInfected = false;

function recolorBot(bot, infected) {
  const c = infected ? INFECTED_COLOR : SURVIVOR_COLOR;
  bot.userData.bodyMesh.material.color.set(c);
  bot.userData.headMesh.material.color.set(c);
  bot.userData.infected = infected;
}

function resetInfectionRound() {
  botGroup.clear();
  playerInfected = false;
  survivalStart = performance.now();
  for (let i = 0; i < BOT_COUNT; i++) {
    const bot = makeBot(SURVIVOR_COLOR);
    const r = 8 + Math.random() * 45;
    const a = Math.random() * Math.PI * 2;
    bot.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    bot.userData.wanderDir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    bot.userData.wanderTimer = 0;
    botGroup.add(bot);
  }
  const patientZero = botGroup.children[Math.floor(Math.random() * botGroup.children.length)];
  recolorBot(patientZero, true);
  flashStatus('Round start — run!');
}

function updateBots(dt) {
  const playerPos = new THREE.Vector3();
  dolly.getWorldPosition(playerPos);

  const infectedList = botGroup.children.filter((b) => b.userData.infected);
  const survivorList = botGroup.children.filter((b) => !b.userData.infected);

  for (const bot of botGroup.children) {
    const speed = bot.userData.infected ? 3.1 : 2.6;
    let dir = null;

    if (bot.userData.infected) {
      // chase nearest survivor (player counts as a survivor target if not infected)
      let nearestDist = Infinity, target = null;
      if (!playerInfected) {
        const d = bot.position.distanceTo(playerPos);
        if (d < nearestDist) { nearestDist = d; target = playerPos; }
      }
      for (const s of survivorList) {
        const d = bot.position.distanceTo(s.position);
        if (d < nearestDist) { nearestDist = d; target = s.position; }
      }
      if (target) dir = target.clone().sub(bot.position).setY(0).normalize();
    } else {
      // flee nearest infected if close, else wander
      let nearestDist = Infinity, threat = null;
      for (const inf of infectedList) {
        const d = bot.position.distanceTo(inf.position);
        if (d < nearestDist) { nearestDist = d; threat = inf.position; }
      }
      if (!playerInfected) {
        // survivors are mildly cautious of the player too if infected — skip, player isn't a threat unless infected
      } else {
        const d = bot.position.distanceTo(playerPos);
        if (d < nearestDist) { nearestDist = d; threat = playerPos; }
      }
      if (threat && nearestDist < 14) {
        dir = bot.position.clone().sub(threat).setY(0).normalize();
      } else {
        bot.userData.wanderTimer -= dt;
        if (bot.userData.wanderTimer <= 0) {
          bot.userData.wanderDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
          bot.userData.wanderTimer = 2 + Math.random() * 2;
        }
        dir = bot.userData.wanderDir;
      }
    }

    if (dir) {
      bot.position.addScaledVector(dir, speed * dt);
      const targetAngle = Math.atan2(dir.x, dir.z);
      bot.rotation.y = targetAngle;
    }
    const r = Math.hypot(bot.position.x, bot.position.z);
    if (r > WORLD_BOUND) {
      bot.position.multiplyScalar(WORLD_BOUND / r);
    }
  }

  // tag resolution
  for (const inf of infectedList) {
    for (const s of survivorList) {
      if (s.userData.infected) continue;
      if (inf.position.distanceTo(s.position) < TAG_RADIUS) {
        recolorBot(s, true);
      }
    }
    if (!playerInfected && inf.position.distanceTo(playerPos) < TAG_RADIUS) {
      playerInfected = true;
      flashStatus("You've been infected!", 2600);
    }
  }

  // round-complete check: everyone infected
  const allInfected = botGroup.children.every((b) => b.userData.infected) && playerInfected;
  const allSurvivorsCaught = botGroup.children.every((b) => b.userData.infected);
  if (allSurvivorsCaught && !playerInfected) {
    const seconds = Math.round((performance.now() - survivalStart) / 1000);
    flashStatus(`You survived the round! (${seconds}s) New round starting…`, 3200);
    setTimeout(resetInfectionRound, 3300);
  } else if (allInfected) {
    flashStatus('Everyone is infected. New round starting…', 2600);
    setTimeout(resetInfectionRound, 2700);
  }
}

// ---------- round management ----------
function startRound() {
  playing = true;
  hudModeLabel.textContent = mode === 'casual' ? 'CASUAL' : 'INFECTION TAG';
  dolly.position.set(0, 0, 4.5);
  velocity.set(0, 0, 0);
  botGroup.clear();
  bananaGroup.clear();
  if (mode === 'casual') {
    resetBananas();
    hudLine.textContent = 'Bananas: 0';
  } else {
    resetInfectionRound();
    hudLine.textContent = 'Survive!';
  }
}

// ---------- desktop preview fallback (keyboard + mouse-drag look) ----------
const keys = {};
window.addEventListener('keydown', (e) => (keys[e.code] = true));
window.addEventListener('keyup', (e) => (keys[e.code] = false));
let dragging = false, lastX = 0, lastY = 0, yaw = 0, pitch = 0;
renderer.domElement.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('mouseup', () => (dragging = false));
window.addEventListener('mousemove', (e) => {
  if (!dragging || renderer.xr.isPresenting) return;
  yaw -= (e.clientX - lastX) * 0.0025;
  pitch -= (e.clientY - lastY) * 0.0025;
  pitch = Math.max(-1.2, Math.min(1.2, pitch));
  lastX = e.clientX; lastY = e.clientY;
});

function updateDesktopPreview(dt) {
  if (renderer.xr.isPresenting) return;
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  const speed = 6 * dt;
  if (keys['KeyW']) dolly.position.addScaledVector(forward, speed);
  if (keys['KeyS']) dolly.position.addScaledVector(forward, -speed);
  if (keys['KeyA']) dolly.position.addScaledVector(right, -speed);
  if (keys['KeyD']) dolly.position.addScaledVector(right, speed);
  camera.position.set(0, 1.65, 0);
}

// ---------- main loop ----------
const clock = new THREE.Clock();

function updateLocomotion(dt) {
  // Always-on arm swing: whichever hand is moving pulls you the opposite
  // direction, every frame, no button required. A small deadzone stops
  // natural hand tremor from causing drift when your hands are still.
  let anyMoving = false;
  for (let i = 0; i < 2; i++) {
    if (!tracked[i]) continue;
    const controller = controllers[i];
    const delta = controller.position.clone().sub(prevPos[i]);
    prevPos[i].copy(controller.position);

    if (delta.lengthSq() > MOVE_DEADZONE * dt) {
      anyMoving = true;
      dolly.position.sub(delta.clone().multiplyScalar(ARM_STRENGTH));
      if (dt > 0) velocity.copy(delta).multiplyScalar(-ARM_STRENGTH / dt);
      controller.userData.fist.material.color.set(0xe0a83a);
    } else {
      controller.userData.fist.material.color.set(0x6b8f5a);
    }
  }
  if (!anyMoving) {
    velocity.y -= GRAVITY * dt;
    dolly.position.addScaledVector(velocity, dt);
    velocity.multiplyScalar(FRICTION);
    if (dolly.position.y < 0) {
      dolly.position.y = 0;
      velocity.y = 0;
    }
  } else {
    dolly.position.y = Math.max(0, dolly.position.y);
  }

  const r = Math.hypot(dolly.position.x, dolly.position.z);
  if (r > WORLD_BOUND) {
    const scale = WORLD_BOUND / r;
    dolly.position.x *= scale;
    dolly.position.z *= scale;
  }
}

function updateBananas(dt) {
  if (mode !== 'casual' || !playing) return;
  const playerPos = new THREE.Vector3();
  dolly.getWorldPosition(playerPos);
  for (const b of [...bananaGroup.children]) {
    b.rotation.y += b.userData.spin * dt;
    if (b.position.distanceTo(playerPos) < 1.0) {
      bananaGroup.remove(b);
      bananaCount++;
      hudLine.textContent = `Bananas: ${bananaCount}`;
      spawnBanana();
    }
  }
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (renderer.xr.isPresenting) {
    updateLocomotion(dt);
    if (mode === 'infection' && playing) updateBots(dt);
    updateBananas(dt);
  } else {
    updateDesktopPreview(dt);
  }

  renderer.render(scene, camera);
});

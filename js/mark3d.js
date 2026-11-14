// The Grdlabs mark in 3D at the top of the page: the blue tile and the white arrow as two solid pieces. It leans
// toward the pointer, the arrow floats out in front of the tile, a light follows the pointer across it, dragging spins
// it (it keeps turning and settles back), and a tap makes it jump and turn once. Draws only while it is on screen.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const box = document.getElementById('mark3d');
const hero = document.getElementById('hero');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- the two shapes, from the logo's own path (y up, units of the tile's height) ----------
const H = 446.52, W = 444.093, R = 140.874;      // the tile: 444 × 446 with 141 corners
const CX = -303.219 + W / 2, CY = H / 2;          // its centre, in the logo's coordinates
const k = 1 / H;                                   // one unit = the tile's height
const P = (x, y) => [(x - CX) * k, (y - CY) * k];

const tile = new THREE.Shape();
{
  const x0 = -303.219, x1 = 140.874, y0 = 0, y1 = H;
  const m = (x, y) => P(x, y);
  tile.moveTo(...m(x0 + R, y0));
  tile.lineTo(...m(x1 - R, y0)); tile.quadraticCurveTo(...m(x1, y0), ...m(x1, y0 + R));
  tile.lineTo(...m(x1, y1 - R)); tile.quadraticCurveTo(...m(x1, y1), ...m(x1 - R, y1));
  tile.lineTo(...m(x0 + R, y1)); tile.quadraticCurveTo(...m(x0, y1), ...m(x0, y1 - R));
  tile.lineTo(...m(x0, y0 + R)); tile.quadraticCurveTo(...m(x0, y0), ...m(x0 + R, y0));
}
const arrow = new THREE.Shape();
{
  // The white corner arrow, moved from its own place in the logo onto the tile.
  const dx = 431.5282 - 344.7027, dy = 481.0254 - 180.8653;
  const a = (x, y) => P(x + dx, y + dy);
  arrow.moveTo(...a(0, 0));
  arrow.bezierCurveTo(...a(0, 51.985), ...a(-42.142, 94.127), ...a(-94.127, 94.127));
  arrow.lineTo(...a(-232.876, 94.127)); arrow.lineTo(...a(-232.876, 2.042));
  arrow.lineTo(...a(-93.905, 2.042)); arrow.lineTo(...a(-93.905, -135.11));
  arrow.lineTo(...a(0, -135.11)); arrow.closePath();
}

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
box.prepend(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
camera.position.set(0, 0, 4.2);

const blue = new THREE.MeshPhysicalMaterial({ color: 0x1543ef, roughness: 0.28, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.4, sheenColor: 0x7aa2ff });
const white = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, emissive: 0x2a3d7a, emissiveIntensity: 0.05 });

const bevel = { bevelEnabled: true, bevelSegments: 8, curveSegments: 48 };
const tileGeo = new THREE.ExtrudeGeometry(tile, { ...bevel, depth: 0.16, bevelThickness: 0.05, bevelSize: 0.045 });
tileGeo.translate(0, 0, -0.08);
const arrowGeo = new THREE.ExtrudeGeometry(arrow, { ...bevel, depth: 0.14, bevelThickness: 0.035, bevelSize: 0.02 });

const group = new THREE.Group();
const tileMesh = new THREE.Mesh(tileGeo, blue);
const arrowMesh = new THREE.Mesh(arrowGeo, white);
arrowMesh.position.z = 0.16;
group.add(tileMesh, arrowMesh);
scene.add(group);

scene.add(new THREE.AmbientLight(0xbfd2ff, 0.35));
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-2, 3, 4); scene.add(key);
const spot = new THREE.PointLight(0x9db8ff, 14, 9, 1.6); spot.position.set(1, 1, 2.2); scene.add(spot);

const shadow = box.querySelector('.shadow');

// ---------- motion: springs toward where the pointer says ----------
const spring = (v, stiff = 0.08, damp = 0.82) => ({ v, t: v, s: 0, stiff, damp, step() { this.s = (this.s + (this.t - this.v) * this.stiff) * this.damp; this.v += this.s; return this.v; } });
const rx = spring(0), ry = spring(0), pop = spring(0, 0.1, 0.78), scale = spring(1, 0.12, 0.75), lift = spring(0, 0.09, 0.8);
let spin = 0, spinV = 0, dragging = false, lastX = 0, hover = false, jumpT = -1;
const pointer = { x: 0, y: 0 };

const aim = (cx, cy) => {
  const r = box.getBoundingClientRect();
  const nx = (cx - (r.left + r.width / 2)) / (innerWidth / 2), ny = (cy - (r.top + r.height / 2)) / (innerHeight / 2);
  pointer.x = Math.max(-1, Math.min(1, nx)); pointer.y = Math.max(-1, Math.min(1, ny));
  ry.t = pointer.x * 0.75; rx.t = pointer.y * 0.55;
};
addEventListener('pointermove', (e) => {
  aim(e.clientX, e.clientY);
  if (dragging) { spinV += (e.clientX - lastX) * 0.0045; lastX = e.clientX; }
}, { passive: true });
box.addEventListener('pointerenter', () => { hover = true; scale.t = 1.07; pop.t = 0.22; });
box.addEventListener('pointerleave', () => { hover = false; scale.t = 1; pop.t = 0; });
box.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; box.setPointerCapture?.(e.pointerId); downAt = performance.now(); downX = e.clientX; });
let downAt = 0, downX = 0;
const release = (e) => {
  if (!dragging) return;
  dragging = false;
  // A tap (not a drag): the mark jumps and turns once.
  if (performance.now() - downAt < 260 && Math.abs(e.clientX - downX) < 6) { jumpT = 0; spinV += 0.32; pop.s += 0.12; }
};
addEventListener('pointerup', release); addEventListener('pointercancel', release);

// ---------- size, and drawing only while seen ----------
const fit = () => { const { width, height } = box.getBoundingClientRect(); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); };
new ResizeObserver(fit).observe(box); fit();
let seen = true;
new IntersectionObserver(([x]) => { seen = x.isIntersecting; if (seen) requestAnimationFrame(frame); }, { threshold: 0 }).observe(box);
document.addEventListener('visibilitychange', () => { if (!document.hidden && seen) requestAnimationFrame(frame); });

let t0 = performance.now(), running = false;
function frame(now) {
  if (running) return;
  running = true;
  const loop = (time) => {
    if (!seen || document.hidden) { running = false; return; }
    const t = (time - t0) / 1000;
    // The spin keeps the push of a drag and slows down, then settles on the nearest face.
    spinV *= dragging ? 0.85 : 0.94;
    spin += spinV;
    if (!dragging && Math.abs(spinV) < 0.002) { const near = Math.round(spin / (Math.PI * 2)) * Math.PI * 2; spin += (near - spin) * 0.06; }
    // A jump: up and back down in 0.7 s.
    if (jumpT >= 0) { jumpT += 1 / 60; lift.t = jumpT < 0.35 ? 0.35 : 0; if (jumpT > 0.9) jumpT = -1; }
    const idle = still ? 0 : Math.sin(t * 1.3) * 0.045;
    group.rotation.x = rx.step() + (still ? 0 : Math.sin(t * 0.7) * 0.05);
    group.rotation.y = ry.step() + spin + (still ? 0 : Math.sin(t * 0.5) * 0.08);
    const s = scale.step();
    group.scale.setScalar(s);
    const up = lift.step();
    group.position.y = idle + up;
    // The arrow floats out of the tile and leans a little further than it.
    arrowMesh.position.z = 0.16 + pop.step() + (still ? 0 : (Math.sin(t * 1.7) + 1) * 0.02);
    arrowMesh.position.x = pointer.x * 0.035; arrowMesh.position.y = -pointer.y * 0.035;
    // The light follows the pointer across the face.
    spot.position.set(pointer.x * 2.2, -pointer.y * 1.8 + 0.6, 2.2);
    spot.intensity = hover ? 22 : 14;
    if (shadow) { const h = idle + up; shadow.style.transform = `scale(${(1.05 - h * 0.9).toFixed(3)})`; shadow.style.opacity = String((0.85 - h * 1.2).toFixed(3)); }
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
box.classList.add('live');
requestAnimationFrame(frame);

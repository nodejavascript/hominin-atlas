/**
 * globe.ts — the three.js globe.
 *
 * Everything the visitor sees is drawn from the dataset and from two bundled
 * files: the Natural Earth land polygons (from the world-atlas package) and
 * three.js itself. Nothing is fetched from a content delivery network, for the
 * same reason nothing from Google is in the page — a first paint should not
 * depend on somebody else's server, and a visit that refuses cookies should make
 * no third-party request at all.
 *
 * Three things are drawn on the sphere:
 *
 *   dots      one per excavated locality, coloured by species, sized by the
 *             population estimate where one exists
 *   threads   migration routes, drawn as tubes along the waypoints
 *   rings     the contact events — where two hominins were in the same place
 *
 * The globe is one group. Routes and dots are children of it, so a rotation
 * moves all of them together, which is the only way the dots stay on their
 * localities.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { feature } from 'topojson-client';
import land from 'world-atlas/land-50m.json';

import {
  atlas,
  isLowSea,
  lifeFraction,
  SHELF as SHELF_SHAPES,
  speciesAlive,
} from './atlas';
import type { Contact, ContactKind, Presence } from './types';

const R = 1;
const W = 2048;
const H = 1024;

const OCEAN = '#0f1620';
const LAND = '#4a3b28';
const LAND_EDGE = '#7d6547';
const SHELF_FILL = 'rgba(214, 140, 60, 0.32)';
const SHELF_EDGE = 'rgba(245, 176, 88, 0.55)';

const CONTACT_COLOUR: Record<ContactKind, string> = {
  admixture: '#ff6bd6',
  hybrid: '#ffd166',
  replacement: '#ff5a4d',
  coexistence: '#7dd3fc',
  overlap: '#a7a29b',
  conflict: '#ff2f6d',
};

export interface Selection {
  kind: 'presence' | 'contact';
  presence?: Presence;
  contact?: Contact;
}

export interface GlobeApi {
  setYears(years: number): void;
  setFilter(ids: Set<string> | null): void;
  focusOn(lat: number, lon: number): void;
  resetView(): void;
  resize(): void;
  dispose(): void;
}

export type SelectHandler = (selection: Selection | null) => void;

// ── projection ────────────────────────────────────────────────────────────────

function lonToX(lon: number): number {
  return ((lon + 180) / 360) * W;
}

function latToY(lat: number): number {
  return ((90 - lat) / 180) * H;
}

/** Latitude and longitude to a point on a sphere of radius r. */
function ll2v(lat: number, lon: number, r: number): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

// ── the map texture ───────────────────────────────────────────────────────────

type Pt = [number, number];
type Ring = Pt[];
type Poly = Ring[];

function drawLand(ctx: CanvasRenderingContext2D, polygons: Poly[]): void {
  ctx.fillStyle = LAND;
  ctx.beginPath();
  for (const polygon of polygons) {
    for (const ring of polygon) {
      if (ring.length < 3) continue;
      const first = ring[0]!;
      ctx.moveTo(lonToX(first[0]), latToY(first[1]));
      for (let i = 1; i < ring.length; i++) {
        const pt = ring[i]!;
        ctx.lineTo(lonToX(pt[0]), latToY(pt[1]));
      }
      ctx.closePath();
    }
  }
  ctx.fill('evenodd');
  ctx.strokeStyle = LAND_EDGE;
  ctx.lineWidth = 1.1;
  ctx.stroke();
}

function drawGraticule(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let lon = -180; lon <= 180; lon += 30) {
    ctx.moveTo(lonToX(lon), 0);
    ctx.lineTo(lonToX(lon), H);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    ctx.moveTo(0, latToY(lat));
    ctx.lineTo(W, latToY(lat));
  }
  ctx.stroke();
}

function drawShelf(ctx: CanvasRenderingContext2D, offsets: number[]): void {
  for (const offset of offsets) {
    for (const shelf of SHELF_SHAPES) {
      ctx.beginPath();
      for (let i = 0; i < shelf.pts.length; i++) {
        const [lon, lat] = shelf.pts[i]!;
        const x = lonToX(lon + offset);
        const y = latToY(lat);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = SHELF_FILL;
      ctx.fill();
      ctx.strokeStyle = SHELF_EDGE;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }
}

function makeTexture(withShelf: boolean, polygons: Poly[]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  ctx.fillStyle = OCEAN;
  ctx.fillRect(0, 0, W, H);
  drawLand(ctx, polygons);
  drawGraticule(ctx);
  if (withShelf) drawShelf(ctx, [0, -360, 360]);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function landPolygons(): Poly[] {
  const topology = land as unknown as { objects: { land: unknown } };
  const collection = feature(topology as never, topology.objects.land as never) as unknown as {
    features: { geometry: { type: string; coordinates: unknown } }[];
  };
  const out: Poly[] = [];
  for (const f of collection.features) {
    const g = f.geometry;
    if (g.type === 'Polygon') out.push(g.coordinates as Poly);
    else if (g.type === 'MultiPolygon') out.push(...(g.coordinates as Poly[]));
  }
  return out;
}

// ── the globe ─────────────────────────────────────────────────────────────────

export function createGlobe(container: HTMLElement, onSelect: SelectHandler): GlobeApi {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#120703');

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0.6, 3.1);
  scene.add(camera);

  const ambient = new THREE.AmbientLight(0xffffff, 1.35);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff0dd, 1.5);
  key.position.set(1.2, 0.7, 1.6);
  camera.add(key);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const globe = new THREE.Group();
  globe.rotation.order = 'YXZ';
  scene.add(globe);

  const polygons = landPolygons();
  // Built once. The shelf is the only thing that changes with the timeline, so
  // there are exactly two textures and the globe swaps between them.
  const texPlain = makeTexture(false, polygons);
  const texShelf = makeTexture(true, polygons);

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(R, 128, 80),
    new THREE.MeshStandardMaterial({ map: texPlain, roughness: 1, metalness: 0 }),
  );
  globe.add(surface);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.035, 64, 40),
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color('#e08a3c') } },
      vertexShader: `varying vec3 vN;
        void main(){ vN = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vN; uniform vec3 uColor;
        void main(){ float i = pow(0.68 - dot(vN, vec3(0.0, 0.0, 1.0)), 3.0);
          gl_FragColor = vec4(uColor, 1.0) * max(i, 0.0); }`,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  globe.add(atmosphere);

  // A thin star field, well outside the globe, so the sphere reads as a body in
  // space rather than a disc on a page.
  const starCount = 900;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(28 + Math.random() * 12);
    starPos.set([v.x, v.y, v.z], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(
    new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0x9a8470, size: 0.11, sizeAttenuation: true }),
    ),
  );

  // ── dots ────────────────────────────────────────────────────────────────────
  const dotGeo = new THREE.SphereGeometry(1, 10, 8);
  const dotMat = new THREE.MeshBasicMaterial({ transparent: true });
  const dots = atlas.presences.map((p) => {
    const species = atlas.speciesById.get(p.s);
    const mesh = new THREE.Mesh(dotGeo, dotMat.clone());
    (mesh.material as THREE.MeshBasicMaterial).color = new THREE.Color(species?.colour ?? '#ffffff');
    mesh.position.copy(ll2v(p.lat, p.lon, R * 1.009));
    mesh.userData.presence = p;
    globe.add(mesh);
    return mesh;
  });

  // ── routes ──────────────────────────────────────────────────────────────────
  const routes = atlas.routes.map((r) => {
    const species = atlas.speciesById.get(r.s);
    const curve = new THREE.CatmullRomCurve3(
      r.pts.map(([lon, lat]) => ll2v(lat, lon, R * 1.014)),
      false,
      'catmullrom',
      0.4,
    );
    const geo = new THREE.TubeGeometry(curve, Math.max(24, r.pts.length * 10), 0.0035, 6, false);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(species?.colour ?? '#ffffff'),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.route = r;
    globe.add(mesh);
    return mesh;
  });

  // ── contact rings ───────────────────────────────────────────────────────────
  const ringGeo = new THREE.RingGeometry(0.019, 0.027, 40);
  const contacts = atlas.contacts.map((c) => {
    const group = new THREE.Group();
    group.position.copy(ll2v(c.lat, c.lon, R * 1.012));
    group.lookAt(0, 0, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(CONTACT_COLOUR[c.kind]),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, mat);
    ring.userData.contact = c;
    group.add(ring);
    globe.add(group);
    return ring;
  });

  // ── controls ────────────────────────────────────────────────────────────────
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 1.6;
  controls.maxDistance = 6;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.32;
  controls.rotateSpeed = 0.55;

  let spinX = 0;
  let spinY = 0;
  let targetX: number | null = null;
  let targetY: number | null = null;

  renderer.domElement.addEventListener('pointerdown', () => {
    controls.autoRotate = false;
    targetX = null;
    targetY = null;
  });

  // ── picking ─────────────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered: THREE.Mesh | null = null;

  function pick(event: PointerEvent): THREE.Mesh | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    raycaster.params.Points = { threshold: 0 };
    const live = dots.filter((d) => d.visible && d.scale.x > 0.0001);
    const hit = raycaster.intersectObjects(live, false)[0];
    return (hit?.object as THREE.Mesh | undefined) ?? null;
  }

  renderer.domElement.addEventListener('pointermove', (event) => {
    const hit = pick(event);
    if (hit !== hovered) {
      hovered = hit;
      renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
    }
  });

  renderer.domElement.addEventListener('click', (event) => {
    const hit = pick(event);
    const presence = hit?.userData.presence as Presence | undefined;
    onSelect(presence ? { kind: 'presence', presence } : null);
  });

  // ── state ───────────────────────────────────────────────────────────────────
  let years = 0;
  let filter: Set<string> | null = null;
  let shelfShowing = false;

  function applyTime(): void {
    const low = isLowSea(years);
    if (low !== shelfShowing) {
      shelfShowing = low;
      const material = surface.material as THREE.MeshStandardMaterial;
      material.map = low ? texShelf : texPlain;
      material.needsUpdate = true;
    }

    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i]!;
      const p = dot.userData.presence as Presence;
      const species = atlas.speciesById.get(p.s);
      const alive = species ? speciesAlive(species, years) : false;
      const f = alive ? lifeFraction(p, years) : 0;
      const dimmed = filter && !filter.has(p.s) ? 0.12 : 1;
      const scale = dotScale(p);
      dot.visible = f > 0.01;
      dot.scale.setScalar(scale * (0.55 + 0.45 * f));
      const mat = dot.material as THREE.MeshBasicMaterial;
      mat.opacity = f * dimmed * (p.pop === null ? 0.55 : 0.95);
      mat.transparent = true;
    }

    for (let i = 0; i < routes.length; i++) {
      const mesh = routes[i]!;
      const r = mesh.userData.route as (typeof atlas.routes)[number];
      const species = atlas.speciesById.get(r.s);
      const alive = species ? speciesAlive(species, years) : false;
      const dimmed = filter && !filter.has(r.s) ? 0.1 : 1;
      mesh.visible = alive && years <= r.from && years >= r.to;
      const span = Math.max(1, r.from - r.to);
      const at = (r.from - years) / span;
      const ramp = Math.min(1, Math.min(at, 1 - at) / 0.15);
      (mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, ramp) * 0.7 * dimmed;
    }

    for (let i = 0; i < contacts.length; i++) {
      contacts[i]!.userData.live = years <= (contacts[i]!.userData.contact as Contact).from
        && years >= (contacts[i]!.userData.contact as Contact).to;
    }
  }

  function dotScale(p: Presence): number {
    if (p.pop === null) return 0.0055;
    const t = Math.min(1, Math.max(0, p.pop / 12000));
    return 0.0055 + 0.019 * Math.sqrt(t);
  }

  function resize(): void {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  let raf = 0;
  let t0 = performance.now();

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - t0) / 1000);
    t0 = now;

    if (targetX !== null && targetY !== null) {
      spinX += (targetX - spinX) * 0.08;
      spinY += (targetY - spinY) * 0.08;
      globe.rotation.x = spinX;
      globe.rotation.y = spinY;
      if (Math.abs(targetY - spinY) < 0.002 && Math.abs(targetX - spinX) < 0.002) {
        targetX = null;
        targetY = null;
      }
    } else if (controls.autoRotate) {
      globe.rotation.y += dt * 0.06;
    }

    // The rings pulse so a contact event reads as an event rather than a mark.
    const pulse = (now % 2400) / 2400;
    for (const ring of contacts) {
      const live = ring.userData.live === true;
      ring.visible = live;
      if (!live) continue;
      const s = 1 + pulse * 0.9;
      ring.scale.setScalar(s);
      (ring.material as THREE.MeshBasicMaterial).opacity = (1 - pulse) * 0.9;
    }

    controls.update();
    renderer.render(scene, camera);
  }

  resize();
  applyTime();
  raf = requestAnimationFrame(frame);

  const onResize = () => resize();
  window.addEventListener('resize', onResize);

  return {
    setYears(y: number) {
      years = y;
      applyTime();
    },
    setFilter(ids: Set<string> | null) {
      filter = ids;
      applyTime();
    },
    focusOn(lat: number, lon: number) {
      controls.autoRotate = false;
      const v = ll2v(lat, lon, 1);
      targetY = Math.atan2(-v.x, v.z);
      targetX = (lat * Math.PI) / 180;
      // Take the short way round rather than unwinding the globe.
      while (targetY - spinY > Math.PI) targetY -= Math.PI * 2;
      while (targetY - spinY < -Math.PI) targetY += Math.PI * 2;
    },
    resetView() {
      targetY = 0;
      targetX = 0;
      controls.autoRotate = true;
    },
    resize,
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      texPlain.dispose();
      texShelf.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

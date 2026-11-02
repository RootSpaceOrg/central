import {
  AmbientLight, BoxGeometry, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DirectionalLight, Group, HemisphereLight, IcosahedronGeometry,
  Material, Mesh, MeshLambertMaterial, NearestFilter, Object3D, OrthographicCamera, PCFSoftShadowMap, PlaneGeometry, Raycaster,
  RepeatWrapping, RingGeometry, SRGBColorSpace, Scene, SphereGeometry, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import { CORRIDOR_Y, ELEVATOR, MAP_H, MAP_W, Placement, ROOM, ROOMS, RoomId, route, skinOf } from './office-map';

/** Uma pessoa no andar: quem trabalha senta numa mesa da sala; quem está parado fica na copa. */
export interface Person {
  key: string;
  room: RoomId;
  name: string;
  /** cabelo = cor do agente; camisa = cor do projeto */
  hair: string;
  shirt: string;
  working: boolean;
  /** o que está fazendo (balão) */
  doing: string | null;
  /** projeto, no balão */
  tag: string | null;
  /** passos do plano feitos/total */
  plan: [number, number] | null;
  /** subagentes rodando (estagiários ao lado da mesa) */
  subs: number;
  /** fora do filtro: some na hora (sem andar até o elevador) */
  hidden?: boolean;
}

const WALL_H = 2.4;
/** bonecos um pouco maiores que a escala dos móveis (fica legível de longe) */
const BODY = 1.3;
const SPEED = 2.6; // ladrilhos por segundo
const SUB_SPOTS: [number, number][] = [[1.25, -0.55], [1.35, 0.35], [-0.95, 0.2]]; // estagiários, em relação a quem está sentado
const SUB_HAIR = ['#3b2a20', '#e2c072', '#7a3b2e'];

// ---------- peças ----------

const mats = new Map<string, MeshLambertMaterial>();
const mat = (color: string) => {
  let m = mats.get(color);
  if (!m) mats.set(color, (m = new MeshLambertMaterial({ color })));
  return m;
};
const geoBox = new Map<string, BoxGeometry>();
const boxGeo = (w: number, h: number, d: number) => {
  const k = `${w},${h},${d}`;
  let g = geoBox.get(k);
  if (!g) geoBox.set(k, (g = new BoxGeometry(w, h, d)));
  return g;
};

/** caixa com a base em y (coordenadas do centro em x/z) */
function box(parent: Object3D, w: number, h: number, d: number, color: string | Material, x: number, y: number, z: number, shadow = true): Mesh {
  const m = new Mesh(boxGeo(w, h, d), typeof color === 'string' ? mat(color) : color);
  m.position.set(x, y + h / 2, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function checker(a: string, b: string, w: number, d: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const g = c.getContext('2d')!;
  g.fillStyle = a; g.fillRect(0, 0, 2, 2);
  g.fillStyle = b; g.fillRect(0, 0, 1, 1); g.fillRect(1, 1, 1, 1);
  const t = new CanvasTexture(c);
  t.magFilter = NearestFilter;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(w / 2, d / 2);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** gráfico dos telões da monitoração (rola devagar) */
function graphTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b1514'; g.fillRect(0, 0, 128, 64);
  g.strokeStyle = '#1f3b38'; g.lineWidth = 1;
  for (let y = 8; y < 64; y += 14) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
  g.strokeStyle = '#5FD3B5'; g.lineWidth = 2.5; g.beginPath();
  for (let x = 0; x <= 128; x += 4) g.lineTo(x, 34 + Math.sin(x * 0.19) * 10 + Math.sin(x * 0.05) * 9);
  g.stroke();
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

function plant(parent: Object3D, x: number, z: number): void {
  const pot = new Mesh(new CylinderGeometry(0.17, 0.13, 0.32, 10), mat('#a5683e'));
  pot.position.set(x, 0.16, z); pot.castShadow = true; parent.add(pot);
  const leaves = new Mesh(new IcosahedronGeometry(0.3, 0), new MeshLambertMaterial({ color: '#4fa66a', flatShading: true }));
  leaves.position.set(x, 0.58, z); leaves.castShadow = true; parent.add(leaves);
}

/** texto deitado no chão (lê de frente na vista inicial); userData.w = largura em ladrilhos */
function floorLabel(text: string, color: string): Mesh {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = '800 64px "Segoe UI", system-ui, sans-serif';
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width) + 24;
  c.height = 84;
  g.font = font;
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 12, 44);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  const h = 0.55, w = (c.width / c.height) * h;
  const m = new Mesh(new PlaneGeometry(w, h), new MeshLambertMaterial({ map: t, transparent: true, opacity: 0.75, depthWrite: false, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.25 }));
  m.rotation.x = -Math.PI / 2;
  m.userData['w'] = w;
  return m;
}

// ---------- boneco (voxel) ----------

interface Avatar {
  root: Group;
  legL: Group; legR: Group; armL: Group; armR: Group; head: Mesh;
  shirt: MeshLambertMaterial; hair: MeshLambertMaterial;
}

function limb(w: number, h: number, d: number, m: Material, x: number, pivotY: number): Group {
  const g = new Group();
  g.position.set(x, pivotY, 0);
  const mesh = new Mesh(boxGeo(w, h, d), m);
  mesh.position.y = -h / 2;
  mesh.castShadow = true;
  g.add(mesh);
  return g;
}

/** de frente para +z, pés em y = 0 */
function avatar(hairColor: string, shirtColor: string, skinColor: string): Avatar {
  const root = new Group();
  const shirt = new MeshLambertMaterial({ color: shirtColor });
  const hair = new MeshLambertMaterial({ color: hairColor });
  const skin = mat(skinColor), pants = mat('#2b3242'), dark = mat('#14171d');
  const legL = limb(0.17, 0.45, 0.19, pants, -0.1, 0.45), legR = limb(0.17, 0.45, 0.19, pants, 0.1, 0.45);
  const armL = limb(0.12, 0.4, 0.14, shirt, -0.28, 0.86), armR = limb(0.12, 0.4, 0.14, shirt, 0.28, 0.86);
  const torso = new Mesh(boxGeo(0.44, 0.45, 0.27), shirt);
  torso.position.y = 0.675; torso.castShadow = true;
  const head = new Mesh(boxGeo(0.4, 0.37, 0.36), skin);
  head.position.y = 1.09; head.castShadow = true;
  const top = new Mesh(boxGeo(0.43, 0.12, 0.39), hair); top.position.set(0, 0.24, 0);
  const back = new Mesh(boxGeo(0.43, 0.27, 0.08), hair); back.position.set(0, 0.07, -0.17);
  const eyeL = new Mesh(boxGeo(0.06, 0.07, 0.01), dark); eyeL.position.set(-0.085, 0.01, 0.181);
  const eyeR = new Mesh(boxGeo(0.06, 0.07, 0.01), dark); eyeR.position.set(0.085, 0.01, 0.181);
  head.add(top, back, eyeL, eyeR);
  root.add(legL, legR, armL, armR, torso, head);
  root.scale.setScalar(BODY);
  return { root, legL, legR, armL, armR, head, shirt, hair };
}

// ---------- quem está no andar ----------

interface Actor {
  key: string;
  av: Avatar;
  label: CSS2DObject;
  el: { root: HTMLDivElement; say: HTMLDivElement; nick: HTMLDivElement };
  ring: Mesh;
  pos: Vector2;
  path: Vector2[];
  at: Placement | null;
  working: boolean;
  facing: number;
  /** quando o parado vira para outro lado */
  turnAt: number;
  phase: number;
  leaving: boolean;
  hidden: boolean;
  subs: { av: Avatar; label: CSS2DObject }[];
}

const angleTo = (from: number, to: number) => { let d = (to - from) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

/**
 * O Escritório em 3D (three.js): planta fixa montada uma vez, bonecos voxel que sentam, digitam, andam pelo corredor e
 * viram; nicks e balões em HTML por cima (CSS2D). A câmera gira (arrastar, Q/E ou botões) e as paredes do lado da câmera
 * somem para dar para ver dentro. Desenha a ~30 quadros com gente trabalhando e ~12 parado; nada quando a aba some.
 */
export class OfficeWorld {
  private readonly renderer: WebGLRenderer;
  private readonly labels = new CSS2DRenderer();
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private readonly controls: OrbitControls;
  private readonly floor = new Group();
  private readonly walls: { g: Group; n: Vector3 }[] = [];
  private readonly screens = new Map<string, MeshLambertMaterial>();
  private readonly graphs: CanvasTexture[] = [];
  private readonly stickies = new Group();
  private readonly floors = new Map<RoomId, MeshLambertMaterial>();
  private readonly actors = new Map<string, Actor>();
  private readonly ray = new Raycaster();
  private readonly ro: ResizeObserver;
  private raf = 0;
  private last = 0;
  private drawn = 0;
  private first = true;
  private spin = 0;
  private home: Vector3;
  private down: { x: number; y: number } | null = null;
  private selected: string | null = null;
  private interacting = false;
  /** até quando continuar desenhando a cada quadro (zoom pela roda, fim do arraste) */
  private moving = 0;
  /** medição (depuração): quadros desenhados, ms gastos, chamadas de desenho */
  readonly stats = { frames: 0, ms: 0, calls: 0 };

  constructor(private readonly host: HTMLElement, private readonly on: { pick: (key: string | null) => void; open: (key: string) => void }) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    host.appendChild(this.labels.domElement);

    this.scene.add(new HemisphereLight('#dfe8ff', '#3a3328', 1.5), new AmbientLight('#ffffff', 0.35));
    const sun = new DirectionalLight('#fff3e0', 2.1);
    sun.position.set(9, 16, 11);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 50 });
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);

    this.floor.position.set(-MAP_W / 2, 0, -MAP_H / 2);
    this.scene.add(this.floor);
    this.build();
    for (const g of [this.floor, ...this.walls.map(w => w.g)]) merge(g);

    this.home = new Vector3(18, 17, 20);
    this.camera.position.copy(this.home);
    this.camera.zoom = 1;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, minZoom: 0.6, maxZoom: 3.2, minPolarAngle: 0.25, maxPolarAngle: 1.3, screenSpacePanning: true });
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    // mexendo na câmera (arrastar, roda, amortecimento): desenha em todo quadro
    this.controls.addEventListener('start', () => { this.interacting = true; });
    this.controls.addEventListener('end', () => { this.interacting = false; this.moving = performance.now() + 600; });
    this.controls.addEventListener('change', () => { this.moving = performance.now() + 300; });

    const el = this.renderer.domElement;
    el.style.display = 'block';
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', e => { this.down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', e => {
      if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 5) this.on.pick(this.hit(e));
      this.down = null;
    });
    el.addEventListener('dblclick', e => { const k = this.hit(e); if (k) this.on.open(k); });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.raf = requestAnimationFrame(t => this.loop(t));
  }

  // ---------- planta ----------

  private build(): void {
    const f = this.floor;
    const slab = (x: number, z: number, w: number, d: number, a: string, b: string) => {
      const material = new MeshLambertMaterial({ map: checker(a, b, w, d) });
      const m = new Mesh(boxGeo(w, 0.1, d), material);
      m.position.set(x + w / 2, -0.05, z + d / 2);
      m.receiveShadow = true;
      f.add(m);
      return material;
    };
    for (const r of ROOMS) {
      this.floors.set(r.id, slab(r.x, r.y, r.w, r.d, r.floor[0], r.floor[1]));
      // nome pintado no chão, perto da porta (como sinalização de piso)
      const label = floorLabel(r.label.toUpperCase(), r.accent);
      label.position.set(r.x + 0.35 + label.userData['w'] / 2, 0.006, r.y + r.d - 0.55);
      f.add(label);
    }
    slab(0, 6, MAP_W, 2, '#2c313c', '#272c36');

    // paredes externas: cada lado é um grupo que some quando a câmera está do lado de fora dele
    const side = (n: Vector3) => { const g = new Group(); f.add(g); this.walls.push({ g, n }); return g; };
    const north = side(new Vector3(0, 0, 1)), south = side(new Vector3(0, 0, -1)), west = side(new Vector3(1, 0, 0)), east = side(new Vector3(-1, 0, 0));
    const tone = (hex: string, k: number) => `#${new Color(hex).multiplyScalar(k).getHexString()}`;
    for (const r of ROOMS) {
      if (r.y === 0) box(north, r.w, WALL_H, 0.12, tone(r.wall, 1.15), r.x + r.w / 2, 0, -0.06);
      else box(south, r.w, WALL_H, 0.12, tone(r.wall, 1.15), r.x + r.w / 2, 0, MAP_H + 0.06);
    }
    for (const [z0, z1, color] of [[0, 6, ROOM.get('gestao')!.wall], [6, 8, '#3a404d'], [8, 14, ROOM.get('copa')!.wall]] as [number, number, string][])
      box(west, 0.12, WALL_H, z1 - z0, tone(color, 0.95), -0.06, 0, (z0 + z1) / 2);
    for (const [z0, z1, color] of [[0, 6, ROOM.get('monitor')!.wall], [6, 8, '#3a404d'], [8, 14, ROOM.get('business')!.wall]] as [number, number, string][])
      box(east, 0.12, WALL_H, z1 - z0, tone(color, 0.95), MAP_W + 0.06, 0, (z0 + z1) / 2);

    // elevador (de onde chega quem não estava na copa)
    box(west, 0.04, 1.9, 1.4, '#7c8494', 0.02, 0, CORRIDOR_Y);
    box(west, 0.05, 1.9, 0.03, '#2b303a', 0.03, 0, CORRIDOR_Y);
    box(west, 0.05, 0.12, 0.3, '#E8C46A', 0.03, 2.0, CORRIDOR_Y);
    // gestão: quadro branco com um post-it por marco em Agora
    box(north, 4.2, 1.1, 0.04, '#eceae2', 3.4, 0.95, 0.02);
    this.stickies.position.set(0, 0, 0.05);
    north.add(this.stickies);
    // engenharia: janelas
    for (const x of [9.6, 13.4]) box(north, 1.8, 1.0, 0.03, new MeshLambertMaterial({ color: '#9fc3ff', emissive: '#4a6aa8', emissiveIntensity: 0.6 }), x, 1.0, 0.02, false);
    // monitoração: telões
    for (const x of [18.7, 21.3]) {
      const t = graphTexture();
      this.graphs.push(t);
      box(north, 2.2, 1.2, 0.08, '#1d2129', x, 0.95, 0.04);
      const s = new Mesh(new PlaneGeometry(2.05, 1.05), new MeshLambertMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.9 }));
      s.position.set(x, 1.55, 0.09);
      north.add(s);
    }
    // criativo: quadro de cortiça; negócios: quadro com gráfico de barras
    box(south, 2.6, 1.0, 0.04, '#b98d5b', 10.5, 1.0, MAP_H - 0.02);
    box(south, 2.2, 1.0, 0.04, '#e9eee9', 19.5, 1.0, MAP_H - 0.02);
    [0.3, 0.5, 0.42, 0.7].forEach((h, i) => box(south, 0.3, h, 0.03, '#7ED69A', 18.8 + i * 0.45, 1.12, MAP_H - 0.05));

    // vidro: divisórias e muretas com porta
    const glass = new MeshLambertMaterial({ color: '#cfe3ff', transparent: true, opacity: 0.13, depthWrite: false });
    const frame = '#5b6475';
    const pane = (x0: number, z0: number, x1: number, z1: number, h: number) => {
      const along = x1 !== x0, len = along ? x1 - x0 : z1 - z0;
      box(f, along ? len : 0.05, h, along ? 0.05 : len, glass, (x0 + x1) / 2, 0, (z0 + z1) / 2, false);
      box(f, along ? len : 0.07, 0.05, along ? 0.07 : len, frame, (x0 + x1) / 2, h, (z0 + z1) / 2, false);
    };
    for (const x of [7, 17]) pane(x, 0, x, 6, 1.5);
    for (const x of [7, 16]) pane(x, 8, x, 14, 1.5);
    for (const r of ROOMS) {
      const z = r.y === 0 ? 6 : 8;
      pane(r.x, z, r.door, z, 0.9);
      pane(r.door + 1.2, z, r.x + r.w, z, 0.9);
    }

    // mesas: tampo, monitor (a tela acende com alguém trabalhando), teclado, cadeira
    for (const r of ROOMS) r.desks.forEach(([x, z], i) => {
      box(f, 2, 0.06, 0.9, '#c9a77a', x + 1, 0.7, z + 0.45);
      box(f, 0.06, 0.7, 0.85, '#8f7350', x + 0.06, 0, z + 0.45);
      box(f, 0.06, 0.7, 0.85, '#8f7350', x + 1.94, 0, z + 0.45);
      box(f, 0.08, 0.22, 0.08, '#2b2f38', x + 1, 0.76, z + 0.22);
      box(f, 0.95, 0.56, 0.06, '#22262e', x + 1, 0.95, z + 0.2);
      const screen = new MeshLambertMaterial({ color: '#141a24', emissive: '#000000' });
      this.screens.set(`${r.id}:${i}`, screen);
      const s = new Mesh(new PlaneGeometry(0.86, 0.47), screen);
      s.position.set(x + 1, 1.23, z + 0.235);
      f.add(s);
      box(f, 0.62, 0.025, 0.18, '#3a3f4b', x + 1, 0.76, z + 0.62);
      const cz = z + 1.55;
      box(f, 0.05, 0.52, 0.05, '#22262e', x + 1, 0, cz);
      box(f, 0.55, 0.07, 0.55, '#3a3f4b', x + 1, 0.52, cz);
      box(f, 0.55, 0.4, 0.06, '#3a3f4b', x + 1, 0.59, cz + 0.29);
    });

    // móveis por sala
    box(f, 1.7, 0.05, 1.0, '#e0d2b0', 4.2, 0.62, 4.3); // gestão: mesa de reunião
    box(f, 0.1, 0.62, 0.1, '#8f8064', 4.2, 0, 4.3);
    box(f, 0.8, 2.0, 1.2, '#2a2f38', 23.4, 0, 1.6); // monitoração: rack
    for (let i = 0; i < 6; i++) box(f, 0.02, 0.05, 0.05, i % 2 ? '#5FD3B5' : '#E8C46A', 22.99, 0.3 + i * 0.28, 1.3 + (i % 3) * 0.2, false);
    box(f, 0.9, 0.95, 3, '#b9b2a5', 0.5, 0, 10.1); // copa: balcão
    box(f, 0.45, 0.45, 0.4, '#2b2f38', 0.5, 0.95, 9.3); // cafeteira
    box(f, 0.25, 0.2, 0.25, '#e9e4d8', 0.5, 0.95, 10.4);
    box(f, 0.8, 1.9, 0.8, '#d8dde6', 0.5, 0, 12.6); // geladeira
    box(f, 2.6, 0.38, 0.85, '#c0705a', 3.3, 0, 13.4); // sofá
    box(f, 2.6, 0.5, 0.22, '#9a5847', 3.3, 0.3, 13.8);
    const table = new Mesh(new CylinderGeometry(0.5, 0.5, 0.05, 20), mat('#d9c49c'));
    table.position.set(3.5, 0.72, 10.7); table.castShadow = true; f.add(table);
    box(f, 0.08, 0.72, 0.08, '#8d7b58', 3.5, 0, 10.7);
    box(f, 0.08, 1.4, 0.8, '#f2efe6', 14.7, 0, 9.5); // criativo: cavalete
    const puff = new Mesh(new SphereGeometry(0.32, 14, 10), mat('#ff8fb1'));
    puff.scale.y = 0.6; puff.position.set(15.2, 0.2, 11.4); puff.castShadow = true; f.add(puff);
    box(f, 0.6, 2.0, 2.4, '#6b4b33', 23.55, 0, 10.2); // negócios: estante
    ['#E8C46A', '#7FA2FF', '#c0705a', '#7ED69A'].forEach((c, i) => box(f, 0.4, 0.32, 0.5, c, 23.4, 0.35 + i * 0.42, 9.6 + (i % 2) * 1.1));
    for (const [x, z] of [[6.5, 0.5], [16.5, 0.5], [6.4, 13.4], [23.4, 6.5], [15.5, 13.5], [9.2, 6.4], [14.5, 6.4], [6.5, 5.4]]) plant(f, x, z);
  }

  // ---------- pessoas ----------

  sync(people: Person[], placed: Map<string, Placement>, selected: string | null, milestones: string[]): void {
    this.selected = selected;
    const seen = new Set<string>();
    for (const p of people) {
      const to = placed.get(p.key);
      if (!to) continue;
      seen.add(p.key);
      let a = this.actors.get(p.key);
      if (!a) {
        a = this.spawn(p);
        if (this.first) a.pos.set(to.x, to.y);
        else { a.pos.set(ELEVATOR[0], ELEVATOR[1]); a.path = route(null, to).slice(1).map(([x, y]) => new Vector2(x, y)); }
      } else if (a.leaving || !a.at || a.at.seat !== to.seat) {
        a.path = route(a.leaving ? null : a.at, to).slice(1).map(([x, y]) => new Vector2(x, y));
        a.leaving = false;
      }
      a.at = to;
      a.working = p.working;
      a.hidden = !!p.hidden;
      a.av.root.visible = !a.hidden;
      a.av.shirt.color.set(p.shirt);
      a.av.hair.color.set(p.hair);
      (a.ring.material as MeshLambertMaterial).color.set(p.hair);
      a.ring.visible = p.key === selected;
      this.text(a, p);
      this.setSubs(a, p.working && to.seated ? Math.min(p.subs, 3) : 0);
    }
    // quem saiu vai embora pelo elevador
    for (const a of this.actors.values()) {
      if (seen.has(a.key) || a.leaving) continue;
      a.leaving = true;
      a.working = false;
      this.setSubs(a, 0);
      const r = a.at ? ROOM.get(a.at.room)! : null;
      const door = r ? [new Vector2(r.door + 0.5, r.y === 0 ? 5.4 : 8.6), new Vector2(r.door + 0.5, CORRIDOR_Y)] : [];
      a.path = [...door, new Vector2(ELEVATOR[0], ELEVATOR[1])];
      a.el.say.hidden = true;
    }
    // monitores acesos
    const lit = new Set([...this.actors.values()].filter(a => a.working && !a.leaving && !a.hidden && a.at?.seated).map(a => a.at!.seat));
    for (const [seat, m] of this.screens) m.emissive.set(lit.has(seat) ? '#6f95e6' : '#000000');
    this.setStickies(milestones);
    this.first = false;
  }

  private spawn(p: Person): Actor {
    const av = avatar(p.hair, p.shirt, skinOf(p.key));
    av.root.userData['key'] = p.key;
    const ring = new Mesh(new RingGeometry(0.36, 0.46, 28), new MeshLambertMaterial({ color: p.hair }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    av.root.add(ring);
    const root = document.createElement('div');
    root.className = 'o3-label';
    const say = document.createElement('div');
    say.className = 'o3-say';
    const nick = document.createElement('div');
    nick.className = 'o3-nick';
    root.append(say, nick);
    root.addEventListener('click', () => this.on.pick(p.key));
    root.addEventListener('dblclick', () => this.on.open(p.key));
    const label = new CSS2DObject(root);
    label.center.set(0.5, 1);
    label.position.set(0, 1.5, 0);
    av.root.add(label);
    this.floor.add(av.root);
    const a: Actor = {
      key: p.key, av, label, el: { root, say, nick }, ring, pos: new Vector2(), path: [], at: null, working: p.working,
      facing: Math.random() * Math.PI * 2, turnAt: 0, phase: Math.random() * 10, leaving: false, hidden: false, subs: [],
    };
    this.actors.set(p.key, a);
    return a;
  }

  private text(a: Actor, p: Person): void {
    a.el.root.style.setProperty('--c', p.hair);
    a.el.root.classList.toggle('sel', p.key === this.selected);
    a.el.root.classList.toggle('idle', !p.working);
    const nick = `${p.name}${p.working ? '' : ' · zz'}`;
    if (a.el.nick.textContent !== nick) a.el.nick.textContent = nick;
    a.el.say.hidden = !p.working;
    if (p.working) {
      const line = `${p.doing ?? 'pensando…'}${p.plan ? `  ${p.plan[0]}/${p.plan[1]}` : ''}`;
      const html = `${p.tag ? `<small>${esc(p.tag)}</small>` : ''}${esc(line)}`;
      if (a.el.say.innerHTML !== html) a.el.say.innerHTML = html;
    }
  }

  private setSubs(a: Actor, n: number): void {
    while (a.subs.length > n) {
      const s = a.subs.pop()!;
      s.label.element.remove();
      this.floor.remove(s.av.root);
      s.av.shirt.dispose(); s.av.hair.dispose();
    }
    while (a.subs.length < n) {
      const i = a.subs.length;
      const av = avatar(SUB_HAIR[i], '#9b7bff', skinOf(`sub${i}${a.key}`));
      av.root.scale.setScalar(BODY * 0.72);
      const el = document.createElement('div');
      el.className = 'o3-nick o3-sub';
      el.textContent = 'estagiário';
      const label = new CSS2DObject(el);
      label.center.set(0.5, 1);
      label.position.set(0, 1.55, 0);
      av.root.add(label);
      this.floor.add(av.root);
      a.subs.push({ av, label });
    }
  }

  private setStickies(colors: string[]): void {
    const key = colors.join();
    if (this.stickies.userData['key'] === key) return;
    this.stickies.userData['key'] = key;
    this.stickies.clear();
    colors.slice(0, 12).forEach((c, i) => box(this.stickies, 0.42, 0.36, 0.02, c, 1.75 + (i % 6) * 0.66, i < 6 ? 1.52 : 1.06, 0, false));
  }

  /** acende o piso de uma sala (legenda); null apaga */
  highlight(room: RoomId | null): void {
    for (const [id, m] of this.floors) {
      m.emissive.set(id === room ? ROOM.get(id)!.accent : '#000000');
      m.emissiveIntensity = id === room ? 0.22 : 0;
    }
    this.moving = performance.now() + 200;
  }

  // ---------- câmera ----------

  /** gira a vista em 90° (sentido: 1 ou -1) */
  rotate(dir: 1 | -1): void { this.spin += (dir * Math.PI) / 2; }

  reset(): void {
    this.spin = 0;
    this.camera.position.copy(this.home);
    this.camera.zoom = 1;
    this.controls.target.set(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private resize(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    const view = 17, aspect = w / h;
    Object.assign(this.camera, { left: (-view * aspect) / 2, right: (view * aspect) / 2, top: view / 2, bottom: -view / 2 });
    this.camera.updateProjectionMatrix();
    this.drawn = 0;
  }

  private hit(e: MouseEvent): string | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const roots = [...this.actors.values()].map(a => a.av.root);
    for (const h of this.ray.intersectObjects(roots, true)) {
      let o: Object3D | null = h.object;
      while (o && !o.userData['key']) o = o.parent;
      if (o) return o.userData['key'] as string;
    }
    return null;
  }

  // ---------- quadro a quadro ----------

  private loop(t: number): void {
    this.raf = requestAnimationFrame(x => this.loop(x));
    // câmera mexendo ou alguém andando: todo quadro (fica liso em monitor de 144/240 Hz);
    // só gente digitando: 60; só a copa respirando: 30
    const actors = [...this.actors.values()];
    const live = this.interacting || this.spin !== 0 || t < this.moving || actors.some(a => a.path.length);
    const gap = live ? 0 : actors.some(a => a.working) ? 15 : 32;
    if (t - this.drawn < gap) return;
    const dt = Math.min(0.1, (t - (this.last || t)) / 1000);
    this.last = t;
    this.drawn = t;
    const s = t / 1000;

    if (this.spin) {
      const step = Math.sign(this.spin) * Math.min(Math.abs(this.spin), dt * 3.2);
      this.spin -= step;
      if (Math.abs(this.spin) < 1e-4) this.spin = 0;
      this.camera.position.sub(this.controls.target).applyAxisAngle(new Vector3(0, 1, 0), step).add(this.controls.target);
    }
    this.controls.update();

    for (const a of [...this.actors.values()]) this.animate(a, dt, s);

    // paredes do lado da câmera somem
    const dir = this.camera.position.clone().sub(this.controls.target).setY(0).normalize();
    for (const w of this.walls) w.g.visible = dir.dot(w.n) > -0.2;
    for (const g of this.graphs) g.offset.x = (g.offset.x + dt * 0.06) % 1;

    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    this.stats.frames++; this.stats.ms += performance.now() - t0; this.stats.calls = this.renderer.info.render.calls;
  }

  private animate(a: Actor, dt: number, s: number): void {
    const { av } = a;
    let walking = false;
    if (a.path.length) {
      walking = true;
      const target = a.path[0];
      const d = target.clone().sub(a.pos);
      const len = d.length();
      const step = SPEED * dt;
      if (len <= step) { a.pos.copy(target); a.path.shift(); }
      else a.pos.add(d.multiplyScalar(step / len));
      if (len > 0.01) a.facing = Math.atan2(target.x - a.pos.x, target.y - a.pos.y);
      if (!a.path.length && a.leaving) { this.remove(a); return; }
    } else if (a.at?.seated) {
      a.facing = Math.PI; // de frente para o monitor
    } else if (s > a.turnAt) {
      // parado em pé: vira de vez em quando (conversa na copa)
      a.facing = Math.random() * Math.PI * 2;
      a.turnAt = s + 3 + Math.random() * 6;
    }
    av.root.position.set(a.pos.x, 0, a.pos.y);
    av.root.rotation.y += angleTo(av.root.rotation.y, a.facing) * Math.min(1, dt * 8);

    const seated = !walking && !!a.at?.seated;
    const ph = s * 9 + a.phase;
    if (walking) {
      const sw = Math.sin(ph) * 0.65;
      av.legL.rotation.x = sw; av.legR.rotation.x = -sw;
      av.armL.rotation.x = -sw * 0.8; av.armR.rotation.x = sw * 0.8;
      av.root.position.y = Math.abs(Math.cos(ph)) * 0.05;
    } else if (seated) {
      av.legL.rotation.x = av.legR.rotation.x = -Math.PI / 2;
      const typing = a.working ? Math.sin(s * 16 + a.phase) * 0.12 : 0;
      av.armL.rotation.x = -1.15 + typing; av.armR.rotation.x = -1.15 - typing;
      av.head.rotation.x = a.working ? Math.sin(s * 1.3 + a.phase) * 0.05 : 0;
    } else {
      av.legL.rotation.x = av.legR.rotation.x = 0;
      av.armL.rotation.x = Math.sin(s * 1.6 + a.phase) * 0.06; av.armR.rotation.x = -av.armL.rotation.x;
      av.head.rotation.x = 0;
      av.root.position.y = 0;
    }
    a.label.visible = !a.hidden;
    a.el.say.style.visibility = walking ? 'hidden' : '';

    // estagiários em pé ao lado da mesa, virados para quem está sentado
    a.subs.forEach((sub, i) => {
      const [dx, dz] = SUB_SPOTS[i];
      sub.av.root.visible = sub.label.visible = seated && !a.hidden;
      sub.av.root.position.set(a.pos.x + dx, 0, a.pos.y + dz);
      sub.av.root.rotation.y = Math.atan2(-dx, -dz);
      sub.av.armL.rotation.x = Math.sin(s * 2 + i) * 0.1;
    });
  }

  private remove(a: Actor): void {
    this.setSubs(a, 0);
    a.av.shirt.dispose(); a.av.hair.dispose();
    a.el.root.remove();
    this.floor.remove(a.av.root);
    this.actors.delete(a.key);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    for (const a of [...this.actors.values()]) this.remove(a);
    this.scene.traverse(o => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        for (const m of [o.material].flat()) { (m as MeshLambertMaterial).map?.dispose(); m.dispose(); }
      }
    });
    geoBox.clear();
    mats.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}

/**
 * Junta a mobília parada por material: centenas de caixas viram poucas chamadas de desenho (a sombra também agradece).
 * Só filhos diretos que são Mesh e compartilham material; telas (material próprio) e grupos ficam como estão.
 */
function merge(parent: Object3D): void {
  const groups = new Map<Material, Mesh[]>();
  for (const o of parent.children) {
    if (!(o instanceof Mesh) || Array.isArray(o.material)) continue;
    const list = groups.get(o.material) ?? [];
    list.push(o);
    groups.set(o.material, list);
  }
  for (const [material, meshes] of groups) {
    if (meshes.length < 2) continue;
    const geos: BufferGeometry[] = meshes.map(m => {
      m.updateMatrix();
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      return g;
    });
    const merged = mergeGeometries(geos);
    geos.forEach(g => g.dispose());
    if (!merged) continue;
    const mesh = new Mesh(merged, material);
    mesh.castShadow = meshes.some(m => m.castShadow);
    mesh.receiveShadow = true;
    mesh.renderOrder = meshes[0].renderOrder;
    for (const m of meshes) parent.remove(m);
    parent.add(mesh);
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

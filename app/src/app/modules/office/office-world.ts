import {
  ACESFilmicToneMapping, AmbientLight, BoxGeometry, BufferGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DirectionalLight, Group, HemisphereLight, IcosahedronGeometry,
  Material, Mesh, MeshLambertMaterial, NearestFilter, Object3D, OrthographicCamera, PCFSoftShadowMap, PlaneGeometry, Raycaster,
  RepeatWrapping, RingGeometry, SRGBColorSpace, Scene, SphereGeometry, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import { boxGeo, clearAvatarCaches, mat } from '../../shared/ui/avatar3d';
import { CHARACTERS, Character, Kit, Prop, fitBox, loadKit } from './office-assets';
import type { AvatarLook } from '../../shared/ui/avatar-look';
import { BOARD_SPOT, CORRIDOR_Y, ELEVATOR, MAP_H, MAP_W, Placement, ROOM, ROOMS, RoomId, TASK_BOARD, route, skinOf } from './office-map';

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
  /** acabou uma tarefa há pouco: continua na mesa (não vai para a copa e volta) */
  between?: boolean;
  /** aparência escolhida no editor do agente (sem = boneco padrão) */
  look?: AvatarLook;
  /** qual personagem (índice em CHARACTERS); sem = escolhido pela chave */
  model?: number;
}

/** Um agente avisou outro (notify_agent): quem recebe vai até a mesa de quem avisou, os dois conversam e cada um volta. */
export interface Talk { id: number; from: string; to: string; text: string; reply: string }

const WALL_H = 2.4;
const TALK_S = 8; // segundos de conversa depois que chega
const SPEED = 2.6; // ladrilhos por segundo
const SUB_SPOTS: [number, number][] = [[1.25, -0.55], [1.35, 0.35], [-0.95, 0.2]]; // estagiários, em relação a quem está sentado
/** sentado: altura e recuo do corpo para cair no assento da cadeira (ajuste fino da animação 'sit') */
const SEAT_Y = 0.22;
const SEAT_BACK = 0.12;

// ---------- peças ----------

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

// ---------- quem está no andar ----------

interface Actor {
  key: string;
  ch: Character;
  /** disco no chão na cor do projeto */
  base: Mesh;
  label: CSS2DObject;
  el: { root: HTMLDivElement; say: HTMLDivElement; nick: HTMLDivElement };
  ring: Mesh;
  pos: Vector2;
  path: Vector2[];
  at: Placement | null;
  working: boolean;
  facing: number;
  /** look atual (mudou no editor: troca o boneco no lugar) */
  lookKey: string;
  /** quando o parado vira para outro lado */
  turnAt: number;
  phase: number;
  leaving: boolean;
  hidden: boolean;
  subs: { ch: Character; label: CSS2DObject }[];
  name: string;
  /** numa conversa: não sai do lugar até acabar; next = para onde vai depois */
  hold: number;
  next: Placement | null;
  /** o que fala no balão durante a conversa */
  saying: string | null;
  /** parada no quadro de tarefas (chegou nesse ponto: espera até waitUntil) */
  pauseAt: Vector2 | null;
  waitUntil: number;
  /** indo conversar: com quem, e o que cada um diz ao chegar */
  visit: { with: string; text: string; reply: string } | null;
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
  /** modelos 3D (chegam depois de montar a planta); até lá, o sync fica guardado */
  private kit: Kit | null = null;
  private pending: Parameters<OfficeWorld['sync']> | null = null;
  private dead = false;
  /** medição (depuração): quadros desenhados, ms gastos, chamadas de desenho */
  readonly stats = { frames: 0, ms: 0, calls: 0 };

  constructor(private readonly host: HTMLElement, private readonly on: { pick: (key: string | null) => void; open: (key: string) => void }) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    host.appendChild(this.renderer.domElement);
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    host.appendChild(this.labels.domElement);

    this.scene.add(new HemisphereLight('#e6eeff', '#4a3f33', 1.6), new AmbientLight('#ffffff', 0.45));
    const sun = new DirectionalLight('#fff1dc', 2.6);
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
    // móveis e pessoas de verdade (modelos 3D): chegam em seguida
    loadKit().then(kit => {
      if (this.dead) return;
      this.kit = kit;
      this.furnish(kit);
      if (this.pending) { const p = this.pending; this.pending = null; this.sync(...p); }
      this.moving = performance.now() + 500;
    }, e => console.error('escritório: modelos 3D', e));

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
    // corredor: quadro de tarefas (colunas com post-its), onde quem começa uma tarefa passa
    box(f, 2.4, 1.25, 0.06, '#eceae2', TASK_BOARD[0], 0.85, TASK_BOARD[1]);
    box(f, 2.5, 0.06, 0.1, '#5b6475', TASK_BOARD[0], 2.1, TASK_BOARD[1]);
    for (let c = 0; c < 3; c++) {
      box(f, 0.03, 1.1, 0.07, '#c9c4b8', TASK_BOARD[0] - 0.4 + c * 0.8, 0.92, TASK_BOARD[1] + 0.01, false);
      for (let r = 0; r < 3 - c % 2; r++) box(f, 0.28, 0.22, 0.03, ['#E8C46A', '#7FA2FF', '#7ED69A'][c], TASK_BOARD[0] - 0.8 + c * 0.8, 1.6 - r * 0.32, TASK_BOARD[1] + 0.05, false);
    }
    box(f, 0.08, 0.85, 0.08, '#5b6475', TASK_BOARD[0] - 1.1, 0, TASK_BOARD[1]);
    box(f, 0.08, 0.85, 0.08, '#5b6475', TASK_BOARD[0] + 1.1, 0, TASK_BOARD[1]);
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

  }

  /** Mobília com modelos 3D: mesas com monitor/teclado/cadeira, copa, estantes, plantas. A tela do monitor acende com alguém trabalhando. */
  private furnish(kit: Kit): void {
    const f = this.floor;
    /** móvel nas medidas (l, a, p) em ladrilhos, girado em rot, sobre y */
    const put = (name: Prop, l: number, h: number, p: number, x: number, z: number, rot = 0, y = 0, tint: Record<string, string> = {}) => {
      const g = fitBox(kit.prop(name), l, h, p, tint);
      g.position.set(x, y, z);
      g.rotation.y = rot;
      f.add(g);
      return g;
    };
    const DESK = { wood: '#c8a77c', woodDark: '#8a6a48', metal: '#3a3f4b' };
    const CHAIR = { metal: '#2b2f38', metalMedium: '#2b2f38', carpet: '#465267', carpetBlue: '#465267', wood: '#3a3f4b' };
    const SCREEN = { metal: '#262a33', metalDark: '#1b1e25' };
    const SOFA = { carpet: '#4f6f8f', carpetBlue: '#4f6f8f', wood: '#3a3028' };
    const RUG = { carpet: '#6a5546', carpetDarker: '#5b4839' };
    for (const r of ROOMS) r.desks.forEach(([x, z], i) => {
      put('desk', 2, 0.74, 0.9, x + 1, z + 0.45, Math.PI, 0, DESK);
      put('computerScreen', 0.95, 0.6, 0, x + 1, z + 0.22, Math.PI, 0.74, SCREEN);
      put('computerKeyboard', 0.6, 0.04, 0.2, x + 1, z + 0.62, Math.PI, 0.74);
      put('computerMouse', 0.09, 0.04, 0.14, x + 1.45, z + 0.62, Math.PI, 0.74);
      put('chairDesk', 0.62, 1.05, 0.62, x + 1, z + 1.62, 0, 0, CHAIR);
      // tela do monitor: acende quando alguém trabalha nessa mesa
      const screen = new MeshLambertMaterial({ color: '#0e131c', emissive: '#000000' });
      this.screens.set(`${r.id}:${i}`, screen);
      const sc = new Mesh(new PlaneGeometry(0.84, 0.46), screen);
      sc.position.set(x + 1, 1.07, z + 0.27);
      f.add(sc);
      if (i % 2 === 0) put(i % 4 === 0 ? 'plantSmall1' : 'plantSmall3', 0, 0.32, 0, x + 0.3, z + 0.3, 0, 0.74);
      else put('books', 0.32, 0.18, 0, x + 1.7, z + 0.3, Math.PI, 0.74);
    });

    // gestão: mesa de reunião com cadeiras e estante
    put('table', 1.9, 0.72, 1.0, 4.3, 4.6, 0, 0, DESK);
    for (const [dx, dz, rt] of [[-0.55, -0.75, 0], [0.55, -0.75, 0], [-0.55, 0.75, Math.PI], [0.55, 0.75, Math.PI]] as [number, number, number][])
      put('chairModernCushion', 0.48, 0.85, 0.48, 4.3 + dx, 4.6 + dz, rt, 0, CHAIR);
    put('bookcaseClosedWide', 1.4, 1.6, 0.45, 0.35, 4.6, Math.PI / 2);
    // engenharia: estante e luminária
    put('bookcaseOpen', 0.9, 1.7, 0.4, 16.7, 2.3, -Math.PI / 2);
    put('lampRoundFloor', 0, 1.6, 0, 16.5, 4.8);
    // monitoração: rack de servidores e caixa de som
    box(f, 0.8, 2.0, 1.2, '#232833', 23.4, 0, 1.6);
    for (let i = 0; i < 8; i++) box(f, 0.02, 0.05, 0.05, i % 2 ? '#5FD3B5' : '#E8C46A', 22.99, 0.3 + i * 0.22, 1.3 + (i % 3) * 0.2, false);
    put('speaker', 0, 0.9, 0, 23.5, 3.2, -Math.PI / 2);
    // copa: balcão com cafeteira e micro-ondas, geladeira, sofás, mesinha, banquetas, TV
    put('kitchenBar', 2.8, 0.95, 0.8, 0.45, 10.3, Math.PI / 2);
    put('kitchenCoffeeMachine', 0, 0.42, 0, 0.45, 9.4, Math.PI / 2, 0.95);
    put('kitchenMicrowave', 0, 0.32, 0, 0.45, 10.9, Math.PI / 2, 0.95);
    put('kitchenFridgeLarge', 0.9, 1.95, 0.75, 0.45, 12.75, Math.PI / 2);
    put('loungeSofaCorner', 1.9, 0.8, 1.9, 2.4, 12.95, Math.PI, 0, SOFA);
    put('loungeSofa', 2.0, 0.8, 0.9, 4.9, 13.45, Math.PI, 0, SOFA);
    put('rugRound', 2.6, 0.02, 2.6, 4.1, 12.2, 0, 0, RUG);
    put('tableCoffee', 1.1, 0.4, 0.6, 4.1, 12.3);
    put('tableRound', 1.0, 0.75, 1.0, 3.5, 10.3, 0, 0, DESK);
    for (const [dx, dz] of [[-0.8, 0], [0.8, 0], [0, -0.8]]) put('stoolBar', 0, 0.75, 0, 3.5 + dx, 10.3 + dz, 0, 0, CHAIR);
    put('loungeDesignChair', 0.9, 0.85, 0.9, 6.2, 10.6, -Math.PI / 2, 0, SOFA);
    put('televisionModern', 1.5, 0.95, 0, 6.85, 12.1, -Math.PI / 2, 0.6);
    put('trashcan', 0, 0.45, 0, 1.3, 13.5);
    // estúdio criativo: cavalete, poltrona com tapete, caixas
    box(f, 0.08, 1.4, 0.8, '#f2efe6', 14.7, 0, 9.5);
    put('rugRectangle', 2.2, 0.02, 1.5, 15.0, 11.6, Math.PI / 2, 0, { carpet: '#7a5a8f', carpetDarker: '#664a78' });
    put('loungeChair', 0.9, 0.85, 0.9, 15.0, 11.6, -Math.PI / 2, 0, { carpet: '#c98a5a', wood: '#3a3028' });
    put('cardboardBoxClosed', 0, 0.45, 0, 15.5, 13.4, 0.3);
    // negócios: estante e mesa lateral
    put('bookcaseClosedWide', 2.2, 1.8, 0.5, 23.65, 10.2, -Math.PI / 2);
    put('sideTable', 0, 0.55, 0, 23.4, 12.6);
    // plantas pelo andar
    for (const [x, z, k] of [[6.5, 0.5, 0], [16.5, 0.5, 1], [6.4, 13.4, 0], [23.4, 6.5, 1], [15.5, 13.5, 0], [9.2, 6.4, 1], [14.5, 6.4, 0], [6.5, 5.4, 1], [0.6, 6.5, 0], [17.4, 13.4, 1]] as [number, number, number][])
      put(k ? 'plantSmall2' : 'pottedPlant', 0, k ? 0.7 : 1.1, 0, x, z, (x * 7) % 3);
  }

  // ---------- pessoas ----------

  sync(people: Person[], placed: Map<string, Placement>, selected: string | null, milestones: string[]): void {
    if (!this.kit) { this.pending = [people, placed, selected, milestones]; return; }
    this.selected = selected;
    const seen = new Set<string>();
    for (const p of people) {
      const to = placed.get(p.key);
      if (!to) continue;
      seen.add(p.key);
      let a = this.actors.get(p.key);
      // começou uma tarefa vindo de fora da sala (copa, elevador): passa no quadro de tarefas antes de sentar
      const starting = p.working && to.seated && (!a || !a.working);
      if (!a) {
        a = this.spawn(p);
        if (this.first) a.pos.set(to.x, to.y);
        else { a.pos.set(ELEVATOR[0], ELEVATOR[1]); a.path = this.viaBoard(a, route(null, to).slice(1).map(([x, y]) => new Vector2(x, y)), starting); }
      } else if (a.hold) {
        a.next = to; // conversando: vai depois
      } else if (a.leaving || !a.at || a.at.seat !== to.seat) {
        const from = a.leaving ? null : a.at;
        a.path = this.viaBoard(a, route(from, to).slice(1).map(([x, y]) => new Vector2(x, y)), starting && (!from || from.room !== to.room));
        a.leaving = false;
      }
      if (!a.hold) a.at = to;
      a.working = p.working;
      a.hidden = !!p.hidden;
      a.ch.root.visible = !a.hidden;
      (a.base.material as MeshLambertMaterial).color.set(p.shirt);
      (a.ring.material as MeshLambertMaterial).color.set(p.hair);
      a.ring.visible = p.key === selected;
      this.text(a, p);
      this.setSubs(a, p.working && to.seated ? Math.min(p.subs, 3) : 0);
    }
    // quem saiu vai embora pelo elevador
    for (const a of this.actors.values()) {
      if (seen.has(a.key) || a.leaving || a.hold) continue;
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

  /** desvia o caminho pelo quadro de tarefas do corredor (no trecho de corredor) e marca a parada lá */
  private viaBoard(a: Actor, path: Vector2[], go: boolean): Vector2[] {
    if (!go) return path;
    const i = path.findIndex(v => Math.abs(v.y - CORRIDOR_Y) < 0.01);
    if (i < 0) return path;
    const stop = new Vector2(BOARD_SPOT[0], BOARD_SPOT[1]);
    a.pauseAt = stop;
    return [...path.slice(0, i + 1), new Vector2(BOARD_SPOT[0], CORRIDOR_Y), stop, new Vector2(BOARD_SPOT[0], CORRIDOR_Y), ...path.slice(i + 1)];
  }

  private spawn(p: Person): Actor {
    const ch = this.kit!.character(p.model ?? hash(p.key));
    ch.root.userData['key'] = p.key;
    const ring = new Mesh(new RingGeometry(0.38, 0.48, 32), new MeshLambertMaterial({ color: p.hair, emissive: p.hair, emissiveIntensity: 0.5 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.025;
    ch.root.add(ring);
    // disco na cor do projeto: quem é de qual projeto, de longe
    const base = new Mesh(new CircleGeometry(0.3, 24), new MeshLambertMaterial({ color: p.shirt, transparent: true, opacity: 0.55, depthWrite: false }));
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.015;
    ch.root.add(base);
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
    label.position.set(0, 1.75, 0);
    ch.root.add(label);
    this.floor.add(ch.root);
    const a: Actor = {
      key: p.key, ch, base, label, el: { root, say, nick }, ring, pos: new Vector2(), path: [], at: null, working: p.working,
      facing: Math.random() * Math.PI * 2, lookKey: JSON.stringify(p.look ?? null), turnAt: 0, phase: Math.random() * 10, leaving: false, hidden: false, subs: [],
      hold: 0, next: null, saying: null, visit: null, name: p.name, pauseAt: null, waitUntil: 0,
    };
    this.actors.set(p.key, a);
    return a;
  }

  private text(a: Actor, p: Person): void {
    a.el.root.style.setProperty('--c', p.hair);
    a.el.root.classList.toggle('sel', p.key === this.selected);
    a.el.root.classList.toggle('idle', !p.working);
    const nick = `${p.name}${p.working ? '' : p.between ? ' · entre tarefas' : ' · zz'}`;
    if (a.el.nick.textContent !== nick) a.el.nick.textContent = nick;
    if (a.saying) return;
    a.el.say.hidden = !p.working;
    if (p.working) {
      const line = `${p.doing ?? 'pensando…'}${p.plan ? `  ${p.plan[0]}/${p.plan[1]}` : ''}`;
      const html = `${p.tag ? `<small>${esc(p.tag)}</small>` : ''}${esc(line)}`;
      if (a.el.say.innerHTML !== html) a.el.say.innerHTML = html;
    }
  }

  /** já coreografadas (cada aviso conversa uma vez) */
  private readonly talked = new Set<number>();

  /** Começa as conversas novas: quem recebe anda até quem avisou (os dois ficam parados até acabar). */
  talk(talks: Talk[]): void {
    for (const t of talks) {
      if (this.talked.has(t.id)) continue;
      const from = this.actors.get(t.from), to = this.actors.get(t.to);
      if (!from || !to || from === to || from.hidden || to.hidden || to.visit || from.hold) continue;
      this.talked.add(t.id);
      // ao lado de quem avisou, um passo à frente (sentado: ao lado da cadeira)
      // onde quem avisou está (ou para onde está indo: o encontro é lá, não no meio do caminho)
      const base = from.at ?? { room: 'copa' as RoomId, seat: '', x: from.pos.x, y: from.pos.y, seated: false };
      const spot: Placement = { room: base.room, seat: `visit:${t.id}`, x: base.x + 1.5, y: base.y + (base.seated ? 0.2 : 0.9), seated: false };
      from.hold = to.hold = Infinity;
      to.next = to.at;
      to.path = route(to.at, spot).slice(1).map(([x, y]) => new Vector2(x, y));
      to.at = spot;
      to.visit = { with: t.from, text: t.text, reply: t.reply };
      this.say(to, null);
      this.moving = performance.now() + 30_000;
    }
  }

  private say(a: Actor, html: string | null): void {
    a.saying = html;
    a.el.say.hidden = !html;
    a.el.say.classList.toggle('o3-talk', !!html);
    if (html) a.el.say.innerHTML = html;
  }

  /** acabou a conversa: cada um volta para onde a tela manda agora */
  private release(a: Actor): void {
    a.hold = 0;
    this.say(a, null);
    const to = a.next ?? a.at;
    if (to && a.at && to.seat !== a.at.seat) a.path = route(a.at, to).slice(1).map(([x, y]) => new Vector2(x, y));
    if (to) a.at = to;
    a.next = null;
    // o balão de "fazendo" volta no próximo sync (o texto da conversa sai)
    a.el.say.innerHTML = '';
    a.el.say.hidden = true;
    this.moving = performance.now() + 15_000;
  }

  private setSubs(a: Actor, n: number): void {
    while (a.subs.length > n) {
      const s = a.subs.pop()!;
      s.label.element.remove();
      this.floor.remove(s.ch.root);
      s.ch.mixer.stopAllAction();
    }
    while (a.subs.length < n) {
      const i = a.subs.length;
      const ch = this.kit!.character(hash(`sub${i}${a.key}`));
      ch.root.scale.setScalar(0.72);
      const el = document.createElement('div');
      el.className = 'o3-nick o3-sub';
      el.textContent = 'estagiário';
      const label = new CSS2DObject(el);
      label.center.set(0.5, 1);
      label.position.set(0, 2.25, 0);
      ch.root.add(label);
      this.floor.add(ch.root);
      a.subs.push({ ch, label });
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
    const roots = [...this.actors.values()].map(a => a.ch.root);
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
    const { ch } = a;
    let walking = false;
    if (a.waitUntil) {
      // no quadro de tarefas: olhando para ele, até a hora de seguir
      a.facing = Math.PI;
      if (s >= a.waitUntil) { a.waitUntil = 0; if (!a.visit) this.say(a, null); }
    } else if (a.path.length) {
      walking = true;
      const target = a.path[0];
      const d = target.clone().sub(a.pos);
      const len = d.length();
      const step = SPEED * dt;
      if (len <= step) {
        a.pos.copy(target); a.path.shift();
        if (target === a.pauseAt) { a.pauseAt = null; a.waitUntil = s + 2.4; if (!a.saying) this.say(a, 'pegando a próxima tarefa'); }
      }
      else a.pos.add(d.multiplyScalar(step / len));
      if (len > 0.01) a.facing = Math.atan2(target.x - a.pos.x, target.y - a.pos.y);
      if (!a.path.length && a.leaving) { this.remove(a); return; }
    } else if (a.at?.seated && !a.saying) {
      a.facing = Math.PI; // de frente para o monitor
    } else if (s > a.turnAt && !a.hold) {
      // parado em pé: vira de vez em quando (conversa na copa)
      a.facing = Math.random() * Math.PI * 2;
      a.turnAt = s + 3 + Math.random() * 6;
    }
    // conversa: chegou perto de quem avisou → os dois se viram e falam; o tempo acaba → cada um volta
    if (a.visit && !walking) {
      const other = this.actors.get(a.visit.with);
      if (other) {
        const end = s + TALK_S;
        a.hold = other.hold = end;
        a.facing = Math.atan2(other.pos.x - a.pos.x, other.pos.y - a.pos.y);
        if (!other.at?.seated) other.facing = Math.atan2(a.pos.x - other.pos.x, a.pos.y - other.pos.y);
        this.say(other, `<small>para ${esc(a.name)}</small>${esc(a.visit.text)}`);
        const reply = a.visit.reply;
        setTimeout(() => { if (a.hold === end) this.say(a, esc(reply)); }, 2200);
      } else a.hold = s;
      a.visit = null;
    }
    if (a.hold && a.hold !== Infinity && s > a.hold) this.release(a);
    if (a.saying && !walking && a.visit === null && a.hold && a.hold !== Infinity) {
      const other = [...this.actors.values()].find(o => o !== a && o.hold === a.hold);
      if (other && (!a.at?.seated || a.at.seat.startsWith('visit'))) a.facing = Math.atan2(other.pos.x - a.pos.x, other.pos.y - a.pos.y);
    }
    const seated = !walking && !!a.at?.seated;
    // sentado: um pouco para trás, no assento da cadeira
    ch.root.position.set(a.pos.x, seated ? SEAT_Y : 0, a.pos.y + (seated ? SEAT_BACK : 0));
    ch.root.rotation.y += angleTo(ch.root.rotation.y, a.facing) * Math.min(1, dt * 8);
    ch.play(walking ? 'walk' : seated ? 'sit' : a.waitUntil ? 'interact-right' : 'idle');
    // conversa: um "sim" de vez em quando
    if (!walking && a.saying && a.hold && s > a.turnAt) { ch.play('emote-yes', 0.2, true); a.turnAt = s + 4 + Math.random() * 3; }
    ch.mixer.update(dt);
    a.base.visible = !seated;
    a.label.visible = !a.hidden;
    a.el.say.style.visibility = walking ? 'hidden' : '';

    // estagiários em pé ao lado da mesa, virados para quem está sentado
    a.subs.forEach((sub, i) => {
      const [dx, dz] = SUB_SPOTS[i];
      sub.ch.root.visible = sub.label.visible = seated && !a.hidden;
      sub.ch.root.position.set(a.pos.x + dx, 0, a.pos.y + dz);
      sub.ch.root.rotation.y = Math.atan2(-dx, -dz);
      sub.ch.play(i === 0 ? 'interact-left' : 'idle');
      sub.ch.mixer.update(dt);
    });
  }

  private remove(a: Actor): void {
    this.setSubs(a, 0);
    a.ch.mixer.stopAllAction();
    a.el.root.remove();
    this.floor.remove(a.ch.root);
    this.actors.delete(a.key);
  }

  destroy(): void {
    this.dead = true;
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
    clearAvatarCaches();
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

/** escolhe um personagem estável pela chave (mesma pessoa, mesmo personagem) */
function hash(k: string): number { let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % CHARACTERS.length; }

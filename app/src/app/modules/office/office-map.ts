/**
 * Planta do Escritório em isométrico (sem engine: polígonos SVG calculados uma vez). Coordenadas em ladrilhos:
 * x anda para a direita-baixo, y para a esquerda-baixo; "profundidade" = x + y (maior = mais na frente).
 *
 *   y 0..6   Gestão | Engenharia | Monitoração      (paredes de fundo altas, divisórias de vidro)
 *   y 6..8   Corredor (elevador à esquerda)
 *   y 8..14  Copa   | Estúdio criativo | Negócios  (mureta de vidro com porta para o corredor)
 */

export type RoomId = 'gestao' | 'eng' | 'monitor' | 'creative' | 'business' | 'copa';

export const TW = 64, TH = 32, WALL = 104;
export const MAP_W = 24, MAP_H = 14;
const OX = MAP_H * (TW / 2) + 8, OY = WALL + 24;
export const VIEW_W = (MAP_W + MAP_H) * (TW / 2) + 16;
export const VIEW_H = (MAP_W + MAP_H) * (TH / 2) + OY + 24;

export interface RoomDef {
  id: RoomId;
  label: string;
  x: number; y: number; w: number; d: number;
  /** ladrilhos (duas tonalidades) e parede */
  floor: [string, string];
  wall: string;
  accent: string;
  /** x da porta (no lado do corredor) */
  door: number;
  /** mesas (canto de trás, 2 ladrilhos de largura); quem trabalha senta na frente */
  desks: [number, number][];
  /** lugares em pé (copa, ou quando acabam as mesas) */
  stands: [number, number][];
}

const desks4 = (x: number, y: number): [number, number][] => [[x + 1, y + 1], [x + 4, y + 1], [x + 1, y + 3.4], [x + 4, y + 3.4]];

export const ROOMS: RoomDef[] = [
  { id: 'gestao', label: 'Gestão', x: 0, y: 0, w: 7, d: 6, floor: ['#3a3326', '#342e22'], wall: '#5b4f36', accent: '#E8C46A', door: 3,
    desks: [[1, 1.2], [4, 1.2], [1, 3.6]], stands: [[5, 4.6], [4.2, 5.2], [3.4, 4.8]] },
  { id: 'eng', label: 'Engenharia', x: 7, y: 0, w: 10, d: 6, floor: ['#253048', '#212b41'], wall: '#3b4a6b', accent: '#7FA2FF', door: 11,
    desks: [[8, 1], [11, 1], [14, 1], [8, 3.4], [11, 3.4], [14, 3.4]], stands: [[16.2, 2.6], [16.3, 5.2], [10, 5.6], [13, 5.6]] },
  { id: 'monitor', label: 'Monitoração', x: 17, y: 0, w: 7, d: 6, floor: ['#1d3433', '#1a2f2e'], wall: '#2f514f', accent: '#5FD3B5', door: 20,
    desks: desks4(17, 0), stands: [[23, 5], [22, 5.4]] },
  { id: 'copa', label: 'Copa', x: 0, y: 8, w: 7, d: 6, floor: ['#3b2d26', '#352821'], wall: '#5a4436', accent: '#E8A36A', door: 4,
    desks: [], stands: [[2.6, 10.6], [3.6, 11.4], [1.6, 11.8], [4.8, 12.4], [5.6, 10.4], [2.4, 13], [5.6, 13.2], [1.4, 9.6], [6.2, 11.8], [3.6, 9.4]] },
  { id: 'creative', label: 'Estúdio criativo', x: 7, y: 8, w: 9, d: 6, floor: ['#36263f', '#302239'], wall: '#55406a', accent: '#D69CFF', door: 11,
    desks: [[8, 9.4], [12, 9.4], [8, 11.8], [12, 11.8]], stands: [[15, 13], [14, 13.4]] },
  { id: 'business', label: 'Negócios', x: 16, y: 8, w: 8, d: 6, floor: ['#22352a', '#1e3026'], wall: '#365a43', accent: '#7ED69A', door: 19,
    desks: [[17, 9.4], [20.5, 9.4], [17, 11.8], [20.5, 11.8]], stands: [[23, 13], [22, 13.4]] },
];
export const ROOM = new Map(ROOMS.map(r => [r.id, r]));
const CORRIDOR_Y = 7;
const ELEVATOR: [number, number] = [0.6, CORRIDOR_Y];

/** Sala de um agente pelo papel, quando ele não escolheu uma. */
export function inferRoom(text: string): RoomId {
  const t = text.toLowerCase();
  if (/sentry|monitor|sentinela|alerta|incidente|observab|\bci\b|uptime|\blogs?\b/.test(t)) return 'monitor';
  if (/market|conte[uú]do|design|criativ|copy|\bposts?\b|livro|social|v[ií]deo|redator|escrit|brand/.test(t)) return 'creative';
  if (/neg[oó]cio|financ|venda|comercial|cliente|suporte|atendimento|stripe|cobran|pre[cç]o|contrato/.test(t)) return 'business';
  if (/gest|planej|roadmap|produto|backlog/.test(t)) return 'gestao';
  return 'eng';
}

/** ladrilho → tela (z sobe na tela) */
export function iso(x: number, y: number, z = 0): [number, number] {
  return [(x - y) * (TW / 2) + OX, (x + y) * (TH / 2) + OY - z];
}
const pt = (x: number, y: number, z = 0) => iso(x, y, z).map(n => Math.round(n * 10) / 10).join(',');

export interface Poly { points: string; fill: string; stroke?: string; opacity?: number }

/** caixa isométrica: topo, face +y (frente-esquerda) e face +x (frente-direita) */
export function box(x: number, y: number, z: number, w: number, d: number, h: number, top: string, left: string, right: string): Poly[] {
  return [
    { points: [pt(x, y + d, z), pt(x + w, y + d, z), pt(x + w, y + d, z + h), pt(x, y + d, z + h)].join(' '), fill: left },
    { points: [pt(x + w, y, z), pt(x + w, y + d, z), pt(x + w, y + d, z + h), pt(x + w, y, z + h)].join(' '), fill: right },
    { points: [pt(x, y, z + h), pt(x + w, y, z + h), pt(x + w, y + d, z + h), pt(x, y + d, z + h)].join(' '), fill: top },
  ];
}
const tile = (x: number, y: number, fill: string): Poly => ({ points: [pt(x, y), pt(x + 1, y), pt(x + 1, y + 1), pt(x, y + 1)].join(' '), fill });
/** parede ao longo de x (fundo, y fixo) ou de y (esquerda, x fixo) */
const wallX = (x0: number, x1: number, y: number, h: number, fill: string, opacity?: number): Poly =>
  ({ points: [pt(x0, y), pt(x1, y), pt(x1, y, h), pt(x0, y, h)].join(' '), fill, opacity });
const wallY = (y0: number, y1: number, x: number, h: number, fill: string, opacity?: number): Poly =>
  ({ points: [pt(x, y0), pt(x, y1), pt(x, y1, h), pt(x, y0, h)].join(' '), fill, opacity });

export interface Prop { depth: number; polys: Poly[]; desk?: string; screen?: string }

const shade = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1)))));
  return `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
};

/** Tudo que não muda: piso, paredes, divisórias, móveis. Mesas guardam a chave para acender o monitor. */
export function staticScene(): { floor: Poly[]; walls: Poly[]; glass: Poly[]; props: Prop[] } {
  const floor: Poly[] = [];
  for (let x = 0; x < MAP_W; x++) for (let y = 6; y < 8; y++) floor.push(tile(x, y, (x + y) % 2 ? '#2a2f3a' : '#272c36'));
  for (const r of ROOMS) for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.d; y++) floor.push(tile(x, y, r.floor[(x + y) % 2]));

  const walls: Poly[] = [];
  for (const r of ROOMS.filter(r => r.y === 0)) {
    walls.push(wallX(r.x, r.x + r.w, 0, WALL, shade(r.wall, 1.08)));
    walls.push(wallX(r.x, r.x + r.w, 0, 6, shade(r.wall, 0.7))); // rodapé
  }
  walls.push(wallY(0, 6, 0, WALL, shade(ROOM.get('gestao')!.wall, 0.82)));
  walls.push(wallY(6, 8, 0, WALL, '#3a404d'));
  walls.push(wallY(8, 14, 0, WALL, shade(ROOM.get('copa')!.wall, 0.82)));
  // elevador
  walls.push({ points: [pt(0, 6.35, 0), pt(0, 7.65, 0), pt(0, 7.65, 70), pt(0, 6.35, 70)].join(' '), fill: '#59606e' });
  walls.push({ points: [pt(0, 6.98, 0), pt(0, 7.02, 0), pt(0, 7.02, 70), pt(0, 6.98, 70)].join(' '), fill: '#2b303a' });
  // decoração das paredes: quadro (gestão), telões (monitoração), quadro de cortiça (criativo fica sem parede alta)
  walls.push({ points: [pt(1.2, 0, 34), pt(5.6, 0, 34), pt(5.6, 0, 84), pt(1.2, 0, 84)].join(' '), fill: '#e9e6dc', stroke: '#8b8270' });
  for (const [x0, x1] of [[17.6, 19.8], [20.2, 22.4]]) {
    walls.push({ points: [pt(x0, 0, 36), pt(x1, 0, 36), pt(x1, 0, 82), pt(x0, 0, 82)].join(' '), fill: '#0d1716', stroke: '#5FD3B5' });
  }
  for (const x of [9, 12.5]) walls.push({ points: [pt(x, 0, 40), pt(x + 1.6, 0, 40), pt(x + 1.6, 0, 76), pt(x, 0, 76)].join(' '), fill: '#9fc3ff', opacity: 0.22 }); // janelas

  // vidro: divisórias e a mureta das salas de baixo (com porta)
  const glass: Poly[] = [];
  const G = '#cfe3ff';
  for (const x of [7, 17]) glass.push(wallY(0, 6, x, 54, G, 0.07));
  for (const x of [7, 16]) glass.push(wallY(8, 14, x, 54, G, 0.07));
  for (const r of ROOMS.filter(r => r.y === 8)) {
    glass.push(wallX(r.x, r.door, 8, 30, G, 0.08));
    glass.push(wallX(r.door + 1.2, r.x + r.w, 8, 30, G, 0.08));
  }

  const props: Prop[] = [];
  const add = (x: number, y: number, w: number, d: number, polys: Poly[], desk?: string, screen?: string) => props.push({ depth: x + w / 2 + y + d / 2, polys, desk, screen });
  for (const r of ROOMS) r.desks.forEach(([x, y], i) => {
    const key = `${r.id}:${i}`;
    add(x, y, 2, 0.9, [
      ...box(x, y, 0, 2, 0.9, 18, '#c9a77a', '#8f7350', '#7a6142'),
      ...box(x + 0.55, y + 0.12, 18, 0.9, 0.1, 22, '#2b2f38', '#1d2129', '#15181e'), // monitor (a face +y é a tela)
    ], key, [pt(x + 0.62, y + 0.23, 21), pt(x + 1.38, y + 0.23, 21), pt(x + 1.38, y + 0.23, 37), pt(x + 0.62, y + 0.23, 37)].join(' '));
  });
  const plant = (x: number, y: number) => add(x, y, 0.5, 0.5, [...box(x, y, 0, 0.5, 0.5, 14, '#a5683e', '#8a5532', '#6f4428'), ...box(x - 0.05, y - 0.05, 14, 0.6, 0.6, 20, '#4fa66a', '#3d8a55', '#2f6e44')]);
  // gestão: mesa de reunião
  add(3.4, 3.8, 1.6, 1, box(3.4, 3.8, 0, 1.6, 1, 16, '#e0d2b0', '#a8987a', '#8f8064'));
  // monitoração: rack de servidores
  add(23.1, 1, 0.8, 1.2, [...box(23.1, 1, 0, 0.8, 1.2, 62, '#2a2f38', '#1d2129', '#15181e')]);
  // copa: balcão com cafeteira, sofá, mesa
  add(0.1, 8.6, 0.9, 3, [...box(0.1, 8.6, 0, 0.9, 3, 26, '#b9b2a5', '#8d877c', '#6f6a61'), ...box(0.3, 9.1, 26, 0.5, 0.5, 16, '#2b2f38', '#1d2129', '#15181e')]);
  add(2, 12.6, 2.6, 0.9, [...box(2, 12.6, 0, 2.6, 0.9, 12, '#c0705a', '#9a5847', '#7e4739'), ...box(2, 13.2, 12, 2.6, 0.3, 14, '#c0705a', '#9a5847', '#7e4739')]);
  add(3, 10.2, 1, 1, box(3, 10.2, 0, 1, 1, 14, '#d9c49c', '#a9966f', '#8d7b58'));
  // criativo: cavalete e pufes; negócios: estante
  add(14.6, 9, 0.3, 1, box(14.6, 9, 0, 0.3, 1, 52, '#f2efe6', '#c9c4b5', '#a8a394'));
  add(15, 11, 0.6, 0.6, box(15, 11, 0, 0.6, 0.6, 10, '#ff8fb1', '#d66d8f', '#b25775'));
  add(23, 9, 0.8, 2.4, box(23, 9, 0, 0.8, 2.4, 48, '#6b4b33', '#553a27', '#43301f'));
  for (const [x, y] of [[6.3, 0.4], [16.3, 0.4], [6.2, 13.3], [23.4, 6.2], [15.4, 13.4], [9.2, 6.2], [14.5, 6.2]] as [number, number][]) plant(x, y);
  return { floor, walls, glass, props: props.sort((a, b) => a.depth - b.depth) };
}

/** onde fica a placa da sala (texto inclinado na parede de fundo ou na mureta) */
export function roomSigns(): { id: RoomId; label: string; accent: string; transform: string }[] {
  return ROOMS.map(r => {
    const [sx, sy] = r.y === 0 ? iso(r.x + 0.4, 0, WALL - 14) : iso(r.x + 0.4, 8, 42);
    return { id: r.id, label: r.label, accent: r.accent, transform: `matrix(1,0.5,0,1,${sx},${sy})` };
  });
}

// ---------- quem senta onde ----------

export interface Placement { room: RoomId; seat: string; x: number; y: number; seated: boolean }

/**
 * Distribui as pessoas nas salas mantendo quem já estava no mesmo lugar (não sai andando à toa quando chega alguém).
 * `prev` é mutado com as escolhas (chave → lugar).
 */
export function place(people: { key: string; room: RoomId }[], prev: Map<string, string>): Map<string, Placement> {
  const out = new Map<string, Placement>();
  const taken = new Set<string>();
  const seatsOf = (r: RoomDef) => [...r.desks.map((_, i) => `${r.id}:${i}`), ...r.stands.map((_, i) => `${r.id}:s${i}`)];
  const pos = (seat: string): Placement => {
    const [id, n] = seat.split(':') as [RoomId, string];
    const r = ROOM.get(id)!;
    if (n.startsWith('s')) { const [x, y] = r.stands[+n.slice(1)]; return { room: id, seat, x, y, seated: false }; }
    const [x, y] = r.desks[+n];
    return { room: id, seat, x: x + 1, y: y + 1.55, seated: true };
  };
  // 1) quem continua na mesma sala fica no mesmo lugar
  for (const p of people) {
    const s = prev.get(p.key);
    if (s && s.startsWith(p.room + ':') && !taken.has(s)) { taken.add(s); out.set(p.key, pos(s)); }
  }
  // 2) os outros pegam o primeiro lugar livre (mesa antes de ficar em pé); lotou, divide o último
  for (const p of people) {
    if (out.has(p.key)) continue;
    const seats = seatsOf(ROOM.get(p.room)!);
    const s = seats.find(x => !taken.has(x)) ?? seats[seats.length - 1];
    taken.add(s);
    out.set(p.key, pos(s));
  }
  prev.clear();
  for (const [k, v] of out) prev.set(k, v.seat);
  return out;
}

/** caminho entre dois lugares passando pelas portas e pelo corredor (null = de onde? vem do elevador) */
export function route(from: Placement | null, to: Placement): [number, number][] {
  const door = (p: Placement): [number, number][] => {
    const r = ROOM.get(p.room)!;
    const inside: [number, number] = r.y === 0 ? [r.door + 0.5, 5.4] : [r.door + 0.6, 8.6];
    return [inside, [r.door + 0.5, CORRIDOR_Y]];
  };
  const a: [number, number] = from ? [from.x, from.y] : ELEVATOR;
  if (from && from.room === to.room) return [a, [to.x, to.y]];
  const out = from ? [a, ...door(from)] : [a];
  return [...out, ...door(to).reverse(), [to.x, to.y]];
}

/** cor de pele estável por pessoa */
const SKINS = ['#f1c9a5', '#e0ac85', '#c68863', '#8d5a3b', '#f5d6bd'];
export function skinOf(key: string): string {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SKINS[h % SKINS.length];
}

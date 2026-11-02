/**
 * Planta do Escritório (a mesma para o 3D): coordenadas em ladrilhos, x para a direita e y para a frente.
 *
 *   y 0..6   Gestão | Engenharia | Monitoração      (divisórias de vidro)
 *   y 6..8   Corredor (elevador à esquerda)
 *   y 8..14  Copa   | Estúdio criativo | Negócios  (mureta de vidro com porta para o corredor)
 *
 * Aqui só fica o que é lógica (salas, lugares, caminhos); o desenho mora em office-world.ts.
 */

export type RoomId = 'gestao' | 'eng' | 'monitor' | 'creative' | 'business' | 'copa';

export const MAP_W = 24, MAP_H = 14;

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
    desks: [], stands: [[2.4, 9.4], [4.6, 10.2], [2.2, 11.6], [5.4, 12.2], [3.6, 12.6], [6.1, 9.2], [1.6, 13.2], [4.4, 8.9], [6.2, 13.2], [1.6, 10.4]] },
  { id: 'creative', label: 'Estúdio criativo', x: 7, y: 8, w: 9, d: 6, floor: ['#36263f', '#302239'], wall: '#55406a', accent: '#D69CFF', door: 11,
    desks: [[8, 9.4], [12, 9.4], [8, 11.8], [12, 11.8]], stands: [[15, 13], [14, 13.4]] },
  { id: 'business', label: 'Negócios', x: 16, y: 8, w: 8, d: 6, floor: ['#22352a', '#1e3026'], wall: '#365a43', accent: '#7ED69A', door: 19,
    desks: [[17, 9.4], [20.5, 9.4], [17, 11.8], [20.5, 11.8]], stands: [[23, 13], [22, 13.4]] },
];
export const ROOM = new Map(ROOMS.map(r => [r.id, r]));
export const CORRIDOR_Y = 7;
export const ELEVATOR: [number, number] = [0.6, CORRIDOR_Y];

/** Sala de um agente pelo papel, quando ele não escolheu uma. */
export function inferRoom(text: string): RoomId {
  const t = text.toLowerCase();
  if (/sentry|monitor|sentinela|alerta|incidente|observab|\bci\b|uptime|\blogs?\b/.test(t)) return 'monitor';
  if (/market|conte[uú]do|design|criativ|copy|\bposts?\b|livro|social|v[ií]deo|redator|escrit|brand/.test(t)) return 'creative';
  if (/neg[oó]cio|financ|venda|comercial|cliente|suporte|atendimento|stripe|cobran|pre[cç]o|contrato/.test(t)) return 'business';
  if (/gest|planej|roadmap|produto|backlog/.test(t)) return 'gestao';
  return 'eng';
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

/**
 * Planta do Escritório (a mesma para o 3D): coordenadas em ladrilhos, x para a direita e y para a frente.
 *
 *   y 0..8    Gestão | Engenharia | Monitoração      (divisórias de vidro)
 *   y 8..11   Corredor (elevador à esquerda; quadro de tarefas na parede da Gestão)
 *   y 11..20  Copa   | Estúdio criativo | Negócios  (mureta de vidro com porta para o corredor)
 *
 * As mesas ficam em fileiras viradas para a frente (quem senta fica de rosto para a câmera), com um corredor entre as
 * colunas: quem chega entra pela porta, anda pelo corredor da coluna e senta por trás da mesa.
 * Aqui só fica o que é lógica (salas, lugares, caminhos); o desenho mora em office-world.ts.
 */

import { SKINS } from '../../shared/ui/avatar-look';

export type RoomId = 'gestao' | 'eng' | 'monitor' | 'creative' | 'business' | 'copa';

export const MAP_W = 30, MAP_H = 20;
/** onde acabam as salas de cima e começam as de baixo (o corredor fica entre) */
export const NORTH_D = 8, SOUTH_Y = 11;

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
  /** mesas (canto de trás, 2 x 1,84 ladrilhos); a cadeira fica atrás, do lado da parede, e quem senta olha para a frente */
  desks: [number, number][];
  /** lugares em pé (copa, ou quando acabam as mesas) */
  stands: [number, number][];
}

/** fileiras de mesas: colunas em x, linhas em y */
const grid = (xs: number[], ys: number[]): [number, number][] => ys.flatMap(y => xs.map(x => [x, y] as [number, number]));

export const ROOMS: RoomDef[] = [
  { id: 'gestao', label: 'Gestão', x: 0, y: 0, w: 9, d: NORTH_D, floor: ['#3a3326', '#342e22'], wall: '#5b4f36', accent: '#E8C46A', door: 7.2,
    desks: [[1.2, 1.4], [4.4, 1.4], [1.2, 4.4]], stands: [[5.6, 3.6], [8.2, 3.2], [8.3, 7.0]] },
  { id: 'eng', label: 'Engenharia', x: 9, y: 0, w: 13, d: NORTH_D, floor: ['#253048', '#212b41'], wall: '#3b4a6b', accent: '#7FA2FF', door: 14.9,
    desks: grid([9.9, 12.7, 16.3, 19.1], [1.2, 4.3]), stands: [[13.2, 7.2], [17.6, 7.3], [11.2, 7.3], [20.2, 7.2]] },
  { id: 'monitor', label: 'Monitoração', x: 22, y: 0, w: 8, d: NORTH_D, floor: ['#1d3433', '#1a2f2e'], wall: '#2f514f', accent: '#5FD3B5', door: 28.0,
    desks: grid([22.9, 25.7], [1.8, 4.6]), stands: [[28.8, 6.2], [27.4, 7.2]] },
  { id: 'copa', label: 'Copa', x: 0, y: SOUTH_Y, w: 9, d: 9, floor: ['#3b2d26', '#352821'], wall: '#5a4436', accent: '#E8A36A', door: 4.6,
    desks: [], stands: [
      [2.5, 13.1], [4.3, 13.1], [2.5, 14.7], [4.3, 14.7], [1.35, 12.4], [1.35, 13.8], [1.35, 15.2], [1.45, 17.3],
      [5.3, 15.9], [5.3, 19.1], [7.5, 15.6], [7.6, 19.2], [3.0, 17.2], [4.2, 18.2], [3.0, 19.2], [6.6, 12.4], [7.9, 13.6], [6.3, 14.6]] },
  { id: 'creative', label: 'Estúdio criativo', x: 9, y: SOUTH_Y, w: 10, d: 9, floor: ['#36263f', '#302239'], wall: '#55406a', accent: '#D69CFF', door: 11.8,
    desks: grid([9.8, 13.0, 16.2], [12.2, 15.3]), stands: [[12.4, 18.6], [13.8, 19.0], [11.0, 19.0]] },
  { id: 'business', label: 'Negócios', x: 19, y: SOUTH_Y, w: 11, d: 9, floor: ['#22352a', '#1e3026'], wall: '#365a43', accent: '#7ED69A', door: 22.0,
    desks: grid([20.0, 23.2, 26.4], [12.2, 15.3]), stands: [[25.2, 18.6], [26.6, 19.1], [21.4, 18.9]] },
];
export const ROOM = new Map(ROOMS.map(r => [r.id, r]));
export const CORRIDOR_Y = 9.5;
export const ELEVATOR: [number, number] = [0.6, CORRIDOR_Y];
/** quadro de tarefas na parede da Gestão, virado para o corredor, ao lado do elevador: quem começa uma tarefa passa nele */
export const TASK_BOARD: [number, number] = [2.8, NORTH_D + 0.08];
export const BOARD_SPOT: [number, number] = [2.8, NORTH_D + 0.85];

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

export interface Placement { room: RoomId; seat: string; x: number; y: number; seated: boolean; aisle?: number }

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
    return { room: id, seat, x: x + 1, y: y + 0.29, seated: true, aisle: x - 0.45 };
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

/** ponto logo dentro da porta de uma sala */
const inside = (r: RoomDef): [number, number] => [r.door + 0.6, r.y === 0 ? r.d - 0.6 : r.y + 0.6];
/** da porta até a mesa: pelo corredor da coluna (à esquerda da mesa), sem atravessar as outras mesas */
const approach = (p: Placement): [number, number][] => {
  if (p.aisle === undefined) return [];
  const y = inside(ROOM.get(p.room)!)[1];
  return [[p.aisle, y], [p.aisle, p.y]];
};

/** caminho entre dois lugares passando pelas portas e pelo corredor (null = de onde? vem do elevador) */
export function route(from: Placement | null, to: Placement): [number, number][] {
  const door = (p: Placement): [number, number][] => {
    const r = ROOM.get(p.room)!;
    return [inside(r), [r.door + 0.6, CORRIDOR_Y]];
  };
  const a: [number, number] = from ? [from.x, from.y] : ELEVATOR;
  if (from && from.room === to.room) return [a, ...approach(from).reverse(), ...approach(to), [to.x, to.y]];
  const out = from ? [a, ...approach(from).reverse(), ...door(from)] : [a];
  return [...out, ...door(to).reverse(), ...approach(to), [to.x, to.y]];
}

/** de onde está até o elevador (indo embora) */
export function exitPath(from: Placement | null): [number, number][] {
  if (!from) return [ELEVATOR];
  const r = ROOM.get(from.room)!;
  return [...approach(from).reverse(), inside(r), [r.door + 0.6, CORRIDOR_Y], ELEVATOR];
}

/** cor de pele estável por pessoa */
export function skinOf(key: string): string {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SKINS[h % SKINS.length];
}

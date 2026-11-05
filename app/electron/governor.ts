/**
 * Freio da cota do plano: decide quem pode começar, quem pausa e quem volta. Regras puras (sem banco nem processo);
 * a fila (agents.ts) aplica. O uso é o mesmo do /usage do Claude Code e conta também o que o Gustavo usa fora da
 * Central, por isso as faixas deixam folga.
 */

/** 0 = alta, 1 = normal, 2 = baixa */
export type Priority = 0 | 1 | 2;
export const PRIORITY_OF: Record<string, Priority> = { high: 0, normal: 1, low: 2 };

/**
 * As faixas do freio (o Gustavo ajusta em Preferências): até quanto da sessão / da semana cada prioridade ainda pode
 * começar (alta, normal, baixa) e a partir de quanto pausa quem está rodando (para não estourar e ficar sem voltar).
 */
export interface Limits { session: [number, number, number]; week: [number, number, number]; pause: { session: number; week: number } }
export const DEFAULT_LIMITS: Limits = { session: [90, 80, 60], week: [95, 90, 80], pause: { session: 95, week: 98 } };
let limits: Limits = DEFAULT_LIMITS;
export const getLimits = () => limits;

/** Lê e confere (0 a 100; o que vier errado volta ao padrão). */
export function parseLimits(raw: unknown): Limits {
  const pct = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Math.round(Number(v)))) : d);
  const r = (raw ?? {}) as Partial<Limits>;
  const D = DEFAULT_LIMITS;
  return {
    session: [0, 1, 2].map(i => pct(r.session?.[i], D.session[i])) as Limits['session'],
    week: [0, 1, 2].map(i => pct(r.week?.[i], D.week[i])) as Limits['week'],
    pause: { session: pct(r.pause?.session, D.pause.session), week: pct(r.pause?.week, D.pause.week) },
  };
}
export const setLimits = (l: unknown) => { limits = parseLimits(l); return limits; };
/** esperando na fila há este tempo sobe um nível na ordem (não no freio) */
const AGING_MIN = 45;

export interface Usage { session: number | null; week: number | null; sessionReset: string | null; weekReset: string | null }

export function readUsage(limits: { kind: string; percent: number; resets_at: string | null }[]): Usage {
  const s = limits.find(l => l.kind === 'session'), w = limits.find(l => l.kind === 'weekly_all');
  return { session: s?.percent ?? null, week: w?.percent ?? null, sessionReset: s?.resets_at ?? null, weekReset: w?.resets_at ?? null };
}

export const canStart = (p: Priority, u: Usage) => (u.session ?? 0) < limits.session[p] && (u.week ?? 0) < limits.week[p];

/** null = segue; senão o motivo e até quando (renovação do limite que estourou) */
export function mustPause(u: Usage): { reason: string; until: string | null } | null {
  if ((u.week ?? 0) >= limits.pause.week) return { reason: `semana em ${u.week}%`, until: u.weekReset };
  if ((u.session ?? 0) >= limits.pause.session) return { reason: `sessão em ${u.session}%`, until: u.sessionReset };
  return null;
}

/** O que o Claude Code escreve quando bate no limite do plano: a execução pausa em vez de falhar. */
export const LIMIT_HIT = /usage limit|hit your (usage )?limit|limit reached|rate[ _-]?limit|out of (extra )?usage|5-hour limit/i;

export interface Queued { id: number; priority: number; created_at: string; paused: string | null }

const effective = (q: Queued, nowMs: number) =>
  Math.max(0, q.priority - Math.floor((nowMs - Date.parse(q.created_at.endsWith('Z') ? q.created_at : `${q.created_at}Z`)) / (AGING_MIN * 60_000)));

/**
 * Quem começa agora: prioridade (com envelhecimento) e depois ordem de chegada. A última vaga fica guardada para a
 * prioridade alta, para o urgente não esperar atrás de execuções longas.
 */
export function pickNext(queued: Queued[], active: number, max: number, u: Usage, nowMs: number): number[] {
  let slots = max - active;
  const out: number[] = [];
  const order = queued.filter(q => !q.paused && canStart(q.priority as Priority, u))
    .sort((a, b) => effective(a, nowMs) - effective(b, nowMs) || a.id - b.id);
  for (const q of order) {
    if (slots <= 0) break;
    if (q.priority > 0 && active + out.length >= max - 1) continue; // última vaga: só alta
    out.push(q.id);
    slots--;
  }
  return out;
}

/** Pausada que pode voltar: o limite renovou (ou não se sabe quando) e o freio deixa. Uma por vez, a mais prioritária. */
export function nextToResume(paused: (Queued & { until: string | null })[], u: Usage, nowMs: number): number | null {
  const ready = paused.filter(p => (!p.until || Date.parse(p.until) <= nowMs) && canStart(p.priority as Priority, u))
    .sort((a, b) => a.priority - b.priority || a.id - b.id);
  return ready[0]?.id ?? null;
}

/** Para a barra: o que o freio está segurando agora (null = nada). */
export function brakeLabel(u: Usage): string | null {
  if (mustPause(u)) return 'Freio: pausando tudo';
  if (!canStart(0, u)) return 'Freio: nada começa';
  if (!canStart(1, u)) return 'Freio: só prioridade alta';
  if (!canStart(2, u)) return 'Freio: prioridade baixa espera';
  return null;
}

/** Cadeia de agentes chamando agentes: no máximo 3 saltos e sem repetir agente (evita laço que queima a cota). */
export const MAX_DEPTH = 3;
export function chainProblem(chainAgents: number[], target: number): string | null {
  if (chainAgents.length > MAX_DEPTH) return `A cadeia já tem ${MAX_DEPTH} saltos; resolva você ou crie uma decisão para o Gustavo.`;
  if (chainAgents.includes(target)) return 'Esse agente já está nesta cadeia; chamar de novo faria um laço.';
  return null;
}

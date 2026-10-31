/**
 * Rotinas: agentes autônomos com agenda. Rodam na máquina (veem os repositórios e a Central),
 * diferente das Routines na nuvem do Claude, que só enxergam o GitHub.
 */
import type { NewRoutineInput, RoutineDto, RoutinePatch } from '../src/app/shared/contract';
import { Emit, startRun } from './agents';
import { all, get, now, run } from './db';
import { getUsage } from './usage';

export const SIZE_BUDGET = { small: 2, medium: 6, large: 15 } as const;

/**
 * Próxima execução depois de `from`.
 * daily: nos dias da semana listados (0 = domingo) às HH:MM, no horário local.
 * interval: de N em N horas a partir de `from`.
 */
export function nextRun(kind: 'daily' | 'interval', days: number[], time: string, hours: number, from: Date): Date {
  if (kind === 'interval') return new Date(from.getTime() + Math.max(hours, 1) * 3_600_000);
  const [h, m] = time.split(':').map(Number);
  const allowed = days.length ? days : [0, 1, 2, 3, 4, 5, 6];
  for (let i = 0; i <= 7; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (d > from && allowed.includes(d.getDay())) return d;
  }
  throw new Error('Agenda sem dia válido.');
}

const SELECT = `select r.*,
  (select status from runs where routine_id = r.id order by id desc limit 1) last_status,
  (select id from runs where routine_id = r.id order by id desc limit 1) last_run_id,
  (select count(*) from runs where routine_id = r.id) run_count
  from routines r`;

const toDto = (r: any): RoutineDto => ({ ...r, days: r.days ? String(r.days).split(',').map(Number) : [], enabled: !!r.enabled });

export const listRoutines = () => all<any>(`${SELECT} order by r.enabled desc, r.next_run_at`).map(toDto);
const getRoutine = (id: number) => { const r = get<any>(`${SELECT} where r.id = ?`, id); return r ? toDto(r) : null; };

function validate(i: Partial<NewRoutineInput>): void {
  if (i.name !== undefined && !i.name.trim()) throw new Error('Dê um nome à rotina.');
  if (i.prompt !== undefined && !i.prompt.trim()) throw new Error('Descreva o que a rotina faz.');
  if (i.schedule_kind && !['daily', 'interval'].includes(i.schedule_kind)) throw new Error('Agenda inválida.');
  if (i.time !== undefined && !/^\d{2}:\d{2}$/.test(i.time)) throw new Error('Horário inválido.');
  if (i.size && !(i.size in SIZE_BUDGET)) throw new Error('Tamanho inválido.');
  if (i.project_slug && !get('select 1 from projects where slug = ?', i.project_slug)) throw new Error('Projeto não encontrado.');
  if (i.repo_path && !get('select 1 from repos where path = ?', i.repo_path)) throw new Error('Repositório não encontrado.');
}

function schedule(r: { schedule_kind: 'daily' | 'interval'; days: number[]; time: string; interval_hours: number }, from = new Date()): string {
  return nextRun(r.schedule_kind, r.days, r.time, r.interval_hours, from).toISOString();
}

export function createRoutine(i: NewRoutineInput): RoutineDto {
  validate(i);
  if (!i.name?.trim() || !i.prompt?.trim() || !i.project_slug) throw new Error('Nome, projeto e o que fazer são obrigatórios.');
  const r = { schedule_kind: i.schedule_kind ?? 'daily', days: i.days ?? [1, 2, 3, 4, 5], time: i.time ?? '08:00', interval_hours: i.interval_hours ?? 24 };
  const { lastInsertRowid } = run(`insert into routines (name, project_slug, repo_path, prompt, permission, size, schedule_kind, days, time,
      interval_hours, max_session, enabled, next_run_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    i.name.trim(), i.project_slug, i.repo_path || null, i.prompt.trim(), i.permission === 'full' ? 'full' : 'edits', i.size ?? 'small',
    r.schedule_kind, r.days.join(','), r.time, r.interval_hours, i.max_session ?? 80, i.enabled === false ? 0 : 1, schedule(r));
  return getRoutine(Number(lastInsertRowid))!;
}

export function updateRoutine(id: number, patch: RoutinePatch): void {
  const cur = getRoutine(id);
  if (!cur) throw new Error('Rotina não encontrada.');
  validate(patch);
  const cols = ['name', 'project_slug', 'repo_path', 'prompt', 'permission', 'size', 'schedule_kind', 'time', 'interval_hours', 'max_session'] as const;
  const fields: [string, string | number | null][] = cols.filter(k => k in patch).map(k => [k, (patch[k] ?? null) as string | number | null]);
  if ('days' in patch) fields.push(['days', (patch.days ?? []).join(',')]);
  if ('enabled' in patch) fields.push(['enabled', patch.enabled ? 1 : 0]);
  const merged = { ...cur, ...patch } as RoutineDto;
  // agenda mudou (ou foi religada): recalcula a próxima
  fields.push(['next_run_at', schedule(merged)]);
  run(`update routines set ${fields.map(([k]) => `${k} = ?`).join(', ')} where id = ?`, ...fields.map(([, v]) => v), id);
}

export const deleteRoutine = (id: number) => run('delete from routines where id = ?', id);

/** Dispara já (pelo botão ou pela agenda). Pula se a sessão do plano estiver acima do limite da rotina. */
export async function fireRoutine(id: number, emit: Emit, manual: boolean): Promise<number | null> {
  const r = getRoutine(id);
  if (!r) throw new Error('Rotina não encontrada.');
  const next = schedule(r);
  if (!manual) {
    const session = (await getUsage(false)).limits.find(l => l.kind === 'session');
    if (session && session.percent >= r.max_session) {
      run('update routines set next_run_at = ?, last_skipped = ? where id = ?', next, `Sessão em ${session.percent}%`, id);
      emit.changed();
      return null;
    }
  }
  const prompt = `${r.prompt}\n\n(Execução ${manual ? 'manual' : 'agendada'} da rotina "${r.name}".)`;
  const runDto = startRun({
    project_slug: r.project_slug, repo_path: r.repo_path, prompt, budget_usd: SIZE_BUDGET[r.size], permission: r.permission,
    proposal_id: null,
  }, emit, id);
  run('update routines set last_run_at = ?, last_skipped = null, next_run_at = ? where id = ?', now(), manual ? r.next_run_at : next, id);
  return runDto.id;
}

/** A cada minuto: dispara as rotinas ligadas que chegaram na hora (uma vez, mesmo se o PC ficou desligado). */
export function watchRoutines(emit: Emit): void {
  const tick = () => {
    for (const r of all<{ id: number }>(`select id from routines where enabled = 1 and next_run_at <= ?`, now())) {
      fireRoutine(r.id, emit, false).catch(e => console.error('rotina', r.id, e));
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, 60_000);
}

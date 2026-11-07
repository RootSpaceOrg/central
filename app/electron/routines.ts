/**
 * Rotinas: agentes autônomos com agenda. Rodam na máquina (veem os repositórios e a Central),
 * diferente das Routines na nuvem do Claude, que só enxergam o GitHub.
 */
import type { NewRoutineInput, RoutineDto, RoutinePatch } from '../src/app/shared/contract';
import { Emit, startCommandRun, startRun } from './agents';
import { getAgent } from './agentdefs';
import { homedir } from 'node:os';
import { all, get, now, run } from './db';
import { getUsage } from './usage';
import { nextRun } from './schedule';

/** aviso na área de trabalho quando uma rotina de comando falha (o main liga à janela) */
let warn: (title: string, body: string) => void = () => {};
export const onRoutineFail = (fn: typeof warn) => { warn = fn; };

export const SIZE_BUDGET = { small: 2, medium: 6, large: 15 } as const;

export { nextRun } from './schedule';

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
  if (i.agent_id && !get('select 1 from agents where id = ?', i.agent_id)) throw new Error('Agente não encontrado.');
  if (i.repo_path && !get('select 1 from repos where path = ?', i.repo_path)) throw new Error('Repositório não encontrado.');
  if (i.kind && !['agent', 'command'].includes(i.kind)) throw new Error('Tipo de rotina inválido.');
  if (i.shell && !['', 'shell', 'cmd', 'bash'].includes(i.shell)) throw new Error('Terminal inválido.');
  if (i.interval_minutes != null && !(i.interval_minutes >= 5 && i.interval_minutes <= 1440)) throw new Error('Intervalo entre 5 minutos e 24 horas.');
  if (i.on_fail_agent && !get('select 1 from agents where id = ?', i.on_fail_agent)) throw new Error('Agente (se falhar) não encontrado.');
}

function schedule(r: { schedule_kind: 'daily' | 'interval'; days: number[]; time: string; interval_hours: number; interval_minutes?: number | null }, from = new Date()): string {
  return nextRun(r.schedule_kind, r.days, r.time, r.interval_hours, from, r.interval_minutes ?? null).toISOString();
}

export function createRoutine(i: NewRoutineInput): RoutineDto {
  validate(i);
  if (!i.name?.trim() || !i.prompt?.trim()) throw new Error(i.kind === 'command' ? 'Nome e o comando são obrigatórios.' : 'Nome e o que fazer são obrigatórios.');
  if (i.kind !== 'command' && !i.project_slug && !i.agent_id) throw new Error('Escolha um projeto ou um agente.');
  const r = { schedule_kind: i.schedule_kind ?? 'daily', days: i.days ?? [1, 2, 3, 4, 5], time: i.time ?? '08:00', interval_hours: i.interval_hours ?? 24, interval_minutes: i.interval_minutes ?? null };
  const { lastInsertRowid } = run(`insert into routines (name, agent_id, project_slug, repo_path, prompt, permission, size, schedule_kind, days, time,
      interval_hours, max_session, enabled, next_run_at, kind, shell, on_fail_agent, interval_minutes) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    i.name.trim(), i.kind === 'command' ? null : i.agent_id ?? null, i.project_slug || null, i.repo_path || null, i.prompt.trim(), i.permission === 'full' ? 'full' : 'edits', i.size ?? 'small',
    r.schedule_kind, r.days.join(','), r.time, r.interval_hours, i.max_session ?? 80, i.enabled === false ? 0 : 1, schedule(r),
    i.kind ?? 'agent', i.shell ?? '', i.on_fail_agent ?? null, r.interval_minutes);
  return getRoutine(Number(lastInsertRowid))!;
}

export function updateRoutine(id: number, patch: RoutinePatch): void {
  const cur = getRoutine(id);
  if (!cur) throw new Error('Rotina não encontrada.');
  validate(patch);
  const cols = ['name', 'agent_id', 'project_slug', 'repo_path', 'prompt', 'permission', 'size', 'schedule_kind', 'time', 'interval_hours', 'max_session', 'kind', 'shell', 'on_fail_agent', 'interval_minutes'] as const;
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
  // comando: roda direto no terminal, sem Claude (não olha a cota)
  if (r.kind === 'command') {
    const project = r.project_slug ? get<{ folder: string }>('select folder from projects where slug = ?', r.project_slug) : null;
    const cwd = r.repo_path || project?.folder || homedir();
    const runDto = startCommandRun({ project_slug: r.project_slug, cwd, command: r.prompt, shell: r.shell, routine_id: id, name: r.name }, emit, (out, code) => {
      warn(`Rotina "${r.name}" falhou`, `Código ${code ?? '?'}. ${out.split('\n').slice(-1)[0] ?? ''}`.slice(0, 180));
      const a = r.on_fail_agent ? getAgent(r.on_fail_agent) : null;
      if (a) startRun({
        project_slug: r.project_slug ?? a.project_slug, agent_id: a.id, repo_path: null, budget_usd: SIZE_BUDGET.small, permission: a.permission, proposal_id: null,
        prompt: `A rotina de comando "${r.name}" falhou (código ${code ?? '?'}).\n\nComando (rodado em ${cwd}):\n${r.prompt}\n\nFim da saída:\n${out.slice(-2500) || '(sem saída)'}\n\nInvestigue a causa. Se der para corrigir com segurança, corrija; se depender do Gustavo, crie uma decisão (create_decision) explicando.`,
      }, emit);
    });
    run('update routines set last_run_at = ?, last_skipped = null, next_run_at = ? where id = ?', now(), manual ? r.next_run_at : next, id);
    return runDto.id;
  }
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
    project_slug: r.project_slug, agent_id: r.agent_id, repo_path: r.repo_path, prompt, budget_usd: SIZE_BUDGET[r.size], permission: r.permission,
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

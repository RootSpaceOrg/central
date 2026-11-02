/**
 * Roadmap do projeto: marcos em Agora / Próximo / Depois (e Feito). Leve de propósito: sem datas obrigatórias, alvo livre.
 * O progresso vem das tarefas ligadas ao marco, direto (tasks.milestone_id) ou pelas ideias dele (ideas.milestone_id).
 */
import type { Horizon, MilestoneDto, MilestoneInput } from '../src/app/shared/contract';
import { all, get, now, run } from './db';

const HORIZONS: Horizon[] = ['now', 'next', 'later', 'done'];

const SELECT = `
  select m.*,
    (select count(*) from tasks t left join ideas i on i.id = t.idea_id where t.milestone_id = m.id or i.milestone_id = m.id) tasks,
    (select count(*) from tasks t left join ideas i on i.id = t.idea_id where (t.milestone_id = m.id or i.milestone_id = m.id) and t."column" = 'done') tasks_done,
    (select count(*) from ideas i where i.milestone_id = m.id and i.status <> 'archived') ideas
  from milestones m`;

export const listMilestones = (slug: string | null) =>
  all<MilestoneDto>(`${SELECT} where (? is null or m.project_slug = ?)
    order by case m.horizon when 'now' then 0 when 'next' then 1 when 'later' then 2 else 3 end, m.position, m.id`, slug, slug);

const one = (id: number) => get<MilestoneDto>(`${SELECT} where m.id = ?`, id);

function check(i: MilestoneInput): void {
  if (i.title !== undefined && !i.title.trim()) throw new Error('Dê um nome ao marco.');
  if (i.horizon && !HORIZONS.includes(i.horizon)) throw new Error('Horizonte inválido (now, next, later, done).');
}

export function createMilestone(slug: string, i: MilestoneInput): MilestoneDto {
  check(i);
  if (!i.title?.trim()) throw new Error('Dê um nome ao marco.');
  if (!get('select 1 from projects where slug = ?', slug)) throw new Error('Projeto não encontrado.');
  const horizon = i.horizon ?? 'next';
  const pos = (get<{ p: number | null }>('select max(position) p from milestones where project_slug = ? and horizon = ?', slug, horizon)?.p ?? -1) + 1;
  const id = Number(run('insert into milestones (project_slug, title, description, horizon, target, position) values (?,?,?,?,?,?)',
    slug, i.title.trim(), i.description?.trim() || null, horizon, i.target?.trim() || null, pos).lastInsertRowid);
  return one(id)!;
}

export function updateMilestone(id: number, i: MilestoneInput): void {
  check(i);
  const cur = one(id);
  if (!cur) throw new Error('Marco não encontrado.');
  const fields = (['title', 'description', 'horizon', 'target', 'position'] as const).filter(k => i[k] !== undefined);
  if (!fields.length) return;
  run(`update milestones set ${fields.map(k => `${k} = ?`).join(', ')} where id = ?`,
    ...fields.map(k => (typeof i[k] === 'string' ? (i[k] as string).trim() || (k === 'title' ? cur.title : null) : i[k] ?? null) as string | number | null), id);
  if (i.horizon === 'done' && cur.horizon !== 'done') run('update milestones set done_at = ? where id = ?', now(), id);
  if (i.horizon && i.horizon !== 'done') run('update milestones set done_at = null where id = ?', id);
}

export function deleteMilestone(id: number): void {
  run('update tasks set milestone_id = null where milestone_id = ?', id);
  run('update ideas set milestone_id = null where milestone_id = ?', id);
  run('delete from milestones where id = ?', id);
}

export function reorderMilestones(ids: number[], horizon: Horizon): void {
  if (!HORIZONS.includes(horizon)) throw new Error('Horizonte inválido.');
  run('begin');
  try {
    ids.forEach((id, pos) => run(`update milestones set position = ?, horizon = ?, done_at = case when ? = 'done' then coalesce(done_at, ?) else null end where id = ?`,
      pos, horizon, horizon, now(), id));
    run('commit');
  } catch (e) { run('rollback'); throw e; }
}

/** Para os prompts: o que está em Agora e Próximo, com progresso. */
export function roadmapBlock(slug: string): string {
  const ms = listMilestones(slug).filter(m => m.horizon === 'now' || m.horizon === 'next');
  if (!ms.length) return '';
  const line = (m: MilestoneDto) => `- [#${m.id}] ${m.title}${m.target ? ` (alvo: ${m.target})` : ''}${m.tasks ? ` · ${m.tasks_done}/${m.tasks} tarefas` : ''}`;
  const now_ = ms.filter(m => m.horizon === 'now'), next = ms.filter(m => m.horizon === 'next');
  return ['## Roadmap do projeto (ligue tarefas ao marco com milestone_id)',
    now_.length ? `Agora:\n${now_.map(line).join('\n')}` : '', next.length ? `Próximo:\n${next.map(line).join('\n')}` : ''].filter(Boolean).join('\n');
}

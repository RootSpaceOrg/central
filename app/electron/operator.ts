/**
 * Registro do operador: cada ação do Gustavo pela tela (decidir, revisar entrega, aprovar ideia, mudar rumo, mover tarefa)
 * fica guardada com o contexto e o motivo que ele deu. É a base de um futuro agente operador, e é daqui que saem os eventos
 * que acordam o dono do projeto (o que o Gustavo fez é sempre notícia para o dono).
 */
import { all, get, run } from './db';
import { emitEvent } from './owner';

export function logOperator(action: string, target: string, project: string | null, context: string, reason: string | null = null): void {
  run('insert into operator_actions (action, target, project_slug, context, reason) values (?,?,?,?,?)',
    action, target, project, context.replace(/\s+/g, ' ').slice(0, 1000), reason?.trim() || null);
}

export const listOperatorActions = (project: string | null, limit = 100) => all<{ id: number; at: string; action: string; target: string; project_slug: string | null; context: string; reason: string | null }>(
  `select * from operator_actions where (? is null or project_slug = ?) order by id desc limit ?`, project, project, limit);

/** decisão respondida pela tela */
export function onDecided(id: number, verdict: string, reason: string | null): void {
  const p = get<{ project_slug: string | null; title: string; task_id: number | null }>('select project_slug, title, task_id from proposals where id = ?', id);
  if (!p) return;
  logOperator(`decisão: ${verdict}`, `decisão #${id}`, p.project_slug, p.title, reason);
  // escolha sobre uma tarefa volta para a própria tarefa (o time segue); decisão solta é notícia para o dono
  const linked = p.task_id || get('select 1 from proposal_tasks where proposal_id = ?', id);
  if (!linked && verdict !== 'defer') emitEvent(p.project_slug, 'decisao_respondida', `decisao:${id}`, `#${id} ${verdict === 'approve' ? 'APROVADA' : 'RECUSADA'}: ${p.title}${reason ? ` — Gustavo: ${reason}` : ''}`);
}

/** entrega revisada pela tela: validou ou devolveu (história ou tarefa) */
export function onReviewed(deliveryId: number, action: string, note: string | null): void {
  const d = get<{ task_id: number | null; project_slug: string | null; title: string; run_id: number }>('select task_id, project_slug, title, run_id from deliveries where id = ?', deliveryId);
  if (!d) return;
  const story = !!d.task_id && !!get('select 1 from tasks where parent_id = ?', d.task_id);
  const title = d.task_id ? get<{ t: string }>('select title t from tasks where id = ?', d.task_id)?.t ?? d.title : d.title;
  logOperator(`${story ? 'história' : 'entrega'}: ${action}`, d.task_id ? `tarefa #${d.task_id}` : `entrega #${deliveryId}`, d.project_slug, title, note);
  const ref = d.task_id ? `tarefa:${d.task_id}` : `entrega:${deliveryId}`;
  if (action === 'accepted' && story) emitEvent(d.project_slug, 'historia_validada', ref, `#${d.task_id} ${title}`);
  if (action === 'adjusting') emitEvent(d.project_slug, story ? 'historia_devolvida' : 'entrega_devolvida', `${ref}:${d.run_id}:${Date.now()}`,
    `#${d.task_id ?? '-'} ${title}${note ? ` — Gustavo: ${note}` : ''}`);
}

export function onIdea(id: number, status: string | undefined): void {
  if (!status) return;
  const i = get<{ project_slug: string | null; title: string; body: string | null }>('select project_slug, title, body from ideas where id = ?', id);
  if (!i) return;
  logOperator(`ideia: ${status}`, `ideia #${id}`, i.project_slug, i.title);
  if (status === 'approved') emitEvent(i.project_slug, 'ideia_aprovada', `ideia:${id}`, `#${id} ${i.title}${i.body ? `: ${i.body.slice(0, 300)}` : ''}`);
}

export function onDirection(slug: string, note: string | null): void {
  logOperator('rumo: atualizado', `rumo ${slug}`, slug, 'O Gustavo reescreveu o rumo do projeto.', note);
  emitEvent(slug, 'rumo_atualizado', `rumo:${Date.now()}`, `O Gustavo atualizou o rumo${note ? `: ${note}` : ''}. Releia (get_direction) e alinhe o backlog.`);
}

export function onTaskMoved(id: number, column: string | undefined): void {
  if (!column) return;
  const t = get<{ project_slug: string | null; title: string }>('select project_slug, title from tasks where id = ?', id);
  if (t) logOperator(`tarefa: ${column}`, `tarefa #${id}`, t.project_slug, t.title);
}

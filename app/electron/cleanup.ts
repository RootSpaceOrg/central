/**
 * Faxina do dono: decisões e revisões que não precisam mais do Gustavo saem da frente dele, sempre com o motivo e quem
 * fechou, e dá para reabrir. O crítico (produção com impacto no usuário, dinheiro, dados de cliente, comunicação com
 * cliente, rumo) o dono não decide: só fecha se já foi resolvido por outro caminho, ou atualiza o resumo.
 */
import { decide, moveTaskForRun } from './backlog';
import { all, get, now, run } from './db';
import { ghMerge } from './stories';

const by = (agentId: number | null) => (agentId ? get<{ name: string }>('select name from agents where id = ?', agentId)?.name : null) ?? 'dono';

/** resolvida (aconteceu por outro caminho), repetida ou superada (outra decisão cobre): sai da Triagem com o motivo */
export function closeDecision(id: number, how: 'resolvida' | 'repetida' | 'superada', why: string, agentId: number | null, keepId?: number | null): string {
  const p = get<{ status: string; title: string }>('select status, title from proposals where id = ?', id);
  if (!p) throw new Error('Decisão não encontrada.');
  if (p.status !== 'proposed') return `A decisão #${id} já não está aberta (${p.status}).`;
  if (!why.trim()) throw new Error('Diga o motivo (o que resolveu, ou qual decisão cobre esta).');
  if (keepId && keepId !== id) run('insert or ignore into proposal_tasks (proposal_id, task_id) select ?, task_id from proposals where id = ? and task_id is not null', keepId, id);
  run(`update proposals set status = 'done', closed_by = ?, closed_how = ?, closed_reason = ?, closed_at = ?, updated_at = ? where id = ?`,
    by(agentId), how, `${why.trim()}${keepId ? ` (fica a #${keepId})` : ''}`, now(), now(), id);
  return `Decisão #${id} fechada (${how}). O Gustavo vê no seu painel e pode reabrir.`;
}

/** escolha que não é crítica: o dono decide dentro do rumo (a resposta segue o mesmo caminho da do Gustavo) */
export function ownerDecide(id: number, choice: string, why: string, agentId: number | null): string {
  const p = get<{ status: string }>('select status from proposals where id = ?', id);
  if (!p) throw new Error('Decisão não encontrada.');
  if (p.status !== 'proposed') return `A decisão #${id} já não está aberta (${p.status}).`;
  const name = by(agentId);
  decide(id, 'approve', `Decidido por ${name} (não crítico): ${choice.trim()}. Por quê: ${why.trim()}`);
  run(`update proposals set closed_by = ?, closed_how = 'decidida', closed_reason = ?, closed_at = ? where id = ?`, name, `${choice.trim()} — ${why.trim()}`, now(), id);
  return `Decidi a #${id}: ${choice.trim()}. Fica no seu painel com o motivo; o Gustavo pode reabrir.`;
}

/** decisão crítica que continua valendo: o resumo passa a dizer o estado de hoje, para ele decidir rápido */
export function refreshDecision(id: number, summary: string, nextAction: string | null): string {
  if (!get('select 1 from proposals where id = ? and status = ?', id, 'proposed')) throw new Error('Decisão aberta não encontrada.');
  run('update proposals set summary = ?, next_action = coalesce(?, next_action), updated_at = ? where id = ?', summary.trim().split('\n')[0].slice(0, 300), nextAction?.trim() || null, now(), id);
  return `Resumo da #${id} atualizado.`;
}

/**
 * Revisão que não precisa mais do Gustavo: resolvida (já entrou, já foi feito), superada (outra entrega cobre) ou
 * mergear (código pronto e seguro: entra em develop, como as partes de história; nunca main).
 */
export async function closeReview(deliveryId: number, how: 'resolvida' | 'superada' | 'mergear', why: string, agentId: number | null): Promise<string> {
  const d = get<{ status: string; task_id: number | null; pr_url: string | null; title: string }>('select status, task_id, pr_url, title from deliveries where id = ?', deliveryId);
  if (!d) throw new Error('Entrega não encontrada.');
  if (!['review', 'pending'].includes(d.status)) return `A entrega #${deliveryId} já não está na revisão (${d.status}).`;
  if (!why.trim()) throw new Error('Diga o motivo.');
  // história (tarefa com partes) é do Gustavo: ele valida como usuário
  if (d.task_id && get('select 1 from tasks where parent_id = ?', d.task_id)) return 'É uma história: quem valida é o Gustavo, como usuário. Não feche.';
  if (how === 'mergear') {
    if (!d.pr_url) return 'Essa entrega não tem PR: use resolvida ou superada.';
    const err = await ghMerge(d.pr_url);
    if (err) return `Não deu para mergear: ${err}. Deixe na revisão (ou peça o conserto ao tech lead).`;
  }
  run(`update deliveries set status = 'accepted', reviewed_at = ?, review_note = ?, closed_by = ?, closed_how = ? where id = ?`,
    now(), `Fechada por ${by(agentId)} (${how}): ${why.trim()}`, by(agentId), how, deliveryId);
  if (d.task_id) {
    const prod = !!get(`select 1 from tasks t join projects p on p.slug = t.project_slug where t.id = ? and p.done_when = 'prod'`, d.task_id);
    const col = get<{ c: string }>('select "column" c from tasks where id = ?', d.task_id)?.c;
    if (col && !['done', 'dev'].includes(col)) moveTaskForRun(d.task_id, how === 'mergear' && prod ? 'dev' : 'done');
  }
  return `Entrega #${deliveryId} fechada (${how}). O Gustavo vê no seu painel e pode reabrir.`;
}

/** o Gustavo discordou: volta para ele */
export function reopenDecision(id: number): void {
  run(`update proposals set status = 'proposed', closed_by = null, closed_how = null, closed_reason = null, closed_at = null, updated_at = ? where id = ? and closed_by is not null`, now(), id);
}
export function reopenReview(id: number): void {
  run(`update deliveries set status = 'review', reviewed_at = null, review_note = null, closed_by = null, closed_how = null where id = ? and closed_by is not null`, id);
}

/** o que os agentes fecharam por ele num projeto (padrão: últimas 48 h) */
export function closedBy(slug: string, hours = 48) {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  return {
    decisions: all<{ id: number; title: string; closed_by: string; closed_how: string; closed_reason: string; closed_at: string }>(
      `select id, title, closed_by, closed_how, closed_reason, closed_at from proposals where project_slug = ? and closed_by is not null and closed_at > ? order by closed_at desc`, slug, since),
    reviews: all<{ id: number; title: string; closed_by: string; closed_how: string; review_note: string; reviewed_at: string }>(
      `select id, title, closed_by, closed_how, review_note, reviewed_at from deliveries where project_slug = ? and closed_by is not null and reviewed_at > ? order by reviewed_at desc`, slug, since),
  };
}

/** há decisão ou revisão do projeto parada há mais de um dia (vira o evento "fila parada", no máximo uma vez por dia) */
export function staleQueue(slug: string): { decisions: number; reviews: number } {
  const day = new Date(Date.now() - 24 * 3_600_000).toISOString();
  return {
    decisions: get<{ n: number }>(`select count(*) n from proposals where project_slug = ? and status = 'proposed' and created_at < ?`, slug, day)!.n,
    reviews: get<{ n: number }>(`select count(*) n from deliveries where project_slug = ? and status = 'review' and created_at < ?`, slug, day)!.n,
  };
}

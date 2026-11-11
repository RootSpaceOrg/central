/**
 * Dono do projeto: o agente que responde pelo resultado de um projeto, dentro do rumo aprovado pelo Gustavo. Não fica preso
 * a horário: a Central registra eventos (história validada ou devolvida, execução que falhou, decisão respondida, ideia
 * aprovada, insight de cliente ou reunião, fila vazia, alerta de outro agente) e acorda o dono com o lote. Ele age no que
 * está no rumo, escala para o Gustavo só o que é crítico e escreve o diário (o que fez e por quê).
 * Travas: liga por projeto (desligado não acorda; ligar ignora o que já tinha), debounce, evento repetido conta uma vez,
 * no máximo N passadas por dia, uma por vez, e o que o próprio dono emite não o acorda de novo.
 */
import { all, get, run } from './db';
import { PRIORITY_OF, Priority, canStart } from './governor';

export const OWNER_HEAD = '[dono]';
/** espera os eventos juntarem antes de acordar (urgente acorda na hora) */
const DEBOUNCE_MIN = 10;
const MAX_PER_DAY_DEFAULT = 10;
/** fila vazia avisa no máximo uma vez a cada tantas horas */
const IDLE_EVERY_H = 20;

export type EventKind =
  | 'historia_validada' | 'historia_devolvida' | 'entrega_devolvida' | 'execucao_falhou' | 'decisao_respondida'
  | 'ideia_aprovada' | 'insight' | 'fila_vazia' | 'rumo_atualizado' | 'alerta' | 'memoria_cresceu';

const LABEL: Record<EventKind, string> = {
  historia_validada: 'história validada pelo Gustavo', historia_devolvida: 'história DEVOLVIDA pelo Gustavo ("não funcionou")',
  entrega_devolvida: 'entrega devolvida pelo Gustavo (pediu ajuste)', execucao_falhou: 'execução falhou',
  decisao_respondida: 'decisão respondida pelo Gustavo', ideia_aprovada: 'ideia aprovada pelo Gustavo (planejar)',
  insight: 'insight (cliente, conversa ou reunião)', fila_vazia: 'fila do projeto vazia', rumo_atualizado: 'rumo atualizado',
  alerta: 'alerta de outro agente', memoria_cresceu: 'memória do projeto cresceu (curadoria)',
};
const URGENT: EventKind[] = ['historia_devolvida', 'alerta'];

/** execução que é uma passada do dono (o que ela emite não acorda o dono de novo) */
export const isOwnerRun = (runId: number | null | undefined) =>
  !!runId && !!get('select 1 from runs where id = ? and prompt like ?', runId, `${OWNER_HEAD}%`);

/**
 * Registra um evento do projeto. Repetido (mesmo tipo e referência ainda não visto) conta uma vez. Projeto sem dono também
 * registra (a tela mostra), só não acorda ninguém.
 */
export function emitEvent(slug: string | null | undefined, kind: EventKind, ref: string, summary: string, fromRun: number | null = null): void {
  if (!slug || !get('select 1 from projects where slug = ?', slug)) return;
  run(`insert or ignore into events (project_slug, kind, ref, summary, urgent, from_owner) values (?,?,?,?,?,?)`,
    slug, kind, ref, summary.replace(/\s+/g, ' ').trim().slice(0, 600), URGENT.includes(kind) ? 1 : 0, isOwnerRun(fromRun) ? 1 : 0);
}

/** liga/desliga o dono por eventos. Ligar marca o que já estava pendente como visto (não acorda com o passado). */
export function setOwnerOn(slug: string, on: boolean): void {
  const at = new Date().toISOString();
  if (on) run(`update events set handled_at = ? where project_slug = ? and handled_at is null`, at, slug);
  run('update projects set owner_on = ? where slug = ?', on ? 1 : 0, slug);
}

const maxPerDay = (setting: (k: string) => string | null) => Math.max(1, Number(setting('owner:max_per_day')) || MAX_PER_DAY_DEFAULT);

export interface OwnerDeps {
  quota: () => Promise<number | null>;
  setting: (key: string) => string | null;
  setSetting?: (key: string, value: string) => void;
  now?: () => Date;
  start: (input: { project_slug: string; agent_id: number; prompt: string }) => number | void;
}

/** Acorda os donos que têm eventos novos (e avisa "fila vazia" de quem ficou sem trabalho). Devolve quantos acordou. */
export async function dispatchOwners(deps: OwnerDeps): Promise<number> {
  const owners = all<{ slug: string; agent: number; priority: string; name: string }>(
    `select p.slug, p.todo_agent_id agent, a.priority, p.name from projects p join agents a on a.id = p.todo_agent_id
     where p.owner_on = 1 and p.status <> 'dead'`);
  if (!owners.length) return 0;
  const now = deps.now?.() ?? new Date();
  const iso = now.toISOString();
  let used: number | null | undefined;
  let woke = 0;
  for (const o of owners) {
    // o que veio de uma passada do próprio dono só fica registrado
    run(`update events set handled_at = ? where project_slug = ? and handled_at is null and from_owner = 1`, iso, o.slug);
    idleCheck(o.slug, now);
    memoryCheck(o.slug, deps);
    const evs = all<{ id: number; kind: EventKind; ref: string; summary: string; urgent: number; created_at: string }>(
      `select id, kind, ref, summary, urgent, created_at from events where project_slug = ? and handled_at is null order by id limit 30`, o.slug);
    if (!evs.length) continue;
    if (get(`select 1 from runs where project_slug = ? and prompt like ? and status in ('queued','preparing','running')`, o.slug, `${OWNER_HEAD}%`)) continue;
    const oldest = Date.parse(evs[0].created_at.endsWith('Z') ? evs[0].created_at : `${evs[0].created_at}Z`);
    if (!evs.some(e => e.urgent) && now.getTime() - oldest < DEBOUNCE_MIN * 60_000) continue;
    const today = get<{ n: number }>(`select count(*) n from runs where project_slug = ? and prompt like ? and created_at > ?`,
      o.slug, `${OWNER_HEAD}%`, new Date(now.getTime() - 24 * 3_600_000).toISOString())!.n;
    if (today >= maxPerDay(deps.setting)) continue;
    used ??= await deps.quota();
    if (!canStart((PRIORITY_OF[o.priority] ?? 1) as Priority, { session: used, week: null, sessionReset: null, weekReset: null })) continue;
    const runId = deps.start({ project_slug: o.slug, agent_id: o.agent, prompt: ownerPrompt(o.slug, o.name, evs) });
    run(`update events set handled_at = ?, pass_run_id = ? where id in (${evs.map(e => e.id).join(',')})`, iso, typeof runId === 'number' ? runId : null);
    woke++;
  }
  return woke;
}

/** projeto sem nada em A fazer, fazendo ou revisão (nem história andando): o dono puxa o próximo passo do rumo */
function idleCheck(slug: string, now: Date): void {
  const busy = get(`select 1 from tasks where project_slug = ? and "column" in ('todo','doing','review')`, slug);
  if (busy) return;
  const last = get<{ at: string }>(`select max(created_at) at from events where project_slug = ? and kind = 'fila_vazia'`, slug)?.at;
  if (last && now.getTime() - Date.parse(last.endsWith('Z') ? last : `${last}Z`) < IDLE_EVERY_H * 3_600_000) return;
  emitEvent(slug, 'fila_vazia', now.toISOString().slice(0, 13), 'Nada em A fazer, fazendo ou revisão: o time está parado.');
}

/** a cada CURATE_EVERY registros novos (fatos do projeto + memórias dos agentes dele), o dono faz uma curadoria */
const CURATE_EVERY = 25;
function memoryCheck(slug: string, deps: OwnerDeps): void {
  const n = get<{ n: number }>(`select (select count(*) from facts where project_slug = ?) +
    (select count(*) from memories m join agents g on g.id = m.agent_id where g.project_slug = ?) n`, slug, slug)!.n;
  const key = `owner:curated:${slug}`;
  const last = Number(deps.setting(key) ?? -1);
  if (last < 0) { deps.setSetting?.(key, String(n)); if (n < CURATE_EVERY * 2) return; }
  else if (n - last < CURATE_EVERY) return;
  deps.setSetting?.(key, String(n));
  emitEvent(slug, 'memoria_cresceu', `memoria:${n}`, `${n} registros entre a memória do projeto e a dos agentes dele: hora da curadoria.`);
}

const counts = (slug: string) => {
  const c = all<{ c: string; n: number }>(`select "column" c, count(*) n from tasks where project_slug = ? and parent_id is null group by 1`, slug);
  return ['backlog', 'todo', 'doing', 'review', 'dev'].map(k => `${k} ${c.find(x => x.c === k)?.n ?? 0}`).join(', ');
};

export function ownerPrompt(slug: string, name: string, evs: { kind: EventKind; ref: string; summary: string; created_at: string }[]): string {
  const hhmm = (iso: string) => new Date(iso.endsWith('Z') ? iso : `${iso}Z`).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const decisions = get<{ n: number }>(`select count(*) n from proposals where project_slug = ? and status = 'proposed'`, slug)!.n;
  return `${OWNER_HEAD} ${name}: ${evs.length === 1 ? LABEL[evs[0].kind] : `${evs.length} eventos`}

Você é o DONO do projeto ${name} (slug ${slug}): responde pelo resultado dele, dentro do rumo que o Gustavo aprovou. Ele é o
diretor: aprova o rumo e valida histórias como usuário final. Todo o resto é com você e com o time do projeto.
A Central te acordou por isto:
${evs.map(e => `- ${hhmm(e.created_at)} ${LABEL[e.kind]} [${e.ref}]: ${e.summary}`).join('\n')}

Estado agora: tarefas soltas e histórias por coluna: ${counts(slug)}; decisões esperando o Gustavo: ${decisions}.
Leia antes o que precisar: get_direction (rumo), list_milestones, list_tasks, list_deliveries, list_decisions, memory_recall.

O que fazer (só com as ferramentas da Central; nesta passada você não edita código nem roda o produto):
1. Para cada evento, decida: agir, registrar ou escalar.
   - Trabalho dentro do rumo: aja. Trabalho novo é uma história (create_task, título = o que o usuário vai conseguir fazer)
     com as partes (create_task parent_id) e a história em "todo": o time executa sozinho. Ideia aprovada: planeje assim.
   - Erro (história devolvida, entrega devolvida, execução que falhou): descubra a causa (list_deliveries, a execução, a nota
     do Gustavo), ponha o conserto em andamento (parte nova na história, column todo) e faça quem errou aprender: regra nova
     nas instruções dele (get_agent, update_agent instructions_append) ou fato do projeto (memory_remember). Se quebrou
     produção: o primeiro passo é reverter (tarefa prioridade 0 de revert/hotfix), depois o resto.
   - Insight: brincadeira, conversa solta ou ruído → ignore. Pequeno e no rumo → aja. Impactante (muda rumo, preço,
     cobrança, dados de cliente, comunicação com cliente, produção que não é hotfix) → create_idea com triage
     "precisa do operador — <motivo>". O que pode mudar o rumo: guarde como fato do projeto (memory_remember kind decision);
     quando os sinais se somarem (vários insights, números, devoluções apontando para o mesmo lado), proponha o rumo novo
     com propose_direction (o Gustavo aprova ou não). Nunca troque o rumo direto.
   - Fila vazia: puxe o próximo passo do rumo e do marco atual (no máximo 2 histórias).
   - Memória cresceu (curadoria): a memória do projeto é uma só. Leia a do projeto (memory_recall, limit 30, algumas buscas)
     e a dos agentes do projeto (list_agent_memories). O que é sobre o projeto e está na memória de um agente:
     move_memory_to_project. Fatos repetidos ou que se contradizem: fique com o certo e aposente os outros com
     memory_supersede (motivo + substituto). Nada se apaga: tudo fica com o motivo. Não mexa no que é jeito de trabalhar.
2. Interrompa o Gustavo (create_decision) SÓ no crítico: produção com impacto no usuário que não seja hotfix, dinheiro,
   dados de cliente, comunicação com cliente, mudança de rumo. Mudança de tela, ajuste, bug, dev: decida você.
3. Time (agentes, quadros, rotinas): mude quando o Gustavo pediu. Por iniciativa sua, proponha com create_decision.
4. Limites: no máximo 3 histórias novas por passada; antes de criar, confira se já existe (list_tasks).
Mediu algum número do produto (uso, receita, publicados, erros)? report_metric: é o que o Gustavo acompanha no Início.
Antes de decidir algo parecido com o que ele já decidiu, veja o critério dele: operator_history.
Termine com o DIÁRIO (é o que o Gustavo lê): até 5 linhas "o que fiz e por quê" e, para cada erro, um post-mortem de 3
linhas (o que houve, por quê, o que mudou). Não chame report_delivery.`;
}

/** diário do dono: as últimas passadas com o resultado */
export const ownerDiary = (slug: string, limit = 20) => all<{ id: number; status: string; created_at: string; finished_at: string | null; prompt: string; result: string | null }>(
  `select id, status, created_at, finished_at, substr(prompt, 1, 200) prompt, result from runs where project_slug = ? and prompt like ? order by created_at desc, id desc limit ?`,
  slug, `${OWNER_HEAD}%`, limit);
export const pendingEvents = (slug: string) => all<{ id: number; kind: string; summary: string; created_at: string }>(
  `select id, kind, summary, created_at from events where project_slug = ? and handled_at is null order by id`, slug);

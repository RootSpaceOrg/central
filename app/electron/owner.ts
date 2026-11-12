/**
 * Dono do projeto: o agente que responde pelo resultado de um projeto, dentro do rumo aprovado pelo Gustavo. Não fica preso
 * a horário: a Central registra eventos (história validada ou devolvida, execução que falhou, decisão respondida, ideia
 * aprovada, insight de cliente ou reunião, fila vazia, alerta de outro agente) e acorda o dono com o lote. Ele age no que
 * está no rumo, escala para o Gustavo só o que é crítico e escreve o diário (o que fez e por quê).
 * Travas: liga por projeto (desligado não acorda; ligar ignora o que já tinha), debounce, evento repetido conta uma vez,
 * no máximo N passadas por dia, uma por vez, e o que o próprio dono emite não o acorda de novo.
 */
import { all, get, run } from './db';
import { dueMetrics } from './metrics';
import { PRIORITY_OF, Priority, canStart } from './governor';

export const OWNER_HEAD = '[dono]';
/** o dono de um projeto em SQL (alias p = projects): o de negócio; sem ele, quem executa (tech lead) faz os dois papéis */
export const OWNER_OF = 'coalesce(p.owner_agent_id, p.todo_agent_id)';
/** espera os eventos juntarem antes de acordar (urgente acorda na hora) */
const DEBOUNCE_MIN = 10;
const MAX_PER_DAY_DEFAULT = 10;
/** fila vazia avisa no máximo uma vez a cada tantas horas */
const IDLE_EVERY_H = 20;

export type EventKind =
  | 'historia_validada' | 'historia_devolvida' | 'entrega_devolvida' | 'execucao_falhou' | 'decisao_respondida'
  | 'ideia_aprovada' | 'insight' | 'fila_vazia' | 'rumo_atualizado' | 'alerta' | 'memoria_cresceu' | 'dono_ligado' | 'medir' | 'fila_parada' | 'ronda';

const LABEL: Record<EventKind, string> = {
  historia_validada: 'história validada pelo Gustavo', historia_devolvida: 'história DEVOLVIDA pelo Gustavo ("não funcionou")',
  entrega_devolvida: 'entrega devolvida pelo Gustavo (pediu ajuste)', execucao_falhou: 'execução falhou',
  decisao_respondida: 'decisão respondida pelo Gustavo', ideia_aprovada: 'ideia aprovada pelo Gustavo (planejar)',
  insight: 'insight (cliente, conversa ou reunião)', fila_vazia: 'fila do projeto vazia', rumo_atualizado: 'rumo atualizado',
  alerta: 'alerta de outro agente', memoria_cresceu: 'memória do projeto cresceu (curadoria)', dono_ligado: 'você virou o dono que age sozinho (primeira passada)', medir: 'hora de medir os números combinados', fila_parada: 'decisões ou revisões paradas esperando o Gustavo (faxina)', ronda: 'o Gustavo pediu: vá procurar trabalho (ronda)',
};
const URGENT: EventKind[] = ['historia_devolvida', 'alerta', 'dono_ligado', 'ronda'];

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

/** quem mostra o alerta crítico fora da Central (WhatsApp, Windows): o main liga */
let alertOut: (title: string, body: string) => void = () => {};
export const onCriticalAlert = (fn: typeof alertOut) => { alertOut = fn; };

/** quebrou de verdade: fica no cockpit (vermelho) e sai para o Gustavo (Windows e WhatsApp), uma vez por referência */
export function criticalAlert(slug: string, summary: string, ref: string): void {
  if (!get('select 1 from projects where slug = ?', slug)) return;
  if (get(`select 1 from alerts where project_slug = ? and ref = ? and resolved_at is null`, slug, ref)) return;
  run('insert into alerts (project_slug, ref, summary) values (?,?,?)', slug, ref, summary.slice(0, 600));
  const name = get<{ name: string }>('select name from projects where slug = ?', slug)?.name ?? slug;
  alertOut(`${name}: algo quebrou`, summary.slice(0, 300));
}
export const resolveAlert = (id: number) => run('update alerts set resolved_at = ? where id = ?', new Date().toISOString(), id);

/** liga/desliga o dono por eventos. Ligar marca o que já estava pendente como visto (não acorda com o passado). */
export function setOwnerOn(slug: string, on: boolean): void {
  const at = new Date().toISOString();
  if (on) run(`update events set handled_at = ? where project_slug = ? and handled_at is null`, at, slug);
  run('update projects set owner_on = ? where slug = ?', on ? 1 : 0, slug);
  // o dono cuida do backlog por evento: as revisões por horário do antigo Time (Agência) param, para não serem dois
  if (on) run(`update routines set enabled = 0 where project_slug = ? and name in ('Agência: backlog do dia', 'Agência: revisão da semana')`, slug);
  if (on) emitEvent(slug, 'dono_ligado', `ligado:${at}`, 'Primeira passada: organize o projeto para andar sozinho.');
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
    `select p.slug, ${OWNER_OF} agent, a.priority, p.name from projects p join agents a on a.id = ${OWNER_OF}
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
    metricsCheck(o.slug, now);
    staleCheck(o.slug, now);
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

/** decisões ou revisões do produto paradas há mais de um dia: o dono faz a faxina (no máximo uma vez a cada 20 h) */
function staleCheck(slug: string, now: Date): void {
  const day = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const d = get<{ n: number }>(`select count(*) n from proposals where project_slug = ? and status = 'proposed' and created_at < ?`, slug, day)!.n;
  const r = get<{ n: number }>(`select count(*) n from deliveries where project_slug = ? and status = 'review' and created_at < ?`, slug, day)!.n;
  if (!d && !r) return;
  const last = get<{ at: string }>(`select max(created_at) at from events where project_slug = ? and kind = 'fila_parada'`, slug)?.at;
  if (last && now.getTime() - Date.parse(last.endsWith('Z') ? last : `${last}Z`) < 20 * 3_600_000) return;
  emitEvent(slug, 'fila_parada', `parada:${now.toISOString().slice(0, 13)}`, `${d} ${d === 1 ? 'decisão' : 'decisões'} e ${r} ${r === 1 ? 'revisão' : 'revisões'} esperando o Gustavo há mais de um dia.`);
}

/** números combinados vencidos: o dono mede (um evento por rodada de medida) */
function metricsCheck(slug: string, now: Date): void {
  const due = dueMetrics(slug, now.getTime());
  if (due.length) emitEvent(slug, 'medir', `medir:${due.map(d => d.id).join(',')}:${now.toISOString().slice(0, 13)}`,
    `Medir: ${due.map(d => `${d.name} (${d.how.slice(0, 120)})`).join('; ')}.`);
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

/** o time pelos papéis: o dono, quem executa (tech lead) e os outros agentes do projeto */
function teamBlock(slug: string): string {
  const p = get<{ owner: number | null; tech: number | null }>('select owner_agent_id owner, todo_agent_id tech from projects where slug = ?', slug);
  const name = (id: number | null | undefined) => (id ? get<{ name: string }>('select name from agents where id = ?', id)?.name ?? null : null);
  const tech = name(p?.tech);
  const others = all<{ name: string; description: string | null }>(`select name, description from agents where project_slug = ? and id not in (?, ?) order by name`, slug, p?.owner ?? 0, p?.tech ?? 0);
  return `Seu time, por papel:
- Tech lead (quem executa o A fazer: quebra histórias em partes, cuida do técnico e testa a história como usuário): ${tech ? (p?.tech === p?.owner || !p?.owner ? `${tech} (você mesmo: o produto ainda não tem um dono só de negócio)` : tech) : 'NINGUÉM. As histórias em A fazer esperam alguém executar. Se fizer falta, sugira ao Gustavo uma vez (create_decision), sem insistir; ele pode preferir assim.'}
${others.length ? others.map(o => `- ${o.name}${o.description ? `: ${o.description.slice(0, 140)}` : ''}`).join('\n') : '- (sem outros agentes no projeto)'}
Você cuida do o quê e do por quê (usuário, rumo, números, prioridade); o como é do tech lead. Antes de prometer prazo ou
esforço, pergunte a ele (notify_agent).`;
}

const counts = (slug: string) => {
  const c = all<{ c: string; n: number }>(`select "column" c, count(*) n from tasks where project_slug = ? and parent_id is null group by 1`, slug);
  return ['backlog', 'todo', 'doing', 'review', 'dev'].map(k => `${k} ${c.find(x => x.c === k)?.n ?? 0}`).join(', ');
};

/** a faxina: o que está esperando o Gustavo e não precisa mais dele sai da frente, sempre com o motivo */
export const CLEANUP = `   - Faxina (ajude o Gustavo ao máximo: ele quer ver só o que é dele). Leia as decisões abertas do produto
     (list_decisions) e as revisões (list_deliveries status review). Para cada uma, confira no backlog, nas entregas e no
     código o estado de HOJE e:
     • já resolvida por outro caminho (o PR entrou, a tarefa andou, alguém respondeu): close_decision / close_review
       "resolvida", dizendo o que resolveu (cite #tarefa, PR ou entrega);
     • repetida ou superada por uma mais nova: close_decision "repetida"/"superada" com keep_id, ou close_review "superada";
     • escolha NÃO crítica que cabe no rumo (ex.: qual de dois jeitos fazer, se pode seguir com algo de dev): owner_decide
       com a escolha e o porquê;
     • revisão de código pronto e seguro (só develop, testes passando, sem mudança que o usuário note em produção):
       close_review "mergear";
     • CRÍTICA (produção com impacto no usuário, dinheiro, dados de cliente, comunicação com cliente, rumo) e ainda
       valendo: NÃO decida; refresh_decision com o estado de hoje em uma linha ("ainda vale porque…").
     Na dúvida, deixe para ele. No diário, liste o que fechou e por quê.`;

/** só as instruções dos tipos de evento que vieram (o resto é ruído na passada) */
const GUIDE: [EventKind[], string][] = [
  [['ideia_aprovada', 'historia_validada', 'decisao_respondida', 'rumo_atualizado', 'alerta', 'insight', 'fila_vazia', 'dono_ligado'],
    `   - Trabalho dentro do rumo: aja. Trabalho novo é uma história (create_task, título = o que o usuário vai conseguir fazer)
     com as partes (create_task parent_id) e a história em "todo": o time executa sozinho. Ideia aprovada: planeje assim.`],
  [['historia_devolvida', 'entrega_devolvida', 'execucao_falhou', 'alerta'],
    `   - Erro (história devolvida, entrega devolvida, execução que falhou, alerta): descubra a causa (list_deliveries, a
     execução, a nota do Gustavo), ponha o conserto em andamento (parte nova na história, column todo) e faça quem errou
     aprender: regra nova nas instruções dele (get_agent, update_agent instructions_append) ou fato do projeto
     (memory_remember). Se quebrou produção: o primeiro passo é reverter (tarefa prioridade 0 de revert/hotfix).`],
  [['insight'],
    `   - Insight: brincadeira, conversa solta ou ruído → ignore. Pequeno e no rumo → aja. Impactante (muda rumo, preço,
     cobrança, dados de cliente, comunicação com cliente, produção que não é hotfix) → create_idea com triage
     "precisa do operador — <motivo>". O que pode mudar o rumo: guarde como fato do projeto (memory_remember kind decision);
     quando os sinais se somarem (vários insights, números, devoluções apontando para o mesmo lado), proponha o rumo novo
     com propose_direction (o Gustavo aprova ou não). Nunca troque o rumo direto.`],
  [['fila_vazia'], `   - Fila vazia: puxe o próximo passo do rumo e do marco atual (no máximo 2 histórias).`],
  [['medir'], `   - Medir: para cada número da lista, busque o valor de onde foi combinado (list_metrics mostra como) e registre com
     report_metric (mesmo nome). Não conseguiu medir? Diga no diário por quê e o que falta (acesso, consulta).`],
  [['dono_ligado'],
    `   - Primeira passada: (a) agrupe o backlog em histórias: tarefas soltas que entregam a mesma coisa ao usuário viram
     partes de uma história (crie a história e use update_task parent_id; até 12 partes; títulos de usuário); tarefas
     repetidas: fique com uma e mova as outras para done dizendo "duplicada da #N". (b) Olhe o time (list_agents,
     list_boards, list_routines): o que está repetido, sem uso ou amarrado a horário sem precisar (ex.: a mesma rotina
     copiada várias vezes) vira UMA proposta de simplificação (create_decision com o antes e o depois). (c) Ponha o próximo
     passo do rumo para andar. O limite de 3 histórias novas não vale para agrupar o que já existe.`],
  [['fila_parada', 'dono_ligado', 'ronda'], CLEANUP],
  [['ronda'],
    `   - Ronda (o Gustavo pediu que você vá procurar trabalho; olhe tudo, nesta ordem, e aja no que couber):
     a) Backlog (list_tasks): o que está em "backlog" e cabe no rumo e no marco atual sobe para "todo" (como história,
        com as partes); o repetido vira um só ("duplicada da #N"); o que saiu do rumo vai para done com o motivo.
     b) Revisão (list_deliveries status review): o que você consegue validar por ele (código só em develop, seguro, o
        teste da entrega bate com o que mudou) fecha com close_review "mergear"; o resto fica, com refresh se precisar.
     c) Rumo (get_direction): ainda descreve o produto de hoje? Se os sinais (entregas, números, insights) apontam outro
        lado, proponha com propose_direction; se está certo, diga no diário em uma linha.
     d) Marco (list_milestones): o atual acabou ou está quase? Ponha o próximo para andar (as primeiras histórias dele).
     e) Ideias (list_ideas do projeto): descarte o que não cabe mais (update_idea status archived com o motivo: nesta ronda ele autorizou); o que está maduro e no rumo vira
        história; o que é bom mas precisa da escolha dele vira decisão (create_decision) para começar.
     O limite de 3 histórias novas vale; mover, agrupar, descartar e fechar não contam. Diga no diário o que achou em
     cada item (a-e), mesmo que seja "nada a fazer".`],
  [['memoria_cresceu'],
    `   - Curadoria: a memória do projeto é uma só. Leia a do projeto (memory_recall, limit 30, algumas buscas) e a dos
     agentes do projeto (list_agent_memories). O que é sobre o projeto e está na memória de um agente:
     move_memory_to_project. Fatos repetidos ou que se contradizem: fique com o certo e aposente os outros com
     memory_supersede (motivo + substituto). Nada se apaga: tudo fica com o motivo. Não mexa no que é jeito de trabalhar.`],
];
const guide = (kinds: EventKind[]) => GUIDE.filter(([k]) => k.some(x => kinds.includes(x))).map(([, t]) => t).join('\n');

export { teamBlock };
export function ownerPrompt(slug: string, name: string, evs: { kind: EventKind; ref: string; summary: string; created_at: string }[]): string {
  const hhmm = (iso: string) => new Date(iso.endsWith('Z') ? iso : `${iso}Z`).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const decisions = get<{ n: number }>(`select count(*) n from proposals where project_slug = ? and status = 'proposed'`, slug)!.n;
  return `${OWNER_HEAD} ${name}: ${evs.length === 1 ? LABEL[evs[0].kind] : `${evs.length} eventos`}

Você é o DONO do projeto ${name} (slug ${slug}): responde pelo resultado dele, dentro do rumo que o Gustavo aprovou. Ele é o
diretor: aprova o rumo e valida histórias como usuário final. Todo o resto é com você e com o time do projeto.
A Central te acordou por isto:
${evs.map(e => `- ${hhmm(e.created_at)} ${LABEL[e.kind]} [${e.ref}]: ${e.summary}`).join('\n')}

Estado agora: tarefas soltas e histórias por coluna: ${counts(slug)}; decisões esperando o Gustavo: ${decisions}.
${teamBlock(slug)}
Leia antes o que precisar: get_direction (rumo), list_milestones, list_tasks, list_deliveries, list_decisions, memory_recall.

O que fazer (só com as ferramentas da Central; nesta passada você não edita código nem roda o produto):
1. Para cada evento, decida: agir, registrar ou escalar.
${guide(evs.map(e => e.kind))}
2. Interrompa o Gustavo (create_decision) SÓ no crítico: produção com impacto no usuário que não seja hotfix, dinheiro,
   dados de cliente, comunicação com cliente, mudança de rumo. Mudança de tela, ajuste, bug, dev: decida você.
3. Time (agentes, quadros, rotinas): mude quando o Gustavo pediu. Por iniciativa sua, proponha com create_decision.
4. Limites: no máximo 3 histórias novas por passada; antes de criar, confira se já existe (list_tasks).
Números do produto: os combinados estão em list_metrics; mediu, registre com report_metric (é o que o Gustavo vê no
cockpit). Se o rumo pede um número que ninguém mede, combine com define_metric (nome, de onde vem, frequência, meta).
Precisa do Gustavo para algo grande (rumo, time, uma escolha que não cabe numa decisão)? request_one_on_one: ele vê no
cockpit e abre o 1:1 com você.
Antes de decidir algo parecido com o que ele já decidiu, veja o critério dele: operator_history.
Termine com o DIÁRIO (é o que o Gustavo lê): até 5 linhas "o que fiz e por quê" e, para cada erro, um post-mortem de 3
linhas (o que houve, por quê, o que mudou). Não chame report_delivery.`;
}

/**
 * O Gustavo mandou o dono procurar trabalho (botão): acorda na hora, mesmo com o "age sozinho" desligado, com a ronda e o
 * que estava pendente. Uma passada por vez: já tem uma rodando, devolve null.
 */
export function ownerRound(slug: string, start: OwnerDeps['start']): number | null {
  const o = get<{ agent: number | null; name: string }>(`select ${OWNER_OF} agent, p.name from projects p where p.slug = ?`, slug);
  if (!o?.agent) throw new Error('Este produto não tem dono nem tech lead.');
  if (get(`select 1 from runs where project_slug = ? and prompt like ? and status in ('queued','preparing','running')`, slug, `${OWNER_HEAD}%`)) return null;
  emitEvent(slug, 'ronda', `ronda:${new Date().toISOString().slice(0, 16)}`, 'Backlog, revisões, rumo, próximo marco e ideias: veja o que dá para andar.');
  const evs = all<{ id: number; kind: EventKind; ref: string; summary: string; created_at: string }>(
    `select id, kind, ref, summary, created_at from events where project_slug = ? and handled_at is null order by id limit 30`, slug);
  const runId = start({ project_slug: slug, agent_id: o.agent, prompt: ownerPrompt(slug, o.name, evs) });
  run(`update events set handled_at = ?, pass_run_id = ? where id in (${evs.map(e => e.id).join(',')})`, new Date().toISOString(), typeof runId === 'number' ? runId : null);
  return typeof runId === 'number' ? runId : null;
}

/** diário do dono: as últimas passadas com o resultado */
export const ownerDiary = (slug: string, limit = 20) => all<{ id: number; status: string; created_at: string; finished_at: string | null; prompt: string; result: string | null }>(
  `select id, status, created_at, finished_at, substr(prompt, 1, 200) prompt, result from runs where project_slug = ? and prompt like ? order by created_at desc, id desc limit ?`,
  slug, `${OWNER_HEAD}%`, limit);
export const pendingEvents = (slug: string) => all<{ id: number; kind: string; summary: string; created_at: string }>(
  `select id, kind, summary, created_at from events where project_slug = ? and handled_at is null order by id`, slug);

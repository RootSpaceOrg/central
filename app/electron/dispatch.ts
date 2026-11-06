/**
 * Responsável pelo "A fazer": quando o Gustavo põe uma tarefa em A fazer num projeto que tem responsável, a Central coloca
 * esse agente para trabalhar nela (uma execução por tarefa, ligada a ela: nota de entrega e fila de revisão).
 * Travas: no máximo N do responsável por vez no projeto, só no horário escolhido, não dispara com a cota da sessão acima
 * de 80% e não insiste numa tarefa que não terminou nas últimas 12 h (volta para A fazer e ficaria em laço).
 */
import { all, get, run } from './db';
import { PRIORITY_OF, Priority, canStart } from './governor';

const RETRY_AFTER_H = 12;

/** "08-22" (ou "22-06", virando a noite); vazio = qualquer hora. */
export function withinHours(spec: string, now: Date): boolean {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(spec.trim());
  if (!m) return true;
  const [from, to, h] = [Number(m[1]), Number(m[2]), now.getHours()];
  return from <= to ? h >= from && h < to : h >= from || h < to;
}

/** execução curta em que o responsável escolhe a próxima tarefa (não faz trabalho; não gera nota de entrega) */
export const PICK_HEAD = '[responsável:escolher]';
/** se ele não escolheu nenhuma, só pergunta de novo quando a lista mudar ou depois deste tempo */
const PICK_AGAIN_H = 2;
const PRIORITY_LABEL = ['prioritária', 'alta', 'normal', 'baixa'];

export interface DispatchDeps {
  /** % usado da sessão do plano (null = não sabe) */
  quota: () => Promise<number | null>;
  start: (input: { project_slug: string | null; agent_id: number; repo_path: string | null; prompt: string; permission: 'edits' | 'full'; task_id: number | null; stage?: string | null; board_id?: number | null; small?: boolean }) => void;
  /** configuração guardada (a lista que o responsável já avaliou) */
  setting?: (key: string) => string | null;
  setSetting?: (key: string, value: string) => void;
  now?: () => Date;
  /** tarefa que uma conversa viva disse estar fazendo (set_status) */
  claimed?: (taskId: number) => boolean;
}

let lastSkip = '';

/** O responsável escolhe: a lista do que está pronto, o que espera outras, e como responder. */
export const pickPrompt = (slug: string, ready: { id: number; title: string; body: string | null; repo_path: string | null; priority: number }[], waiting: { id: number; title: string; depends_on: string }[]) =>
  `${PICK_HEAD} Escolher a próxima tarefa do projeto ${slug}

Você é o responsável pelo "A fazer" deste projeto. Estas tarefas estão prontas para começar:
${ready.map(t => `- #${t.id} (${PRIORITY_LABEL[t.priority] ?? 'normal'}${t.repo_path ? `, repositório ${t.repo_path.split(/[\\/]/).pop()}` : ''}) ${t.title}${t.body ? `\n  ${t.body.replace(/\s+/g, ' ').slice(0, 280)}` : ''}`).join('\n')}
${waiting.length ? `\nEsperando outras (ainda não podem começar):\n${waiting.map(t => `- #${t.id} ${t.title} (depois de ${(JSON.parse(t.depends_on) as number[]).map(n => `#${n}`).join(', ')})`).join('\n')}\n` : ''}
Escolha UMA para começar agora: a que deve vir primeiro. Pense no que as outras precisam que exista antes, no que destrava mais
trabalho, no rumo do projeto (get_direction) e no que já foi entregue (list_tasks, list_deliveries). Olhe o código se precisar.
- Escolheu: chame pick_task com o id e o motivo em uma frase. A Central começa essa tarefa logo em seguida, numa execução sua.
  Não faça o trabalho aqui: esta execução é só a escolha.
- Percebeu que uma tarefa depende de outra e isso não está marcado: registre com update_task depends_on.
- Nenhuma deveria começar agora (falta algo, depende do Gustavo): não escolha; crie uma decisão (create_decision) explicando.
Termine em uma linha dizendo o que escolheu e por quê. Não chame report_delivery.`;

/**
 * Uma tarefa que não consegue começar (ex.: repositório que não existe mais) vira uma decisão para o Gustavo, uma vez só,
 * e o despacho segue com as outras (antes o erro parava o "A fazer" de todos os projetos, em silêncio).
 */
function stuck(taskId: number, slug: string | null, why: string): void {
  lastSkip = `tarefa #${taskId}: ${why}`;
  if (get(`select 1 from proposals where task_id = ? and status = 'proposed'`, taskId)) return;
  const title = get<{ title: string }>('select title from tasks where id = ?', taskId)?.title ?? `#${taskId}`;
  run(`insert into proposals (project_slug, title, body, next_action, tier, source, source_ref, task_id, status) values (?,?,?,?,?,?,?,?, 'proposed')`,
    slug, `Não consegui começar a tarefa #${taskId}`, `"${title}" está em A fazer, mas não começou: ${why}`,
    'Ajuste a tarefa (repositório, agente) e aprove para tentar de novo.', 1, 'dispatch', `dispatch-${taskId}-${Date.now()}`, taskId);
}
/** por que não disparou da última vez (para a tela explicar) */
export const dispatchSkip = () => lastSkip;

export async function dispatchTodo(deps: DispatchDeps): Promise<number> {
  const owners = all<{ slug: string; agent: number; parallel: number; hours: string; permission: 'edits' | 'full'; priority: string }>(
    `select p.slug, p.todo_agent_id agent, p.todo_parallel parallel, p.todo_hours hours, a.permission, a.priority
     from projects p join agents a on a.id = p.todo_agent_id where p.status <> 'dead'
`);
  // quadros: cada coluna com agente pega o que entra nela (o agente pode ser de qualquer projeto)
  const stages = all<{ board: number; bname: string; key: string; label: string; agent: number; parallel: number; hours: string; instruction: string | null; permission: 'edits' | 'full'; next: string | null; priority: string }>(
    `select c.board_id board, bd.name bname, c.key, c.label, c.agent_id agent, c.parallel, c.hours, c.instruction, a.permission, a.priority,
       coalesce(n.label, (select x.label from board_cols x where x.board_id = c.board_id and x.position > c.position order by x.position limit 1)) next
     from board_cols c join boards bd on bd.id = c.board_id join agents a on a.id = c.agent_id
     left join board_cols n on n.board_id = c.board_id and n.key = c.next_key`);
  if (!owners.length && !stages.length) return 0;
  const used = await deps.quota();
  // freio por prioridade do agente: baixa para antes, alta vai até perto do limite (governor.ts)
  const allowed = (p: string) => canStart((PRIORITY_OF[p] ?? 1) as Priority, { session: used, week: null, sessionReset: null, weekReset: null });
  lastSkip = used !== null && ![...owners, ...stages].some(x => allowed(x.priority)) ? `cota da sessão em ${used}%` : '';
  if (lastSkip) return 0;
  const now = deps.now?.() ?? new Date();
  let started = 0;
  for (const o of owners) {
    if (!withinHours(o.hours, now) || !allowed(o.priority)) continue;
    const busy = get<{ n: number }>(`select count(*) n from runs where project_slug = ? and agent_id = ? and status in ('queued','preparing','running')`, o.slug, o.agent)!.n;
    const slots = Math.max(0, (o.parallel || 1) - busy);
    if (!slots) continue;
    const since = new Date(now.getTime() - RETRY_AFTER_H * 3_600_000).toISOString();
    const ready = all<{ id: number; title: string; body: string | null; repo_path: string | null; priority: number; picked_at: string | null }>(
      `select t.id, t.title, t.body, t.repo_path, t.priority, t.picked_at from tasks t
       where t.project_slug = ? and t."column" = 'todo'
         and not exists (select 1 from runs r where r.task_id = t.id and (r.status in ('queued','preparing','running') or (r.status = 'failed' and r.finished_at > ?)))
         and not exists (select 1 from json_each(coalesce(t.depends_on, '[]')) d join tasks p on p.id = d.value where p."column" not in ('review','dev','done'))
         and not exists (select 1 from proposals p where p.task_id = t.id and p.status = 'proposed')
       order by t.picked_at is null, t.priority, t.position, t.id`, o.slug, since)
      // tarefa que uma conversa disse estar fazendo (set_status) já tem dono
      .filter(t => !deps.claimed?.(t.id));
    const go = (t: typeof ready[number]) => {
      try {
        deps.start({ project_slug: o.slug, agent_id: o.agent, repo_path: t.repo_path, prompt: `${t.title}${t.body ? `\n\n${t.body}` : ''}`, permission: o.permission, task_id: t.id });
        run('update tasks set picked_at = null where id = ?', t.id);
        started++;
      } catch (e) { stuck(t.id, o.slug, (e as Error).message); }
    };
    // o que ele já escolheu (ou cabe tudo nas vagas): começa direto
    const picked = ready.filter(t => t.picked_at);
    let free = slots;
    for (const t of picked.slice(0, free)) { go(t); free--; }
    const rest = ready.filter(t => !t.picked_at);
    if (!free || !rest.length) continue;
    if (rest.length <= free) { rest.forEach(go); continue; }
    // mais tarefas prontas que vagas: o responsável escolhe qual vem primeiro (uma escolha por vez)
    if (get(`select 1 from runs where project_slug = ? and agent_id = ? and prompt like ? and status in ('queued','preparing','running')`, o.slug, o.agent, `${PICK_HEAD}%`)) continue;
    const ids = rest.map(t => t.id).join(',');
    const seen = (() => { try { return JSON.parse(deps.setting?.(`pick:${o.slug}`) ?? 'null') as { ids: string; at: number } | null; } catch { return null; } })();
    if (seen && seen.ids === ids && now.getTime() - seen.at < PICK_AGAIN_H * 3_600_000) continue;
    deps.setSetting?.(`pick:${o.slug}`, JSON.stringify({ ids, at: now.getTime() }));
    const waiting = all<{ id: number; title: string; depends_on: string }>(
      `select id, title, depends_on from tasks where project_slug = ? and "column" = 'todo' and depends_on is not null and id not in (${ids})`, o.slug);
    deps.start({ project_slug: o.slug, agent_id: o.agent, repo_path: null, permission: 'edits', task_id: null, small: true, prompt: pickPrompt(o.slug, rest, waiting) });
    started++;
  }
  for (const s of stages) {
    if (!withinHours(s.hours, now) || !allowed(s.priority)) continue;
    const busy = get<{ n: number }>(`select count(*) n from runs where board_id = ? and stage = ? and status in ('queued','preparing','running')`, s.board, s.key)!.n;
    const slots = Math.max(0, (s.parallel || 1) - busy);
    if (!slots) continue;
    const since = new Date(now.getTime() - RETRY_AFTER_H * 3_600_000).toISOString();
    const tasks = all<{ id: number; title: string; body: string | null; repo_path: string | null; project_slug: string | null }>(
      `select t.id, t.title, t.body, t.repo_path, t.project_slug from task_boards x join tasks t on t.id = x.task_id
       where x.board_id = ? and x.stage = ? and t."column" <> 'done'
         and not exists (select 1 from runs r where r.task_id = t.id and (r.status in ('queued','preparing','running') or (r.board_id = ? and r.stage = ? and r.status = 'failed' and r.finished_at > ?) or r.waiting is not null))
         and not exists (select 1 from proposals p where p.task_id = t.id and p.status = 'proposed')
         and not exists (select 1 from json_each(coalesce(t.depends_on, '[]')) d join tasks p on p.id = d.value where p."column" not in ('review','dev','done'))
       order by t.priority, x.position, t.id limit ?`, s.board, s.key, s.board, s.key, since, slots);
    for (const t of tasks) {
      const head = `Etapa "${s.label}" do quadro ${s.bname}.${s.instruction ? `\n${s.instruction}` : ''}\nAo terminar bem, a Central leva a tarefa para ${s.next ? `"${s.next}"` : 'o fim do quadro'}; não mova você mesmo.`;
      try {
        deps.start({ project_slug: t.project_slug, agent_id: s.agent, repo_path: t.repo_path, prompt: `${head}\n\n${t.title}${t.body ? `\n\n${t.body}` : ''}`, permission: s.permission, task_id: t.id, stage: s.key, board_id: s.board });
        started++;
      } catch (e) { stuck(t.id, t.project_slug, (e as Error).message); }
    }
  }
  return started;
}

// ---------- agente de triagem ----------

export type TriageMode = 'off' | 'no_project' | 'all';
export const TRIAGE_HEAD = 'Triagem automática';
const TRIAGE_BATCH = 5;

/**
 * Ideias que você anota entram na triagem; com o gatilho ligado, um agente (padrão: a Central) lê, organiza e deixa uma
 * recomendação no cartão. Nunca aprova nem descarta: quem decide é o Gustavo. Uma execução por vez, até 5 ideias por lote.
 * Só ideias do Gustavo: as que os agentes sugerem (inclusive as divisões da própria triagem) não voltam para a fila.
 */
export async function dispatchTriage(deps: Pick<DispatchDeps, 'quota' | 'now'> & {
  setting: (key: string) => string | null;
  start: (input: { agent_id: number; prompt: string }) => void;
}): Promise<number> {
  const mode = (deps.setting('triage:mode') ?? 'no_project') as TriageMode;
  if (mode === 'off') return 0;
  const agent = Number(deps.setting('triage:agent')) || get<{ id: number }>('select id from agents where builtin = 1')?.id;
  const priority = agent ? get<{ p: string }>('select priority p from agents where id = ?', agent)?.p : null;
  if (!agent || !priority) return 0;
  if (get(`select 1 from runs where prompt like ? and status in ('queued','preparing','running')`, `${TRIAGE_HEAD}%`)) return 0;
  const ideas = all<{ id: number; title: string; body: string | null; project_slug: string | null }>(
    `select id, title, body, project_slug from ideas where status = 'new' and triaged_at is null and author = 'gustavo'
       ${mode === 'no_project' ? 'and project_slug is null' : ''} order by id limit ?`, TRIAGE_BATCH);
  if (!ideas.length) return 0;
  const used = await deps.quota();
  if (!canStart((PRIORITY_OF[priority] ?? 1) as Priority, { session: used, week: null, sessionReset: null, weekReset: null })) return 0;
  const at = (deps.now?.() ?? new Date()).toISOString();
  for (const i of ideas) run('update ideas set triaged_at = ? where id = ?', at, i.id);
  deps.start({ agent_id: agent, prompt: triagePrompt(ideas) });
  return ideas.length;
}

export const triagePrompt = (ideas: { id: number; title: string; body: string | null; project_slug: string | null }[]) => `${TRIAGE_HEAD}: ${ideas.length === 1 ? `ideia #${ideas[0].id}` : `${ideas.length} ideias`}

O Gustavo anotou ${ideas.length === 1 ? 'esta ideia' : 'estas ideias'} na triagem. Leia e deixe cada uma pronta para ele decidir em segundos.
Para cada ideia:
1. Descubra de qual projeto é (list_projects, get_direction, roadmap, backlog, código se precisar) e grave com update_idea project_slug. Se não for de nenhum, deixe sem.
2. Se o texto estiver confuso, reescreva título (curto, verbo no infinitivo) e descrição em markdown com update_idea, sem perder nada do que ele escreveu.
3. Se forem várias coisas, divida: create_idea para cada parte (mesmo projeto) e deixe a original com a principal. Ligue ao marco do roadmap (milestone_id) se servir a um.
4. Se depender de uma escolha dele, crie uma decisão (create_decision) com as opções.
5. Por fim, update_idea com triage = "<aprovar e planejar | aprovar | descartar | precisa de você> — <motivo em uma frase>".
Nunca aprove nem descarte (status): quem decide é ele. Não crie tarefas.

${ideas.map(i => `## Ideia #${i.id}${i.project_slug ? ` (projeto ${i.project_slug})` : ' (sem projeto)'}\n${i.title}${i.body ? `\n\n${i.body}` : ''}`).join('\n\n')}`;

/**
 * Agência do projeto: o time de agentes, os quadros que ligam esse time em etapas e as rotinas que mantêm tudo andando.
 * - Sessão "Agência" (mesmo motor do Guiar): o Diretor de agência lê o projeto e o time, abre o debate; a Central responde,
 *   monta os cards (time, fluxo, rotinas) e, com o plano aprovado, cria/ajusta/aposenta agentes, quadros e rotinas.
 * - Revisão automática (rotinas do Diretor): diária leve (só o backlog: cada item com destino) e semanal completa (time vs
 *   rumo, desempenho, backlog e roadmap). Backlog ela arruma sozinha; mudança no time vira proposta (sessão esperando).
 */
import type { GuideCard, GuideDto, GuidePlanItem } from '../src/app/shared/contract';
import { createAgent } from './agentdefs';
import { DEV_ROOT, all, get, now, run } from './db';
import { getDirection } from './direction';
import { cardsText, registerProfile, scopeText } from './guides';
import { createRoutine, deleteRoutine } from './routines';

const DIRECTOR = 'Diretor de agência';

/** o Diretor de agência (criado no primeiro uso; o papel dele é editável na tela Agentes) */
export function director(): number {
  const a = get<{ id: number }>('select id from agents where name = ? order by id limit 1', DIRECTOR);
  if (a) return a.id;
  const created = createAgent({
    name: DIRECTOR, color: '#7ED6C2', icon_kind: 'letter', model: 'opus', permission: 'edits', room: 'gestao',
    description: 'Monta e revisa o time de agentes de cada projeto: papéis, fluxos (quadros) e rotinas.',
    instructions: `Você é o diretor de agência do Gustavo: monta e mantém o time de agentes de cada projeto, como uma agência.
Pense em papéis (quem faz o quê), fluxos (quadros com um agente por etapa) e rotinas (o que roda sozinho e quando).
Leia o rumo, o roadmap, o backlog e como cada agente tem trabalhado (execuções, falhas, entregas). Seja concreto: diga que
papel falta, qual sobra, que instrução está gerando o mesmo erro, qual quadro trava e onde. Prefira poucos agentes bons a
muitos genéricos. Nas sessões você só analisa e propõe; quem cria e muda é a Central. Nas revisões automáticas, arrume o
backlog você mesmo (cada item com destino) e transforme mudança de time em proposta (agency_propose).`,
  });
  run('update agents set add_dirs = ? where id = ?', JSON.stringify([DEV_ROOT]), created.id);
  return created.id;
}

const slugsOf = (slug: string, direct: boolean) =>
  direct ? [slug] : [slug, ...all<{ slug: string }>('select slug from projects where parent_slug = ?', slug).map(k => k.slug)];

/** Retrato do time (sem cota): agentes com desempenho, quadros, rotinas, dono do A fazer e saúde do backlog. */
export function teamSnapshot(slug: string, direct: boolean): Record<string, unknown> {
  const p = get<{ name: string; todo_agent_id: number | null }>('select name, todo_agent_id from projects where slug = ?', slug);
  if (!p) throw new Error('Projeto não encontrado.');
  const slugs = slugsOf(slug, direct);
  const inS = `(${slugs.map(() => '?').join(',')})`;
  const boards = all<{ id: number; name: string; project_slug: string | null }>(`select id, name, project_slug from boards where project_slug in ${inS} order by position`, ...slugs);
  const cols = boards.length ? all<{ board_id: number; label: string; agent_id: number | null }>(
    `select board_id, label, agent_id from board_cols where board_id in (${boards.map(() => '?').join(',')}) order by position`, ...boards.map(b => b.id)) : [];
  const routines = all<{ id: number; name: string; agent_id: number | null; schedule_kind: string; days: string; time: string; interval_hours: number; enabled: number; kind: string }>(
    `select id, name, agent_id, schedule_kind, days, time, interval_hours, enabled, kind from routines where project_slug in ${inS}
       or agent_id in (select id from agents where project_slug in ${inS})`, ...slugs, ...slugs);
  // agentes do projeto + os que trabalham nos quadros/rotinas dele
  const ids = new Set<number>([
    ...all<{ id: number }>(`select id from agents where project_slug in ${inS}`, ...slugs).map(a => a.id),
    ...cols.map(c => c.agent_id).filter((x): x is number => !!x),
    ...routines.map(r => r.agent_id).filter((x): x is number => !!x),
    ...(p.todo_agent_id ? [p.todo_agent_id] : []),
  ]);
  const agents = [...ids].map(id => {
    const a = get<{ id: number; name: string; description: string | null; model: string; permission: string; restricted: number; project_slug: string | null; builtin: number }>(
      'select id, name, description, model, permission, restricted, project_slug, builtin from agents where id = ?', id);
    if (!a) return null;
    const r = get<{ ok: number; failed: number; active: number; cost: number | null; last: string | null }>(`select
        sum(status = 'succeeded') ok, sum(status in ('failed','killed')) failed, sum(status in ('queued','preparing','running')) active,
        sum(cost_usd) cost, max(created_at) last from runs where agent_id = ? and created_at > datetime('now','-7 days')`, id)!;
    return {
      id: a.id, name: a.name, role: a.description, model: a.model || 'padrão', freedom: a.restricted ? 'restrito' : a.permission === 'full' ? 'total' : 'segura',
      project: a.project_slug, central: !!a.builtin,
      runs_7d: { succeeded: r.ok ?? 0, failed: r.failed ?? 0, active: r.active ?? 0 }, cost_7d_usd: Math.round((r.cost ?? 0) * 100) / 100, last_run: r.last,
      todo_owner: p.todo_agent_id === a.id,
      boards: cols.filter(c => c.agent_id === a.id).map(c => `${boards.find(b => b.id === c.board_id)?.name}: ${c.label}`),
      routines: routines.filter(x => x.agent_id === a.id).map(x => x.name),
    };
  }).filter(Boolean);
  const cnt = (sql: string) => get<{ n: number }>(sql, ...slugs)!.n;
  const lastGuide = get<{ minutes: string | null; finished_at: string }>(`select minutes, finished_at from guides where project_slug = ? and kind = 'rumo' and status = 'done' order by id desc limit 1`, slug);
  const dir = getDirection(slug);
  return {
    project: p.name, scope: scopeText(slug, direct),
    direction: dir?.text ?? null,
    roadmap_now: all<{ title: string }>(`select title from milestones where project_slug in ${inS} and horizon = 'now' order by position`, ...slugs).map(m => m.title),
    last_guide: lastGuide ? { at: lastGuide.finished_at, minutes: lastGuide.minutes } : null,
    todo_owner: p.todo_agent_id ? get<{ name: string }>('select name from agents where id = ?', p.todo_agent_id)?.name ?? null : null,
    agents,
    boards: boards.map(b => ({ name: b.name, stages: cols.filter(c => c.board_id === b.id).map(c => `${c.label}${c.agent_id ? ` (${get<{ name: string }>('select name from agents where id = ?', c.agent_id)?.name ?? '?'})` : ' (sem agente)'}`) })),
    routines: routines.map(r => ({
      name: r.name, agent: r.agent_id ? get<{ name: string }>('select name from agents where id = ?', r.agent_id)?.name ?? null : null, enabled: !!r.enabled,
      when: r.schedule_kind === 'interval' ? `a cada ${r.interval_hours} h` : `${r.days} às ${r.time}`, kind: r.kind,
    })),
    backlog: {
      backlog: cnt(`select count(*) n from tasks where project_slug in ${inS} and "column" = 'backlog'`),
      todo: cnt(`select count(*) n from tasks where project_slug in ${inS} and "column" = 'todo'`),
      doing: cnt(`select count(*) n from tasks where project_slug in ${inS} and "column" = 'doing'`),
      stale_14d: cnt(`select count(*) n from tasks where project_slug in ${inS} and "column" in ('backlog','todo') and updated_at < datetime('now','-14 days')`),
      waiting_you: cnt(`select count(*) n from proposals where status = 'proposed' and project_slug in ${inS}`),
    },
  };
}

const analysisPrompt = (g: GuideDto) => `Sessão "Agência" #${g.id}: ${scopeText(g.project_slug, !!g.direct)}.
O Gustavo quer revisar o time de agentes do projeto (quem faz o quê, os fluxos e as rotinas). Você é o diretor de agência: abra o debate.

Retrato do time (montado agora):
${g.snapshot}
${g.focus ? `\nO Gustavo já adiantou o que tem em mente:\n"${g.focus}"\n` : ''}
Aprofunde com as ferramentas da Central (list_agents, list_agent_runs, get_agent_run, list_boards, list_routines, list_tasks,
get_direction, list_milestones, what_happened, memory_recall). Depois escreva, para o Gustavo e a Central, em até ~450 palavras:
1. O time serve ao rumo e ao roadmap? Que papel falta, qual sobra, quem está ocioso ou sobrecarregado.
2. Desempenho: quem entrega, quem falha e por quê (instrução fraca? ferramenta faltando? modelo?).
3. Fluxo: algum quadro trava ou tem etapa sem agente? O A fazer tem dono? Alguma rotina inútil ou faltando?
4. Sua proposta de agência (papéis, fluxo e rotinas), com o porquê.
Não crie nem mude nada: só analise.`;

const replyPrompt = (g: GuideDto, said: string) => `[Agência #${g.id}: ${scopeText(g.project_slug, !!g.direct)}]
O diretor de agência abriu o debate (o Gustavo está vendo esta conversa). Ele disse:

${said}

Retrato do time:
${g.snapshot}
${g.focus ? `\nO foco que o Gustavo deu: "${g.focus}".\n` : ''}
Agora você:
1. Responda ao diretor em poucas linhas: onde concorda, onde discorda e por quê.
2. Chame guide_update(guide_id ${g.id}) com:
   - reading: a leitura do time em 3 a 5 linhas;
   - cards: 3 a 6 decisões para o Gustavo, de três tipos (kind):
     'time' = papéis: criar, ajustar (instrução, modelo, liberdade) ou aposentar agentes; quem é dono do A fazer;
     'fluxo' = quadros: criar, mudar etapas ou o agente de uma etapa;
     'rotina' = rotinas: criar, ajustar ou desligar.
     Cada card: id curto, kind, question, context (1-2 linhas), options [{label, detail}], recommended (índice),
     strategist (a posição do diretor em 1 linha) e central (a sua em 1 linha).
Não mude nada ainda. Termine dizendo em 1 linha que os cards estão prontos.`;

const planPrompt = (g: GuideDto, cards: GuideCard[]) => `[Agência #${g.id}] O Gustavo respondeu os cards:
${cardsText(cards)}

Monte o plano com guide_update(guide_id ${g.id}, plan): itens { id, kind, title, detail, agent, when }.
kind: 'criar_agente' (detail = papel, instruções, modelo e liberdade propostos), 'ajustar_agente' (o que muda), 'aposentar_agente',
'quadro' (criar ou mudar um quadro: etapas e agentes), 'rotina' (criar/ajustar/desligar: o que faz, agente, quando), 'dono_todo'
(quem puxa o A fazer), 'tarefa' (algo a fazer no projeto que saiu da conversa).
agent = o agente envolvido (nome).
when (ele escolhe): 'agora' = aplicar já; 'backlog' = vira tarefa para depois; 'depois' = só anotar como ideia.
Siga o que ele decidiu, sem inventar escopo. Explique o plano aqui em 3 linhas.`;

const executePrompt = (g: GuideDto, cards: GuideCard[], plan: GuidePlanItem[]) => `[Agência #${g.id}] O Gustavo aprovou o plano. Execute exatamente estes itens:
${plan.map(i => `- (${i.when}) [${i.kind}] ${i.title}${i.agent ? ` — agente: ${i.agent}` : ''}${i.detail ? `\n  ${i.detail}` : ''}`).join('\n')}

Como fazer (só os 'agora'; 'backlog' vira create_task em backlog e 'depois' vira create_idea, com o detalhe):
- criar_agente: create_agent com project_slug ${g.project_slug}, papel, instruções claras, modelo e liberdade.
- ajustar_agente: update_agent (instruções, modelo, liberdade, ferramentas).
- aposentar_agente: tire dos quadros e rotinas antes; desligue as rotinas dele; delete_agent só se ele disse "apagar" (confirm true).
- quadro: create_board / add_board_column / update_board_column (agente de cada etapa, next_key).
- rotina: create_routine / update_routine (enabled false para desligar).
- dono_todo: update_project com todo_agent_id.
- Guarde na memória do projeto (memory_remember) o desenho do time e o porquê, para as próximas revisões.

Decisões que ele tomou nos cards (já registradas no histórico):
${cardsText(cards)}

No fim chame guide_finish(guide_id ${g.id}, minutes) com a ata em markdown curto: como ficou o time, o que mudou e por quê.
Depois diga aqui, em 2-3 linhas, o que fez.`;

registerProfile('agencia', {
  label: 'Agência', specialist: director, snapshot: async (slug, direct) => teamSnapshot(slug, direct),
  analysis: analysisPrompt, reply: replyPrompt, plan: planPrompt, execute: executePrompt,
});

/** agency_propose (MCP): a revisão semanal deixa uma sessão pronta esperando o Gustavo (cards já montados) */
export function proposeAgency(slug: string, reading: string, cards: GuideCard[]): string {
  if (!get('select 1 from projects where slug = ?', slug)) throw new Error('Projeto não encontrado.');
  const open = get<{ id: number }>(`select id from guides where project_slug = ? and kind = 'agencia' and status = 'open'`, slug);
  const snap = JSON.stringify(teamSnapshot(slug, false), null, 1);
  const list = cards.slice(0, 8).map((c, i) => ({ ...c, id: c.id || `c${i + 1}`, answer: null }));
  if (open) {
    run('update guides set reading = ?, cards = ?, snapshot = ?, step = max(step, 2), updated_at = ? where id = ?', reading.trim(), JSON.stringify(list), snap, now(), open.id);
    return `Proposta atualizada na sessão #${open.id} (já estava aberta).`;
  }
  const id = Number(run(`insert into guides (project_slug, direct, snapshot, phase, kind, reading, cards, step) values (?, 0, ?, 'idle', 'agencia', ?, ?, 2)`,
    slug, snap, reading.trim(), JSON.stringify(list)).lastInsertRowid);
  return `Proposta pronta: sessão de Agência #${id} esperando o Gustavo.`;
}

// ---------- revisão automática (rotinas do Diretor) ----------
const DAILY = 'Agência: backlog do dia';
const WEEKLY = 'Agência: revisão da semana';

const dailyPrompt = (slug: string) => `Revisão diária da agência do projeto ${slug} (leve: só o backlog).
Zere o backlog no sentido de "cada item com destino": nenhuma tarefa parada sem dono e sem motivo. Para cada tarefa em backlog
e A fazer (list_tasks): mande para A fazer o que tem contexto e serve ao rumo (get_direction) com o agente certo; junte
duplicadas; transforme em ideia (create_idea) o que é para depois; descarte (update_task done com o motivo) o que não faz mais
sentido; e o que depende do Gustavo vira uma decisão clara (create_decision) — sem duplicar decisão que já existe.
Você pode fazer tudo isso sozinho. Não mexa no time, quadros nem rotinas. No fim, resuma em 3-5 linhas o que fez.`;

const weeklyPrompt = (slug: string) => `Revisão semanal da agência do projeto ${slug} (completa).
1. Backlog: o mesmo da revisão diária (cada item com destino), feito por você.
2. Roadmap: marcos de Agora sem tarefa viram tarefas; marcos concluídos fecham (update_milestone done); se o Agora esvaziou,
   proponha subir o Próximo numa decisão (create_decision).
3. Time: o time ainda serve ao rumo? Desempenho de cada agente na semana (list_agent_runs): quem falha e por quê, quem está
   ocioso, que papel falta, qual quadro trava, que rotina sobra ou falta.
   NÃO mude agentes, quadros nem rotinas: se houver mudança a propor, chame agency_propose(project ${slug}, reading, cards)
   com os cards (kinds 'time', 'fluxo', 'rotina', no mesmo formato do guide_update), e o Gustavo decide na tela Agência.
No fim, resuma em 5-8 linhas: o que fez no backlog e no roadmap, como o time foi e se deixou proposta.`;

export function agencyRoutines(slug: string): { daily: boolean; weekly: boolean } {
  const has = (name: string) => !!get(`select 1 from routines where project_slug = ? and name = ? and enabled = 1`, slug, name);
  return { daily: has(DAILY), weekly: has(WEEKLY) };
}

export function setAgencyRoutines(slug: string, on: { daily: boolean; weekly: boolean }): { daily: boolean; weekly: boolean } {
  const agent = director();
  const sync = (name: string, want: boolean, prompt: string, days: number[], time: string) => {
    const r = get<{ id: number }>('select id from routines where project_slug = ? and name = ?', slug, name);
    if (!want) { if (r) deleteRoutine(r.id); return; }
    if (r) { run('update routines set enabled = 1 where id = ?', r.id); return; }
    createRoutine({ name, agent_id: agent, project_slug: slug, repo_path: null, prompt, permission: 'edits', size: 'medium', schedule_kind: 'daily', days, time, interval_hours: 24 });
  };
  sync(DAILY, on.daily, dailyPrompt(slug), [1, 2, 3, 4, 5], '07:30');
  sync(WEEKLY, on.weekly, weeklyPrompt(slug), [1], '08:00');
  return agencyRoutines(slug);
}

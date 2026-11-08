/**
 * Guiar projeto: uma sessão por projeto (ou frente, ou "sem frente") para decidir "para onde vamos agora".
 * Etapas: 1 Retrato (números montados aqui + a leitura dos agentes) → 2 Decisões (cards) → 3 Plano (você escolhe o
 * "quando" de cada item) → 4 Em andamento (a Central executa e escreve a ata).
 * O debate é visível numa conversa só (a da Central): o estrategista analisa primeiro numa conversa dele e a fala dele
 * entra na conversa da Central como mensagem 'peer'; as instruções de cada passo vão para a Central sem aparecer na tela.
 */
import type { ChatMessageDto, GuideCard, GuideDto, GuidePlanItem } from '../src/app/shared/contract';
import { centralAgent, createAgent } from './agentdefs';
import { saveMessage, sendChat } from './central-agent';
import { DEV_ROOT, all, get, now, run } from './db';
import { getDirection } from './direction';
import { releaseStatus } from './release';

type Notify = (chatId: number, message: ChatMessageDto | null, busy: boolean) => void;
export interface GuideDeps { notify: Notify; changed: () => void }

// Opus nos dois (decisão de rumo); CENTRAL_GUIDE_MODEL troca nos testes
const MODEL = { model: process.env.CENTRAL_GUIDE_MODEL || 'opus', effort: '' };
const STRATEGIST = 'Estrategista';

/** avisa a tela que uma sessão mudou (o main liga; as ferramentas do agente também passam por aqui) */
let guidesChanged = () => {};
export function onGuidesChanged(fn: () => void): void { guidesChanged = fn; }

/**
 * Tipo de sessão: o mesmo motor (debate, cards, plano, execução, ata) com outro especialista, retrato e prompts.
 * 'rumo' = Guiar (aqui); 'agencia' = time de agentes (agency.ts registra).
 */
export interface GuideProfile {
  label: string;
  specialist: () => number;
  snapshot: (slug: string, direct: boolean) => Promise<Record<string, unknown>>;
  analysis: (g: GuideDto) => string;
  reply: (g: GuideDto, said: string) => string;
  plan: (g: GuideDto, cards: GuideCard[]) => string;
  execute: (g: GuideDto, cards: GuideCard[], plan: GuidePlanItem[]) => string;
}
const profiles = new Map<string, GuideProfile>();
export function registerProfile(kind: string, p: GuideProfile): void { profiles.set(kind, p); }
const profileOf = (g: { kind?: string | null }) => profiles.get(g.kind || 'rumo') ?? profiles.get('rumo')!;

export const getGuide = (id: number) => get<GuideDto>('select * from guides where id = ?', id) ?? null;
export const listGuides = () => all<GuideDto>(`select * from guides where status != 'abandoned' order by id desc limit 200`);

/** o agente estrategista (criado na primeira sessão; dá para editar o papel dele na tela Agentes) */
function strategist(): number {
  const a = get<{ id: number }>('select id from agents where name = ? order by id limit 1', STRATEGIST);
  if (a) return a.id;
  const created = createAgent({
    name: STRATEGIST, color: '#C8A2FF', icon_kind: 'letter', model: 'opus', permission: 'edits', room: 'gestao',
    description: 'Diretor de produto que questiona o rumo dos projetos nas sessões de Guiar.',
    instructions: `Você é o estrategista do Gustavo nas sessões de "Guiar projeto". Seu trabalho é pensar, não executar:
leia o estado real do projeto (rumo, roadmap, backlog, ideias, decisões, execuções recentes, o que espera produção e, se
precisar, o código), diga com franqueza o que está andando, o que travou e o que não bate com o rumo, e proponha caminhos.
Provoque: questione premissas, aponte o que deveria ser cortado e o que está sendo adiado sem motivo. Seja concreto (cite
tarefas, marcos e números), curto e direto. Nunca crie, edite nem mude nada: quem executa é a Central.`,
  });
  // lê o código de qualquer projeto (createAgent não grava as pastas liberadas)
  run('update agents set add_dirs = ? where id = ?', JSON.stringify([DEV_ROOT]), created.id);
  return created.id;
}

/** escopo em texto, para os prompts */
export function scopeText(slug: string, direct: boolean): string {
  const p = get<{ name: string }>('select name from projects where slug = ?', slug);
  const kids = all<{ slug: string; name: string }>('select slug, name from projects where parent_slug = ?', slug);
  if (!kids.length) return `"${p?.name ?? slug}" (slug ${slug})`;
  return direct ? `"${p?.name ?? slug}" (slug ${slug}), só o que é do projeto direto, SEM as frentes (${kids.map(k => k.name).join(', ')})`
    : `"${p?.name ?? slug}" (slug ${slug}) inteiro, com as frentes: ${kids.map(k => `${k.name} (${k.slug})`).join(', ')}`;
}

/** Retrato em números (rápido, sem cota): o que os agentes leem primeiro e a etapa 1 mostra. */
export async function snapshot(slug: string, direct: boolean): Promise<Record<string, unknown>> {
  const p = get<{ name: string; description: string | null }>('select name, description from projects where slug = ?', slug);
  if (!p) throw new Error('Projeto não encontrado.');
  const slugs = direct ? [slug] : [slug, ...all<{ slug: string }>('select slug from projects where parent_slug = ?', slug).map(k => k.slug)];
  const inS = `(${slugs.map(() => '?').join(',')})`;
  const dir = getDirection(slug);
  const ms = all<{ title: string; horizon: string; target: string | null; done_at: string | null }>(`select title, horizon, target, done_at from milestones where project_slug in ${inS} order by position`, ...slugs);
  const cols = all<{ c: string; n: number }>(`select "column" c, count(*) n from tasks where project_slug in ${inS} and ("column" != 'done' or updated_at > datetime('now','-30 days')) group by "column"`, ...slugs);
  const stuck = all<{ id: number; title: string }>(`select id, title from tasks where project_slug in ${inS} and "column" = 'doing' and updated_at < datetime('now','-7 days') limit 8`, ...slugs);
  const ideas = all<{ s: string; n: number }>(`select status s, count(*) n from ideas where project_slug in ${inS} and status in ('new','approved') group by status`, ...slugs);
  const runs = all<{ s: string; n: number }>(`select status s, count(*) n from runs where project_slug in ${inS} and created_at > datetime('now','-7 days') group by status`, ...slugs);
  const count = <T extends { n: number }>(l: T[], k: keyof T, v: string) => l.find(x => x[k] === v)?.n ?? 0;
  const prod = (await Promise.all(slugs.map(s => releaseStatus(s).catch(() => [])))).flat()
    .filter(r => r.commits > 0).map(r => ({ repo: r.name, commits: r.commits, since: r.oldest_at }));
  return {
    project: p.name, scope: scopeText(slug, direct), description: p.description,
    direction: dir ? { text: dir.text, updated_at: dir.created_at } : null,
    roadmap: {
      now: ms.filter(m => m.horizon === 'now').map(m => m.title), next: ms.filter(m => m.horizon === 'next').map(m => m.title),
      later: ms.filter(m => m.horizon === 'later').length, done_30d: ms.filter(m => m.done_at && Date.parse(m.done_at) > Date.now() - 30 * 86_400_000).length,
    },
    tasks: Object.fromEntries(['backlog', 'todo', 'doing', 'review', 'dev', 'done'].map(c => [c, count(cols, 'c', c)])),
    stuck_doing: stuck.map(t => `#${t.id} ${t.title}`),
    ideas: { new: count(ideas, 's', 'new'), approved_waiting: count(ideas, 's', 'approved') },
    decisions_open: get<{ n: number }>(`select count(*) n from proposals where status = 'proposed' and project_slug in ${inS}`, ...slugs)!.n,
    runs_7d: { succeeded: count(runs, 's', 'succeeded'), failed: count(runs, 's', 'failed'), active: count(runs, 's', 'running') + count(runs, 's', 'queued') },
    review_waiting: get<{ n: number }>(`select count(*) n from deliveries where outcome is null and project_slug in ${inS}`, ...slugs)?.n ?? 0,
    waiting_production: prod,
  };
}

const analysisPrompt = (g: GuideDto) => `Sessão de "Guiar projeto" #${g.id}: ${scopeText(g.project_slug, !!g.direct)}.
O Gustavo quer decidir "para onde vamos agora". Você é o estrategista: abra o debate.

Retrato em números (montado agora):
${g.snapshot}
${g.focus ? `\nO Gustavo já adiantou o que tem em mente (leve a sério, mas questione se os números disserem outra coisa):\n"${g.focus}"\n` : ''}
Aprofunde com as ferramentas da Central (get_direction, list_milestones, list_tasks, list_ideas, list_decisions,
list_deliveries, what_happened, production_status, memory_recall; o código se precisar). Depois escreva, para o Gustavo e a
Central, em até ~400 palavras:
1. Leitura honesta: o que está andando, o que travou, o que não bate com o rumo/roadmap.
2. Riscos e o que deveria ser cortado ou congelado.
3. 2 a 3 caminhos para o próximo ciclo, cada um com o porquê, o esforço e o risco.
4. Sua recomendação.
Quem faz o quê é da Agência (outra sessão): criar, ajustar ou aposentar agentes, quadros (fluxos), rotinas e o dono do A fazer NÃO se decide aqui. Se o rumo pedir um papel ou fluxo que não existe, diga só a necessidade (ex.: "falta alguém cuidando de X").
Não crie nem mude nada: só analise.`;

const replyPrompt = (g: GuideDto, said: string) => `[Guia #${g.id}: ${scopeText(g.project_slug, !!g.direct)}]
O estrategista abriu o debate (o Gustavo está vendo esta conversa). Ele disse:

${said}

Retrato em números:
${g.snapshot}
${g.focus ? `\nO foco que o Gustavo deu: "${g.focus}". Os cards devem girar em torno disso (sem esconder o que for urgente fora dele).\n` : ''}
Agora você:
1. Responda ao estrategista em poucas linhas: onde concorda, onde discorda e por quê (é o debate que o Gustavo acompanha).
2. Chame guide_update(guide_id ${g.id}) com:
   - reading: a leitura do momento em 3 a 5 linhas (vai no topo do retrato);
   - cards: 3 a 6 decisões para o Gustavo, de três tipos (kind):
     'rumo' = validar o rumo e o roadmap (manter / ajustar com o texto proposto no detail / reescrever);
     'direcao' = 2 a 3 caminhos para o próximo ciclo;
     'prioridade' = o que sobe, o que congela e o que descarta (ideias, tarefas, frentes paradas).
     Quem faz o quê é da Agência (outra sessão): criar, ajustar ou aposentar agentes, quadros (fluxos), rotinas e o dono do A fazer NÃO se decide aqui. Nada de card sobre agentes ou quadros.
     Cada card: id curto, kind, question, context (1-2 linhas), options [{label, detail}], recommended (índice),
     strategist (a posição dele em 1 linha) e central (a sua em 1 linha).
Não mude nada no projeto ainda. Termine dizendo em 1 linha que os cards estão prontos.`;

export function cardsText(cards: GuideCard[]): string {
  return cards.map(c => {
    const a = c.answer;
    const pick = a?.choice != null ? c.options[a.choice]?.label : null;
    return `- [${c.kind}] ${c.question}\n  Resposta: ${pick ?? (a?.note ? 'outra' : 'sem resposta')}${a?.note ? ` (ele disse: ${a.note})` : ''}`;
  }).join('\n');
}

const planPrompt = (g: GuideDto, cards: GuideCard[]) => `[Guia #${g.id}] O Gustavo respondeu os cards:
${cardsText(cards)}

Monte o plano com guide_update(guide_id ${g.id}, plan): itens { id, kind, title, detail, agent, when }.
kind: 'rumo' (ajuste do texto do rumo; detail = o texto novo), 'marco' (criar/mover marco do roadmap), 'tarefa', 'ideia',
'cortar' (arquivar ideia/tarefa ou congelar frente), 'agente' (pôr um agente QUE JÁ EXISTE para trabalhar) ou
'agencia' (o rumo pede um papel, um fluxo ou uma rotina que não existe: title = a necessidade, detail = o porquê; quem decide é a
sessão de Agência, você NÃO cria agente, quadro nem rotina aqui).
agent = o nome do agente que faria (list_agents), quando fizer sentido.
when (sugestão; ele escolhe): 'agora' = agente começa já; 'backlog' = tarefa em A fazer com o agente; 'depois' = vira marco ou ideia.
Siga o que ele decidiu, sem inventar escopo. Explique o plano aqui em 3 linhas.`;

const executePrompt = (g: GuideDto, cards: GuideCard[], plan: GuidePlanItem[]) => {
  const day = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `[Guia #${g.id}] O Gustavo aprovou o plano. Execute exatamente estes itens (com o "quando" que ele escolheu):
${plan.map(i => `- (${i.when}) [${i.kind}] ${i.title}${i.agent ? ` — agente: ${i.agent}` : ''}${i.detail ? `\n  ${i.detail}` : ''}`).join('\n')}

Como fazer:
- rumo: update_direction com note "via guia de ${day}".
- marco: create_milestone / update_milestone (Agora, Próximo, Depois).
- 'agora': start_agent com o agente (crie a tarefa antes, se fizer sentido, e ligue).
- 'backlog': create_task em column todo, com o agente responsável no corpo ou no quadro.
- 'depois': marco em Próximo/Depois ou ideia aprovada (create_idea + update_idea approved).
- cortar: update_idea archived, update_task done/backlog com o motivo, ou update_project status frozen se for uma frente.
- agencia: NÃO execute (nada de create_agent, create_board, create_routine): vai na ata numa seção "Para a Agência"; o Gustavo leva para a sessão de Agência.
- Guarde na memória do projeto (memory_remember) o porquê das escolhas e o que foi descartado, para ninguém propor de novo.

Decisões que ele tomou nos cards (já registradas no histórico de decisões):
${cardsText(cards)}

No fim chame guide_finish(guide_id ${g.id}, minutes) com a ata em markdown curto: o que foi decidido, o plano e o porquê.
Depois diga aqui, em 2-3 linhas, o que fez.`;
};

/** manda para a Central sem mostrar a instrução na tela (a conversa mostra só o debate e as respostas) */
function toCentral(g: GuideDto, text: string, d: GuideDeps): void {
  const central = centralAgent().id;
  if (!g.central_chat) {
    const id = sendChat(null, central, text, d.notify, d.changed, null, MODEL, true);
    run('update guides set central_chat = ? where id = ?', id, g.id);
    run('update chats set title = ? where id = ?', `${profileOf(g).label}: ${get<{ name: string }>('select name from projects where slug = ?', g.project_slug)?.name ?? g.project_slug}`, id);
    return;
  }
  sendChat(g.central_chat, central, text, d.notify, d.changed, null, null, true);
}

export async function startGuide(slug: string, direct: boolean, focus: string | null, d: GuideDeps, kind = 'rumo'): Promise<GuideDto> {
  const open = get<GuideDto>(`select * from guides where project_slug = ? and direct = ? and kind = ? and status = 'open'`, slug, direct ? 1 : 0, kind);
  if (open) return open;
  const prof = profileOf({ kind });
  const snap = await prof.snapshot(slug, direct);
  const id = Number(run(`insert into guides (project_slug, direct, snapshot, phase, focus, kind) values (?,?,?, 'analysis', ?, ?)`, slug, direct ? 1 : 0, JSON.stringify(snap, null, 1), focus?.trim() || null, kind).lastInsertRowid);
  const g = getGuide(id)!;
  const sid = sendChat(null, prof.specialist(), prof.analysis(g), d.notify, d.changed, null, MODEL);
  run('update guides set strategist_chat = ? where id = ?', sid, id);
  run('update chats set title = ? where id = ?', `${prof.label} (especialista): ${String(snap.project)}`, sid);
  d.changed();
  return getGuide(id)!;
}

/** Uma conversa terminou de responder: passa a vez no debate. */
export function guideIdle(chatId: number, d: GuideDeps): void {
  const g = get<GuideDto>(`select * from guides where status = 'open' and (strategist_chat = ? or central_chat = ?)`, chatId, chatId);
  if (!g) return;
  if (chatId === g.strategist_chat && (g.phase === 'analysis' || g.phase === 'consult')) {
    const last = get<{ text: string }>(`select text from chat_messages where chat_id = ? and role = 'assistant' order by id desc limit 1`, chatId)?.text;
    if (!last) return;
    const peer = JSON.stringify({ agent_id: get<{ a: number }>('select agent_id a from chats where id = ?', chatId)?.a ?? profileOf(g).specialist(), text: last });
    if (g.phase === 'analysis') {
      run(`update guides set phase = 'reply' where id = ?`, g.id);
      toCentral(g, profileOf(g).reply(g, last), d);
      const fresh = getGuide(g.id)!;
      // a fala do estrategista entra antes da resposta da Central
      saveMessage(fresh.central_chat!, 'peer', peer, d.notify);
    } else {
      run(`update guides set phase = 'reply' where id = ?`, g.id);
      if (g.central_chat) {
        saveMessage(g.central_chat, 'peer', peer, d.notify);
        toCentral(g, `[Sessão #${g.id}] O especialista (${profileOf(g).label}) respondeu ao Gustavo:

${last}

Comente em 1 a 2 linhas (concorda? muda algo?). Se mudar os cards ou o plano, ajuste com guide_update.`, d);
      }
    }
    d.changed();
  } else if (chatId === g.central_chat && g.phase === 'reply') {
    run(`update guides set phase = 'idle' where id = ?`, g.id);
    d.changed();
  }
}

/** "E o estrategista, o que acha?": ele recebe a pergunta e o que se falou por último; a resposta entra na conversa */
export function askStrategist(id: number, question: string, d: GuideDeps): void {
  const g = getGuide(id);
  if (!g || g.status !== 'open') throw new Error('Sessão não encontrada.');
  const recent = g.central_chat ? all<{ role: string; text: string }>(`select role, text from chat_messages where chat_id = ? and role in ('user','assistant') order by id desc limit 6`, g.central_chat).reverse() : [];
  run(`update guides set phase = 'consult' where id = ?`, id);
  sendChat(g.strategist_chat, profileOf(g).specialist(), `[Sessão #${id}] O Gustavo quer sua opinião${question.trim() ? `: ${question.trim()}` : ' sobre o ponto atual'}.
Conversa recente (Gustavo e Central):
${recent.map(m => `${m.role === 'user' ? 'Gustavo' : 'Central'}: ${m.text.slice(0, 1200)}`).join('\n\n') || '(nada ainda)'}

Cards de agora:
${cardsText(parse<GuideCard>(g.cards))}

Responda direto, em até ~200 palavras. Não crie nem mude nada.`, d.notify, d.changed, null, MODEL);
  d.changed();
}

const parse = <T>(v: string | null): T[] => { try { return v ? JSON.parse(v) : []; } catch { return []; } };

/** guide_update (MCP): a Central entrega a leitura, os cards e o plano */
export function updateGuide(id: number, patch: { reading?: string; cards?: GuideCard[]; plan?: GuidePlanItem[] }): string {
  const g = getGuide(id);
  if (!g || g.status !== 'open') throw new Error('Sessão de guia não encontrada ou já fechada.');
  if (patch.reading !== undefined) run('update guides set reading = ? where id = ?', patch.reading.trim(), id);
  if (patch.cards) {
    // card com o mesmo id mantém a resposta que o Gustavo já deu
    const old = new Map(parse<GuideCard>(g.cards).map(c => [c.id, c]));
    const cards = patch.cards.slice(0, 8).map((c, i) => ({ ...c, id: c.id || `c${i + 1}`, answer: old.get(c.id)?.answer ?? null }));
    run('update guides set cards = ?, step = max(step, 2) where id = ?', JSON.stringify(cards), id);
  }
  if (patch.plan) {
    const items = patch.plan.slice(0, 30).map((p, i) => ({ ...p, id: p.id || `p${i + 1}`, when: ['agora', 'backlog', 'depois'].includes(p.when) ? p.when : 'backlog', include: true }));
    run('update guides set plan = ?, step = max(step, 3) where id = ?', JSON.stringify(items), id);
  }
  run('update guides set updated_at = ? where id = ?', now(), id);
  guidesChanged();
  return 'Pronto: o Gustavo já vê isso na tela.';
}

/** Direcionar com a sessão aberta ("precisamos focar em x, y e z"): a Central refaz os cards em torno disso */
export function setFocus(id: number, text: string, d: GuideDeps): void {
  const g = getGuide(id);
  const t = text.trim();
  if (!g || g.status !== 'open') throw new Error('Sessão não encontrada.');
  if (!t) throw new Error('Escreva o direcionamento.');
  if (!g.central_chat) { toCentral(g, `[Sessão #${id}] Você está numa sessão de ${profileOf(g).label} do projeto ${g.project_slug}. Retrato:\n${g.snapshot}\n\nCards atuais:\n${cardsText(parse<GuideCard>(g.cards))}`, d); g.central_chat = getGuide(id)!.central_chat; }
  run(`update guides set focus = ?, phase = 'reply' where id = ?`, g.focus ? `${g.focus}\n${t}` : t, id);
  saveMessage(g.central_chat!, 'user', `🧭 Direcionamento: ${t}`, d.notify);
  toCentral(g, `[Guia #${id}] O Gustavo deu um direcionamento antes de decidir: "${t}".
Refaça os cards com guide_update em torno disso (pode manter, mudar ou trocar cards; os que continuarem iguais mantêm o mesmo id).
Se o foco dele deixar de fora algo urgente, diga. Responda aqui em 2 a 3 linhas o que mudou.`, d);
  d.changed();
}

export function answerCard(id: number, cardId: string, answer: GuideCard['answer']): void {
  const g = getGuide(id);
  if (!g) throw new Error('Sessão não encontrada.');
  run('update guides set cards = ? where id = ?', JSON.stringify(parse<GuideCard>(g.cards).map(c => (c.id === cardId ? { ...c, answer } : c))), id);
}

export function setPlanItem(id: number, itemId: string, patch: Partial<Pick<GuidePlanItem, 'when' | 'include'>>): void {
  const g = getGuide(id);
  if (!g) throw new Error('Sessão não encontrada.');
  run('update guides set plan = ? where id = ?', JSON.stringify(parse<GuidePlanItem>(g.plan).map(p => (p.id === itemId ? { ...p, ...patch } : p))), id);
}

export function setStep(id: number, step: number): void { run('update guides set step = ? where id = ?', Math.max(1, Math.min(4, step)), id); }

export function requestPlan(id: number, d: GuideDeps): void {
  const g = getGuide(id);
  if (!g) throw new Error('Sessão não encontrada.');
  const cards = parse<GuideCard>(g.cards);
  if (!cards.some(c => c.answer)) throw new Error('Responda pelo menos um card.');
  run(`update guides set phase = 'reply' where id = ?`, id);
  toCentral(g, profileOf(g).plan(g, cards), d);
  d.changed();
}

/** Aprovar o plano: as respostas viram decisões no histórico e a Central executa (fecha com a ata). */
export function approvePlan(id: number, d: GuideDeps): void {
  const g = getGuide(id);
  if (!g || g.status !== 'open') throw new Error('Sessão não encontrada.');
  const cards = parse<GuideCard>(g.cards);
  const plan = parse<GuidePlanItem>(g.plan).filter(p => p.include);
  if (!plan.length) throw new Error('Nenhum item no plano.');
  for (const c of cards.filter(x => x.answer)) {
    const pick = c.answer!.choice != null ? c.options[c.answer!.choice]?.label : null;
    run(`insert into proposals (project_slug, title, body, status, source, source_ref, summary) values (?,?,?, 'approved', 'guia', ?, ?)`,
      g.project_slug, c.question, `${c.context ?? ''}\n\nEscolha: ${pick ?? 'outra'}${c.answer!.note ? `\nNota: ${c.answer!.note}` : ''}`.trim(),
      `${g.kind === 'agencia' ? 'agencia' : 'guia'}-${id}-${c.id}`, pick ?? c.answer!.note ?? null);
  }
  run(`update guides set step = 4, phase = 'reply', approved_at = ? where id = ?`, now(), id);
  toCentral(g, profileOf(g).execute(g, cards, plan), d);
  d.changed();
}

/** guide_finish (MCP): a ata fecha a sessão */
export function finishGuide(id: number, minutes: string): string {
  const g = getGuide(id);
  if (!g) throw new Error('Sessão não encontrada.');
  run(`update guides set status = 'done', minutes = ?, finished_at = ? where id = ?`, minutes.trim(), now(), id);
  guidesChanged();
  return 'Sessão fechada com a ata.';
}

export function abandonGuide(id: number): void { run(`update guides set status = 'abandoned', finished_at = ? where id = ? and status = 'open'`, now(), id); }

registerProfile('rumo', {
  label: 'Guiar', specialist: strategist, snapshot, analysis: analysisPrompt, reply: replyPrompt, plan: planPrompt, execute: executePrompt,
});

/** sessão sem conversa ainda (proposta da revisão semanal): abre a conversa com a Central já com o contexto */
export function talkGuide(id: number, d: GuideDeps): void {
  const g = getGuide(id);
  if (!g || g.status !== 'open') throw new Error('Sessão não encontrada.');
  if (g.central_chat) return;
  run(`update guides set phase = 'reply' where id = ?`, id);
  toCentral(g, `[Sessão #${id}] Sessão de ${profileOf(g).label} do projeto ${g.project_slug}, aberta pela revisão automática com esta proposta.
Leitura: ${g.reading ?? '(sem leitura)'}
Retrato:
${g.snapshot}

Cards:
${cardsText(parse<GuideCard>(g.cards))}

Apresente a proposta ao Gustavo em 3 a 5 linhas e fique à disposição para ajustar os cards (guide_update, guide_id ${id}).`, d);
  d.changed();
}

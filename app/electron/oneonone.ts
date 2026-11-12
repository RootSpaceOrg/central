/**
 * 1:1 com o dono do produto: a sala onde o Gustavo dirige cada produto. O dono abre com a pauta (o que fez, números, o que
 * vem, o que precisa dele); o Gustavo conversa, pede organização de rumo/time ou passa uma demanda nova, e o dono responde
 * com caminhos e cards. Respondidos, viram um plano com o que muda na prática (histórias, time, números, rumo); aprovado,
 * o dono executa e fecha com a ata. O estrategista é consultado quando o assunto pede. Mesmo motor do Guiar (guides.ts).
 *
 * Também aqui: métricas como dado (definição combinada com o dono, sem deploy) e o pedido de 1:1 que o dono faz.
 */
import type { GuideCard, GuideDto, GuidePlanItem } from '../src/app/shared/contract';
import { createAgent } from './agentdefs';
import { all, get, run } from './db';
import { listMetricDefs } from './metrics';
import { cardsText, registerProfile, scopeText, snapshot } from './guides';
import { CLEANUP, OWNER_HEAD, teamBlock } from './owner';

const STRATEGIST = 'Estrategista';
const strategistId = () => get<{ id: number }>('select id from agents where name = ? order by id limit 1', STRATEGIST)?.id
  ?? get<{ id: number }>('select id from agents where builtin = 1')!.id;
const ownerOf = (slug: string) => get<{ id: number; name: string }>('select a.id, a.name from projects p join agents a on a.id = coalesce(p.owner_agent_id, p.todo_agent_id) where p.slug = ?', slug);
const techOf = (slug: string) => get<{ id: number; name: string }>('select a.id, a.name from projects p join agents a on a.id = p.todo_agent_id where p.slug = ?', slug);

// ---------- o 1:1 (perfil do motor de sessões) ----------

async function oneSnapshot(slug: string, direct: boolean): Promise<Record<string, unknown>> {
  const base = await snapshot(slug, direct);
  const metrics = listMetricDefs(slug).map(d => {
    const last = get<{ value: number; at: string }>('select value, at from metrics where project_slug = ? and name = ? order by id desc limit 1', slug, d.name);
    return { name: d.name, value: last?.value ?? null, unit: d.unit, target: d.target, measured_at: last?.at ?? null, every_hours: d.every_hours };
  });
  const diary = all<{ at: string; result: string | null }>(`select created_at at, result from runs where project_slug = ? and prompt like ? and result is not null order by id desc limit 5`, slug, `${OWNER_HEAD}%`)
    .map(r => `${r.at.slice(0, 16).replace('T', ' ')}: ${(r.result ?? '').replace(/\s+/g, ' ').slice(0, 400)}`);
  const stories = all<{ id: number; title: string; c: string; parts: number; done: number }>(
    `select t.id, t.title, t."column" c, (select count(*) from tasks x where x.parent_id = t.id) parts,
       (select count(*) from tasks x where x.parent_id = t.id and x."column" in ('dev','done')) done
     from tasks t where t.project_slug = ? and t."column" <> 'done' and exists (select 1 from tasks x where x.parent_id = t.id) order by t.priority, t.id limit 12`, slug);
  return { ...base, metrics, stories: stories.map(s => `#${s.id} ${s.title} (${s.done}/${s.parts} partes, ${s.c})`), owner_diary: diary,
    one_on_one_request: get<{ r: string | null }>('select one_on_one r from projects where slug = ?', slug)?.r ?? null };
}

const openingPrompt = (g: GuideDto) => {
  const o = ownerOf(g.project_slug);
  return `[1:1 #${g.id}] Você é ${o?.name ?? 'o dono'}, DONO de ${scopeText(g.project_slug, !!g.direct)}. O Gustavo (o diretor) abriu um 1:1 com você.
Ele está vendo esta conversa ao vivo. Fale com ele de igual para igual, curto e concreto, em português.

Retrato em números (montado agora):
${g.snapshot}
${teamBlock(g.project_slug)}
${g.focus ? `\nO que ele trouxe para este 1:1: "${g.focus}"\n` : ''}
ANTES da pauta, faça a faxina (sem comentar na conversa; o que fechar entra na pauta):
${CLEANUP}

Abra com a PAUTA, em markdown curto (até ~250 palavras):
1. **O que fiz** desde o último 1:1 (histórias entregues, consertos, o que aprendi), com números.
2. **Números**: os que combinamos (metrics) e a direção deles; se faltar medir algo que o rumo pede, diga qual.
3. **O que vem**: as próximas histórias e por quê (ligue ao rumo e ao marco).
4. **O que preciso de você**: só o que é seu (decisão crítica, acesso, conta, opinião sobre rumo). Se nada, diga "nada".
5. **Limpei para você**: o que fechou na faxina (uma linha cada), se fechou algo.
${g.focus ? 'Depois da pauta, responda ao que ele trouxe.\n' : ''}
Se já tiver propostas concretas (caminhos para o próximo passo, um ajuste de rumo, de time ou de números), entregue também
como cards com guide_update(guide_id ${g.id}, cards): 2 a 5 cards, cada um com id curto, kind ('direcao' = caminhos para uma
frente ou demanda; 'rumo' = ajuste do rumo com o texto no detail; 'prioridade' = o que sobe/congela/corta; 'time' = mudança
no time; 'fluxo' = quadros; 'rotina' = algo periódico), question, context (o que muda NA PRÁTICA, 1-2 linhas), options
[{label, detail}] (detail = o que acontece se escolher), recommended (índice) e central (sua posição em 1 linha).
Durante o 1:1: quando ele pedir uma organização ou uma demanda nova ("nova frente de X", "repense o time"), responda com
caminhos em cards do mesmo jeito; ajuste os cards (guide_update) conforme a conversa. Se o assunto for rumo e você quiser
outra cabeça, diga que vale ouvir o estrategista (ele tem um botão para chamar). Não mude nada no projeto ainda: tudo
passa pelo plano que ele aprova.`;
};

const replyPrompt = (g: GuideDto, said: string) => `[1:1 #${g.id}] ${said}`;

const planPrompt = (g: GuideDto, cards: GuideCard[]) => `[1:1 #${g.id}] O Gustavo respondeu os cards:
${cardsText(cards)}

Monte o plano com guide_update(guide_id ${g.id}, plan): itens { id, kind, title, detail, why, agent, when }. É o que ele vai
aprovar, então tem que ser claro sobre O QUE MUDA NA PRÁTICA:
- title: o que acontece, em linguagem de usuário/negócio (ex.: "Professor vê quem não entregou antes da aula").
- why: por quê, em uma linha (a escolha dele que levou a isto).
- detail: como, em 1-3 linhas (para 'historia': as partes que você vai criar; para 'rumo': o texto novo; para 'metrica':
  nome, de onde vem, de quanto em quanto tempo, meta).
- kind: 'historia' (trabalho para o time; vira história com partes), 'rumo', 'marco', 'cortar', 'metrica', 'criar_agente',
  'ajustar_agente', 'aposentar_agente', 'quadro', 'rotina', 'ideia'.
- agent: quem do time faz (list_agents); histórias vão para o tech lead, quando houver.
- when: 'agora' (começa já), 'backlog' (fica pronto na fila), 'depois' (marco ou ideia).
Siga o que ele decidiu, sem inventar escopo. Resuma o plano aqui em 3 linhas.`;

const executePrompt = (g: GuideDto, cards: GuideCard[], plan: GuidePlanItem[]) => {
  const day = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `[1:1 #${g.id}] O Gustavo aprovou o plano. Execute exatamente estes itens, como dono do produto:
${plan.map(i => `- (${i.when}) [${i.kind}] ${i.title}${i.agent ? ` — ${i.agent}` : ''}${i.detail ? `\n  ${i.detail}` : ''}`).join('\n')}

Como fazer:
- historia: create_task com a história (título de usuário; corpo = como ele vai testar) e as partes com parent_id. 'agora' e
  'backlog': a história em todo (as partes vão junto). 'depois': história no backlog ou marco.
- rumo: update_direction com note "1:1 de ${day}" (ele aprovou aqui).
- marco: create_milestone / update_milestone. cortar: update_task / update_idea com o motivo.
- metrica: define_metric (nome, unit, how = de onde vem e como medir, every_hours, target) e já faça a primeira medida
  (report_metric) se der.
- time: create_agent / update_agent (instructions_append para acrescentar regra) / quadros / rotinas, como aprovado.
- Guarde na memória do projeto (memory_remember) o porquê das escolhas e o que foi descartado.

Decisões dele nos cards:
${cardsText(cards)}

No fim chame guide_finish(guide_id ${g.id}, minutes) com a ata em markdown curto (o que foi decidido, o que muda na prática,
quem faz). Depois diga aqui, em 2-3 linhas, o que já está andando.`;
};

/**
 * Dono de negócio para um produto: fala com o Gustavo (1:1, pauta, números, rumo), acorda pelos eventos e não mexe em
 * código (o técnico é do tech lead). Fica como dono do projeto; quem executa continua o mesmo.
 */
export function createBusinessOwner(slug: string): number {
  const p = get<{ name: string; color: string; owner: number | null }>('select name, color, owner_agent_id owner from projects where slug = ?', slug);
  if (!p) throw new Error('Projeto não encontrado.');
  if (p.owner) return p.owner;
  const a = createAgent({
    name: `Dono · ${p.name}`, color: p.color, icon_kind: 'letter', model: 'opus', permission: 'edits', room: 'gestao', project_slug: slug,
    description: `Dono do produto ${p.name}: responde pelo resultado, fala com o Gustavo no 1:1 e cuida do o quê e do porquê.`,
    instructions: `Você é o dono do produto ${p.name}. Pense como um bom gerente de produto: usuário, rumo, números e prioridade.
- Fale com o Gustavo em linguagem de negócio e de usuário, curto e direto. Nada de jargão técnico na pauta.
- O como é do tech lead: histórias que você cria vão para ele; antes de prometer prazo ou esforço, pergunte a ele.
- Você não edita código nem roda comandos: planeja, decide dentro do rumo, mede e cobra resultado.
- Traga sempre números (os combinados) e diga o que eles mostram.`,
  } as Parameters<typeof createAgent>[0]);
  run('update projects set owner_agent_id = ? where slug = ?', a.id, slug);
  return a.id;
}

/** "Ouvir o tech lead" no 1:1: a viabilidade e o esforço antes de você decidir */
export const techLeadOf = (slug: string) => techOf(slug)?.id ?? null;

registerProfile('dono', {
  label: '1:1',
  specialist: strategistId,
  snapshot: oneSnapshot,
  analysis: openingPrompt,
  reply: replyPrompt,
  plan: planPrompt,
  execute: executePrompt,
  voice: g => ownerOf(g.project_slug)?.id ?? get<{ id: number }>('select id from agents where builtin = 1')!.id,
  opening: g => {
    // abrir o 1:1 atende o pedido do dono
    run('update projects set one_on_one = null, one_on_one_at = null where slug = ?', g.project_slug);
    return openingPrompt(g);
  },
});

/**
 * Agentes da Central: "pessoas" com papel, instruções e ferramentas próprias (ex.: Suporte KultivAi, Sentinela de erros,
 * Marketing). Um agente pode conversar (chat com sessões), rodar em rotinas e receber tarefas. Projeto é opcional:
 * sem projeto ele trabalha numa pasta própria em Development/.central-agents/<slug>.
 */
import { app } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentDto, AgentPatch, NewAgentInput } from '../src/app/shared/contract';
import { DEV_ROOT, all, get, run } from './db';
import { slugify } from './projects';
import { contextBlock } from './context/context';

export const CENTRAL_SLUG = 'central';

/** Sempre liberado: a Central (MCP) e leitura. */
export const BASE_TOOLS = ['mcp__central', 'Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'TodoWrite', 'Agent', 'Task', 'Bash(git log:*)',
  'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git show:*)', 'Bash(gh pr list:*)', 'Bash(gh pr view:*)', 'Bash(gh issue list:*)',
  'Bash(gh issue view:*)', 'Bash(gh run list:*)', 'Bash(gh run view:*)', 'Bash(ls:*)'];

const CENTRAL_CONTEXT = `Você faz parte da Central do Gustavo, dev solo que toca vários produtos SaaS.
Responda sempre em português do Brasil, curto e direto, como um colega de trabalho.

Pelas ferramentas \`central\` (MCP) você enxerga e altera a Central: projetos (pastas em ${DEV_ROOT} com vários repositórios),
backlog em Kanban (backlog, todo, doing, review, done), base de ideias, decisões que esperam o Gustavo, agentes, rotinas e a cota do Claude.
O Gustavo é o gestor: ele aponta o caminho e aprova. A hierarquia é:
- Rumo do projeto (get_direction): para onde o projeto vai. Ele escreve; você segue. Proponha ajuste (update_direction) só com motivo.
- Ideias: insumo. Ideia nova (create_idea) vai para a triagem dele; só as aprovadas viram backlog.
- Tarefas: pedaços executáveis, de preferência ligados à ideia aprovada de onde vieram (create_task com idea_id).
- Memória (memory_recall/memory_remember): como as coisas são, não para onde vão.
- Decisões (create_decision): perguntas que só ele responde.
Regras:
- Consulte antes de afirmar. Números e estado vêm das ferramentas da Central, não de Bash.
- Não aprove ideias nem execute trabalho sem ele pedir; organizar o backlog de um projeto é plan_backlog (gestor do projeto).
- Excluir projeto, tarefa, rotina ou agente: só com pedido explícito.`;

const CENTRAL_ROLE = `Você é a Central, o braço direito do Gustavo como gestor dos projetos. Responde sobre qualquer projeto,
ajuda a escrever e manter os rumos, faz a triagem com ele (aprovar/descartar ideias quando ele disser), põe o gestor de um projeto
para planejar (plan_backlog), cria e ajusta agentes e rotinas, e coloca agentes para trabalhar (start_agent) quando ele pedir código.
Quando ele falar de forma genérica ("quero que o KultivAi foque em vendas"), traduza para o rumo do projeto e confirme.
Se a cota da sessão estiver acima de 80%, avise antes de disparar agentes.`;

export const listAgents = () => all<AgentDto>(`select a.*,
    (select count(*) from chats c where c.agent_id = a.id) chats,
    (select count(*) from routines r where r.agent_id = a.id) routines,
    (select count(*) from runs x where x.agent_id = a.id) runs
  from agents a order by a.builtin desc, a.name`).map(a => ({ ...a, builtin: !!a.builtin }));

export const getAgent = (id: number) => listAgents().find(a => a.id === id) ?? null;
export const centralAgent = () => listAgents().find(a => a.slug === CENTRAL_SLUG)!;

const ICONS = ['letter', 'emoji', 'lucide', 'image'];

function validate(i: Partial<NewAgentInput>): void {
  if (i.name !== undefined && !i.name.trim()) throw new Error('Dê um nome ao agente.');
  if (i.project_slug && !get('select 1 from projects where slug = ?', i.project_slug)) throw new Error('Projeto não encontrado.');
  if (i.permission && !['edits', 'full'].includes(i.permission)) throw new Error('Liberdade inválida.');
  if (i.icon_kind && !ICONS.includes(i.icon_kind)) throw new Error('Tipo de ícone inválido.');
  if ((i.icon_value?.length ?? 0) > 560_000) throw new Error('Imagem grande demais (máximo 400 KB).');
}

export function createAgent(i: NewAgentInput): AgentDto {
  validate(i);
  if (!i.name?.trim()) throw new Error('Dê um nome ao agente.');
  let slug = slugify(i.name) || 'agente';
  for (let n = 2; get('select 1 from agents where slug = ?', slug); n++) slug = `${slugify(i.name)}-${n}`;
  const { lastInsertRowid } = run(`insert into agents (slug, name, description, color, icon_kind, icon_value, project_slug, instructions, tools, permission, model)
      values (?,?,?,?,?,?,?,?,?,?,?)`,
    slug, i.name.trim(), i.description?.trim() || null, i.color ?? '#7FA2FF', i.icon_kind ?? 'letter', i.icon_value ?? null,
    i.project_slug || null, i.instructions?.trim() ?? '', (i.tools ?? []).join(','), i.permission ?? 'edits', i.model ?? '');
  return getAgent(Number(lastInsertRowid))!;
}

export function updateAgent(id: number, patch: AgentPatch): void {
  const cur = getAgent(id);
  if (!cur) throw new Error('Agente não encontrado.');
  validate(patch);
  const cols = ['name', 'description', 'color', 'icon_kind', 'icon_value', 'project_slug', 'instructions', 'permission', 'model'] as const;
  const fields: [string, string | null][] = cols.filter(k => k in patch).map(k => [k, ((patch[k] as string | null | undefined) ?? null)]);
  if (cur.builtin) for (const k of ['name', 'project_slug']) { const i = fields.findIndex(f => f[0] === k); if (i >= 0) fields.splice(i, 1); }
  if ('tools' in patch) fields.push(['tools', (patch.tools ?? []).join(',')]);
  if (!fields.length) return;
  run(`update agents set ${fields.map(([k]) => `${k} = ?`).join(', ')} where id = ?`, ...fields.map(([, v]) => (typeof v === 'string' ? v.trim() : v)), id);
}

export function deleteAgent(id: number): void {
  const a = getAgent(id);
  if (!a) throw new Error('Agente não encontrado.');
  if (a.builtin) throw new Error('A Central não pode ser excluída.');
  run('update routines set agent_id = null where agent_id = ?', id);
  run('update runs set agent_id = null where agent_id = ?', id);
  run('delete from chats where agent_id = ?', id);
  run('delete from agents where id = ?', id);
}

/** Pasta onde o agente trabalha: a do projeto, ou uma própria quando não tem projeto. */
export function agentCwd(a: AgentDto): string {
  if (a.project_slug) {
    const p = get<{ folder: string }>('select folder from projects where slug = ?', a.project_slug);
    if (p) return p.folder;
  }
  const dir = a.builtin ? DEV_ROOT : join(DEV_ROOT, '.central-agents', a.slug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Instruções completas (contexto da Central + papel do agente + projeto), gravadas num arquivo para --append-system-prompt-file. */
export function agentPromptFile(a: AgentDto): string {
  const project = a.project_slug ? get<{ name: string; folder: string; description: string | null }>(
    'select name, folder, description from projects where slug = ?', a.project_slug) : null;
  const repos = a.project_slug ? all<{ name: string }>('select name from repos where project_slug = ? order by name', a.project_slug).map(r => r.name) : [];
  const parts = [
    CENTRAL_CONTEXT,
    a.builtin ? CENTRAL_ROLE : `## Seu papel: ${a.name}\n${a.description ? `${a.description}\n` : ''}${a.instructions || 'Siga os pedidos do Gustavo dentro do seu papel.'}`,
    project
      ? `## Projeto\nVocê atua no projeto "${project.name}" (slug ${a.project_slug}), pasta ${project.folder}.\nRepositórios: ${repos.join(', ') || 'nenhum'}.${project.description ? `\nSobre: ${project.description}` : ''}`
      : a.builtin ? '' : `## Projeto\nVocê não pertence a um projeto. Sua pasta de trabalho é ${agentCwd(a)} (pode guardar rascunhos e notas lá). Use as ferramentas da Central para ver os projetos.`,
    a.permission === 'full' ? 'Você pode editar arquivos e rodar comandos sem perguntar. Nunca faça push para main, master ou develop.'
      : !a.project_slug && !a.builtin ? 'Você pode criar e editar arquivos só na sua pasta de trabalho. Para mexer em código de projeto, crie tarefas ou coloque um agente para trabalhar (start_agent).'
      : 'Você não edita arquivos de código: para isso, crie tarefas ou coloque um agente para trabalhar (start_agent).',
  ];
  // agente de projeto: mapa do código + memória (o foco é o papel dele)
  if (a.project_slug) parts.push(contextBlock(a.project_slug, [a.description ?? '', a.instructions], 1500));
  const dir = join(app.getPath('userData'), 'agents');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${a.slug}.md`);
  writeFileSync(file, parts.filter(Boolean).join('\n\n'));
  return file;
}

/** Sessão do Gustavo dentro de um projeto: ele conduz, o Claude lê, edita e roda build/teste/git na pasta. */
export const SESSION_TOOLS = [...BASE_TOOLS, 'Write', 'Edit', 'Bash(git:*)', 'Bash(gh:*)', 'Bash(npm:*)', 'Bash(npx:*)', 'Bash(node:*)',
  'Bash(python:*)', 'Bash(pytest:*)', 'Bash(uv:*)', 'Bash(dotnet:*)', 'Bash(cat:*)', 'Bash(grep:*)', 'Bash(find:*)'];

export function sessionPromptFile(slug: string): string {
  const p = get<{ name: string; folder: string; description: string | null }>('select name, folder, description from projects where slug = ?', slug);
  if (!p) throw new Error('Projeto não encontrado.');
  const repos = all<{ name: string }>('select name from repos where project_slug = ? order by name', slug).map(r => r.name);
  let text = [
    CENTRAL_CONTEXT,
    `## Sessão de trabalho no ${p.name}\nO Gustavo abriu esta sessão no projeto "${p.name}" (slug ${slug}), pasta ${p.folder}, e está conduzindo.
Repositórios: ${repos.join(', ') || 'nenhum'}.${p.description ? `\nSobre: ${p.description}` : ''}
Você pode ler e editar código e rodar build, testes e git. Nunca faça push para main, master ou develop.
Ao terminar algo, diga o que mudou em poucas linhas. O que ficar pendente vira tarefa no backlog deste projeto.
Se a conversa começou fora da Central (sessão importada do Claude Code ou do Orca), agora ela faz parte da Central:
use as ferramentas \`central\` para consultar backlog, ideias e decisões antes de responder sobre o que está pendente.`,
  ].join('\n\n');
  const dir = join(app.getPath('userData'), 'agents');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `session-${slug}.md`);
  const ctx = contextBlock(slug, [p.description ?? ''], 1000);
  if (ctx) text += `\n\n${ctx}`;
  writeFileSync(file, text);
  return file;
}

/** Ferramentas liberadas para o agente (além das que a liberdade "full" já libera). */
export const agentTools = (a: AgentDto) => [
  ...BASE_TOOLS,
  // agente sem projeto escreve na própria pasta (rascunhos, notas)
  ...(!a.project_slug && !a.builtin ? ['Write', 'Edit'] : []),
  ...a.tools.split(',').map(t => t.trim()).filter(Boolean),
];

/** Central (sempre) e exemplos (uma vez) para começar a usar. */
export function seedAgents(): void {
  if (!get('select 1 from agents where slug = ?', CENTRAL_SLUG)) {
    run(`insert into agents (slug, name, description, color, icon_kind, icon_value, builtin) values (?,?,?,?,?,?,1)`,
      CENTRAL_SLUG, 'Central', 'Organiza tudo: projetos, backlog, ideias, decisões, agentes e rotinas.', '#7FA2FF', 'lucide', 'sparkles');
  }
  // conversas de antes da v0.6 eram todas com a Central, na raiz de Development
  run('update chats set agent_id = ?, cwd = coalesce(cwd, ?) where agent_id is null', centralAgent().id, DEV_ROOT);
  if (get('select 1 from settings where key = ?', 'seed:agents:v1')) return;
  run(`insert into settings (key, value) values ('seed:agents:v1', ?)`, new Date().toISOString());
  const kultivai = get('select 1 from projects where slug = ?', 'kultivai') ? 'kultivai' : null;
  const examples: NewAgentInput[] = [
    {
      name: 'Suporte KultivAi', project_slug: kultivai, color: '#3FBF8A', icon_kind: 'emoji', icon_value: '🛟', permission: 'edits', model: '', tools: [],
      description: 'Responde dúvidas de suporte do KultivAi olhando o código e o runbook.',
      instructions: `Você é o suporte técnico do KultivAi (mkt-platform). Quando o Gustavo trouxer um problema de cliente:
1. Entenda o sintoma e localize no código (Lambdas, frontend, gateway) e no ops-runbook onde pode estar.
2. Explique a causa provável e como confirmar (logs, rotas, dados), sem inventar.
3. Se for bug, crie uma tarefa no backlog do kultivai com passos para reproduzir e onde mexer.
4. Se precisar de uma ação dele (ex.: falar com o cliente, liberar acesso), crie uma decisão.`,
    },
    {
      name: 'Sentinela de erros KultivAi', project_slug: kultivai, color: '#F07167', icon_kind: 'emoji', icon_value: '🚨', permission: 'edits', model: '',
      tools: ['mcp__sentry'],
      description: 'Olha os erros do Sentry do KultivAi e transforma o que importa em tarefas.',
      instructions: `Você vigia os erros de produção do KultivAi pelo Sentry (ferramentas mcp__sentry).
- Liste os erros novos ou que cresceram desde a última verificação (últimas 24 h).
- Para cada erro relevante, encontre no código onde ele nasce e crie uma tarefa no backlog do kultivai com: mensagem, frequência, usuários afetados, arquivo provável e sugestão de correção. Não duplique tarefas que já existem (consulte list_tasks).
- Erro grave ou afetando muitos usuários: crie também uma decisão de risco alto.
Se as ferramentas do Sentry não estiverem disponíveis, diga isso claramente no resumo (o Gustavo precisa autorizar o MCP do Sentry no Claude Code).`,
    },
    {
      name: 'Marketing', project_slug: null, color: '#B48CFF', icon_kind: 'emoji', icon_value: '📣', permission: 'edits', model: '', tools: [],
      description: 'Pensa conteúdo, posicionamento e crescimento para os produtos, sem projeto fixo.',
      instructions: `Você cuida de marketing e crescimento de todos os produtos do Gustavo (KultivAi, Alfabetizare, MatrizTech e o que mais existir na Central).
- Conheça cada produto pelas ferramentas da Central (descrição, atividade recente) antes de sugerir.
- Pesquise na web referências, concorrentes e tendências quando ajudar.
- Entregue ideias concretas: posts, campanhas, ganchos de landing page, experimentos de aquisição. Guarde as boas como ideias no projeto certo.
- Para textos longos (posts, roteiros), salve rascunhos em arquivos .md na sua pasta de trabalho e diga o caminho.`,
    },
  ];
  for (const a of examples) createAgent(a);
}

/** v0.6: agente de tendências e rotinas de exemplo (desligadas) para os agentes periódicos. */
export function seedAgentsV2(): void {
  if (get('select 1 from settings where key = ?', 'seed:agents:v2')) return;
  run(`insert into settings (key, value) values ('seed:agents:v2', ?)`, new Date().toISOString());
  const radar = createAgent({
    name: 'Radar de tendências', project_slug: null, color: '#4CC9F0', icon_kind: 'emoji', icon_value: '📡', permission: 'edits', model: '', tools: [],
    description: 'Pesquisa tendências, concorrentes e dores de clientes nos mercados dos produtos e traz oportunidades.',
    instructions: `Você é o radar de mercado do Gustavo. A cada execução:
1. Veja os produtos na Central (descrição e projetos ativos).
2. Pesquise na web, para cada mercado (marketing para pequenos negócios e redes sociais; educação/alfabetização para escolas; ensino de computação), o que mudou recentemente: lançamentos de concorrentes, mudanças de preço, novidades de plataformas (Instagram, Meta, IA), dores recorrentes em comunidades.
3. Guarde no máximo 5 oportunidades concretas como ideias no projeto certo, cada uma com a fonte (link) e por que importa agora. Não repita ideias que já existem (consulte list_ideas).
4. Escreva um resumo da semana num arquivo radar-AAAA-MM-DD.md na sua pasta.`,
  });
  const sentinel = get<{ id: number; project_slug: string | null }>(`select id, project_slug from agents where slug = 'sentinela-de-erros-kultivai'`);
  const routines: [number, string | null, string, string, string, number[], string][] = [
    [radar.id, null, 'Radar semanal', 'medium', 'Faça a varredura semanal de tendências e oportunidades.', [1], '09:00'],
  ];
  if (sentinel) routines.push([sentinel.id, sentinel.project_slug, 'Erros do Sentry de manhã', 'small', 'Verifique os erros das últimas 24 horas e transforme o que importa em tarefas.', [1, 2, 3, 4, 5], '08:30']);
  for (const [agentId, project, name, size, prompt, days, time] of routines) {
    run(`insert into routines (name, agent_id, project_slug, prompt, permission, size, schedule_kind, days, time, interval_hours, max_session, enabled, next_run_at)
         values (?,?,?,?, 'edits', ?, 'daily', ?, ?, 24, 70, 0, ?)`, name, agentId, project, prompt, size, days.join(','), time, new Date().toISOString());
  }
}

/**
 * Servidor MCP da Central: o agente Central, os agentes e as sessões do Claude Code abertas pela Central
 * leem e mexem em projetos, backlog, ideias, decisões e rotinas por aqui.
 * HTTP só em 127.0.0.1, porta aleatória e token novo a cada vez que o app abre.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { app } from 'electron';
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { z } from 'zod';

import { Emit, killRun, listEvents, listRuns, listTurns, startRun, startTurn } from './agents';
import { createAgent, deleteAgent, listAgents, updateAgent } from './agentdefs';
import {
  createIdea, createProposal, createTask, decide, deleteTask, importPending, listIdeas, listProposals, listTasks, promoteIdea,
  updateIdea, updateTask,
} from './backlog';
import { get, run } from './db';
import { createBoard, listBoards, resolveBoard, resolveStage, setStage, stagesOf } from './board';
import { digest, listDeliveries, reportDelivery } from './deliveries';
import { releaseStatus } from './release';
import { mcpConfigBody, setMcpConfig } from './mcp-config';
import { callerAgent, createMemory, forgetMemory, recallMemories } from './memories';
import { setStatus } from './activity';
import { createProject, deleteProject, listProjects, listRepos, recent, syncProjects, updateProject } from './projects';
import { SIZE_BUDGET, createRoutine, deleteRoutine, fireRoutine, listRoutines, updateRoutine } from './routines';
import { getUsage } from './usage';
import { getDirection, planBacklog, setDirection } from './direction';
import { createMilestone, listMilestones, updateMilestone } from './roadmap';
import { codeImpact, codeMap, codeNeighbors, codeSymbol, searchCode } from './context/context';
import { createFact, recallFacts, supersedeFact } from './context/memory';

export interface Hooks { emit: Emit; projects: () => void; backlog: () => void; routines: () => void; agents: () => void }

const INSTRUCTIONS = `Central do Gustavo: o lugar onde vivem os projetos dele (cada um é uma pasta em Development com vários repositórios),
o backlog (tarefas em Kanban: backlog, todo, doing, review, done), a base de ideias, as decisões que esperam por ele,
os agentes (definições com papel e instruções, com ou sem projeto), as execuções de agentes e as rotinas (execuções com agenda).
Cada projeto tem um rumo (get_direction) que o Gustavo define: siga-o. Ideias novas vão para a triagem dele; só as aprovadas
viram tarefas (create_task com idea_id). Tarefas e decisões sempre pertencem a um projeto (slug).
Prefira registrar descobertas como ideia (para triagem) ou tarefa ligada a uma ideia aprovada, em vez de só mencioná-las.`;

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (v: unknown): Result => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v ?? { ok: true }) }] });
const fail = (e: unknown): Result => ({ content: [{ type: 'text', text: `Erro: ${(e as Error)?.message ?? e}` }], isError: true });

const column = z.enum(['backlog', 'todo', 'doing', 'review', 'dev', 'done']);
const permission = z.enum(['edits', 'full']).describe('edits = seguro (repo: edita e roda git/npm; projeto: só lê). full = sem restrição');
const size = z.enum(['small', 'medium', 'large']).describe('tamanho do trabalho; limita o consumo da cota');

/** "Conteúdo: Roteiro" para cada quadro em que a tarefa está */
function placements(taskId: number): string[] {
  const boards = listBoards();
  return stagesOf().filter(p => p.task_id === taskId).map(p => {
    const b = boards.find(x => x.id === p.board_id);
    return `${b?.name ?? p.board_id}: ${b?.columns.find(c => c.key === p.stage)?.label ?? p.stage}`;
  });
}

function build(h: Hooks, caller: { kind: 'chat' | 'run'; id: number } | null): McpServer {
  const s = new McpServer({ name: 'central', version: app.getVersion() }, { instructions: INSTRUCTIONS });
  const tool = <T extends z.ZodRawShape>(name: string, description: string, shape: T, fn: (a: z.infer<z.ZodObject<T>>) => unknown, after?: () => void) =>
    s.registerTool(name, { description, inputSchema: shape }, (async (a: z.infer<z.ZodObject<T>>) => {
      try { const r = await fn(a); after?.(); return ok(r); } catch (e) { return fail(e); }
    }) as never);

  // ---------- panorama ----------
  tool('central_overview', 'Panorama: projetos com atividade, tarefas por coluna, decisões abertas, ideias novas, agentes rodando, cota do Claude.', {}, async () => {
    const tasks = listTasks(null);
    const usage = await getUsage(false);
    return {
      projects: listProjects().map(p => ({ slug: p.slug, name: p.name, status: p.status, repos: p.repo_count, commits_7d: p.commits_7d, last_commit: p.last_commit_subject })),
      tasks: Object.fromEntries(['backlog', 'todo', 'doing', 'review', 'done'].map(c => [c, tasks.filter(t => t.column === c).length])),
      directions: listProjects().filter(p => p.status !== 'dead').map(p => ({ slug: p.slug, rumo: getDirection(p.slug)?.text.split('\n').slice(0, 3).join(' ') ?? null })),
      open_decisions: listProposals(['proposed']).length,
      ideas_to_triage: listIdeas().filter(i => i.status === 'new').length,
      approved_ideas: listIdeas().filter(i => i.status === 'approved').length,
      running_agents: listRuns(null).filter(r => ['queued', 'preparing', 'running'].includes(r.status)).map(r => ({ id: r.id, project: r.project_slug, prompt: r.prompt.slice(0, 120) })),
      claude_usage: usage.limits.map(l => `${l.label}: ${l.percent}%`),
    };
  });

  // ---------- projetos ----------
  tool('list_projects', 'Lista todos os projetos (inclusive mortos) com pasta, status, cor e números.', {}, () =>
    listProjects().map(p => ({ slug: p.slug, name: p.name, status: p.status, folder: p.folder, description: p.description, color: p.color, icon: `${p.icon_kind}:${p.icon_kind === 'image' ? '(imagem)' : p.icon_value ?? ''}`, repos: p.repo_count, commits_30d: p.commits_30d })));
  tool('get_project', 'Detalhes de um projeto: repositórios (branch, mudanças sem commit), commits dos últimos 14 dias e tarefas abertas.', { slug: z.string() }, ({ slug }) => {
    const p = listProjects().find(x => x.slug === slug);
    if (!p) throw new Error('Projeto não encontrado.');
    return { ...p, icon_value: p.icon_kind === 'image' ? '(imagem)' : p.icon_value, spark: undefined, repos: listRepos(slug), recent_commits: recent(slug, 14, 40).map(c => `${c.committed_at.slice(0, 10)} ${c.repo_name}: ${c.subject}`), open_tasks: listTasks(slug).filter(t => t.column !== 'done').map(t => ({ id: t.id, title: t.title, column: t.column })) };
  });
  tool('create_project', 'Cria um projeto (pasta em Development). folder é opcional: padrão Development/<NomeSemEspacos>.', {
    name: z.string(), folder: z.string().optional(), status: z.enum(['active', 'maintenance', 'frozen']).optional(),
    color: z.string().optional().describe('hex, ex.: #3FBF8A'), description: z.string().optional(),
  }, a => {
    const folder = a.folder ?? join(app.getPath('home'), 'Development', a.name.normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(''));
    const p = createProject({ name: a.name, folder, status: a.status ?? 'active', color: a.color ?? '#7FA2FF', description: a.description ?? null });
    syncProjects(p.slug, h.projects);
    return p;
  }, h.projects);
  tool('update_project', 'Edita um projeto: nome, status (active, maintenance, frozen, dead), cor, descrição, ícone ou pasta.', {
    slug: z.string(), name: z.string().optional(), status: z.enum(['active', 'maintenance', 'frozen', 'dead']).optional(),
    color: z.string().optional(), description: z.string().optional(),
    icon_kind: z.enum(['letter', 'emoji', 'lucide']).optional(), icon_value: z.string().optional().describe('emoji ou nome de ícone Lucide em kebab-case'),
    folder: z.string().optional(),
  }, ({ slug, ...patch }) => { updateProject(slug, patch); if (patch.folder) syncProjects(slug, h.projects); }, h.projects);
  tool('delete_project', 'Remove um projeto da Central (a pasta e os repositórios continuam no disco). Só use se o Gustavo pediu explicitamente.', {
    slug: z.string(), confirm: z.literal(true).describe('precisa ser true'),
  }, ({ slug }) => deleteProject(slug), () => { h.projects(); h.backlog(); });

  // ---------- tarefas ----------
  tool('list_tasks', 'Lista tarefas do backlog. Filtros opcionais por projeto e coluna.', { project_slug: z.string().optional(), column: column.optional() }, a =>
    listTasks(a.project_slug ?? null).filter(t => !a.column || t.column === a.column).map(t => ({ id: t.id, project: t.project_slug, title: t.title, body: t.body?.slice(0, 300), column: t.column, boards: placements(t.id), priority: t.priority, repo: t.repo_path, pr: t.pr_url, agent: t.run_status })));
  tool('create_task', 'Cria tarefa no backlog de um projeto (ou direto num quadro: board + stage; aí o projeto é opcional). priority: 0 prioritária, 1 alta, 2 normal, 3 baixa.', {
    project_slug: z.string().optional(), board: z.union([z.number().int(), z.string()]).optional().describe('quadro onde o pedido entra (id ou nome)'),
    stage: z.string().optional().describe('coluna do quadro (padrão: a primeira)'), title: z.string(), body: z.string().optional(), column: column.optional(), priority: z.number().int().min(0).max(3).optional(),
    repo_path: z.string().optional().describe('caminho do repositório, se já souber onde o trabalho acontece'),
    idea_id: z.number().int().optional().describe('ideia aprovada de onde a tarefa nasceu (a ideia passa para "em andamento")'),
    milestone_id: z.number().int().optional().describe('marco do roadmap que a tarefa avança'),
  }, a => createTask({ project_slug: a.project_slug ?? null, board_id: a.board !== undefined ? resolveBoard(a.board) : null, stage: a.stage ?? null, repo_path: a.repo_path ?? null, title: a.title, body: a.body ?? null, column: a.column ?? 'backlog', priority: (a.priority ?? 2) as 0 | 1 | 2 | 3, idea_id: a.idea_id ?? null, milestone_id: a.milestone_id ?? null, source: 'central', source_ref: `${Date.now()}-${Math.random()}` }), h.backlog);
  tool('update_task', 'Edita ou move uma tarefa (coluna, prioridade, título, descrição, projeto, repositório).', {
    id: z.number().int(), title: z.string().optional(), body: z.string().optional(), column: column.optional(), priority: z.number().int().min(0).max(3).optional(),
    project_slug: z.string().optional(), repo_path: z.string().optional(), milestone_id: z.number().int().optional(),
  }, ({ id, ...patch }) => updateTask(id, { ...patch, priority: patch.priority as 0 | 1 | 2 | 3 | undefined, position: patch.column ? 0 : undefined }), h.backlog);

  // ---------- quadros (workflows): independentes de projeto; uma tarefa pode estar em vários ----------
  tool('list_boards', 'Quadros (workflows): colunas, o agente de cada coluna e quantas tarefas abertas.', {}, () =>
    listBoards().map(b => ({ id: b.id, name: b.name, project: b.project_slug, description: b.description, open: b.open_tasks,
      columns: b.columns.map(c => ({ key: c.key, label: c.label, description: c.description, agent_id: c.agent_id, next: c.next_key })) })));
  tool('create_board', 'Cria um quadro (workflow) com colunas; cada coluna pode ter um agente (de qualquer projeto) que pega o que entra nela. Só quando o Gustavo pedir.', {
    name: z.string(), description: z.string().optional(), project_slug: z.string().optional().describe('vazio = quadro solto'),
    columns: z.array(z.object({ label: z.string(), description: z.string().optional(), agent_id: z.number().int().optional(), instruction: z.string().optional(),
      kind: z.enum(['backlog', 'todo', 'doing', 'review', 'dev', 'done']).optional().describe('reflete no backlog principal') })).min(1),
  }, a => createBoard({ name: a.name, description: a.description ?? null, project_slug: a.project_slug ?? null, columns: a.columns }), h.backlog);
  tool('move_on_board', 'Põe ou move uma tarefa numa coluna de um quadro (a tarefa pode estar em vários quadros).', {
    task_id: z.number().int(), board: z.union([z.number().int(), z.string()]).describe('id ou nome do quadro'), stage: z.string().describe('coluna (nome ou key)'),
  }, a => {
    const b = resolveBoard(a.board);
    if (!b) throw new Error('Quadro não encontrado.');
    const s = resolveStage(b, a.stage);
    if (!s) throw new Error('Coluna não encontrada nesse quadro.');
    setStage(a.task_id, b, s);
    return 'ok';
  }, h.backlog);
  tool('delete_task', 'Exclui uma tarefa. Só use se o Gustavo pediu.', { id: z.number().int() }, ({ id }) => deleteTask(id), h.backlog);

  // ---------- ideias ----------
  const ideaStatus = z.enum(['new', 'approved', 'doing', 'done', 'archived']);
  tool('list_ideas', 'Lista ideias. status: new (esperando triagem do Gustavo), approved (aprovadas: insumo para o backlog), doing (já têm tarefas), done, archived (descartadas). Padrão: new e approved.', {
    status: ideaStatus.optional(), project_slug: z.string().optional(),
  }, a => listIdeas().filter(i => (a.status ? i.status === a.status : ['new', 'approved'].includes(i.status)) && (!a.project_slug || i.project_slug === a.project_slug))
    .map(i => ({ id: i.id, project: i.project_slug, status: i.status, title: i.title, body: i.body?.slice(0, 300), author: i.author, tasks: i.tasks, tasks_done: i.tasks_done })));
  tool('create_idea', 'Sugere uma ideia (vai para a triagem do Gustavo; só vira backlog depois que ele aprovar). milestone_id liga ao marco do roadmap que ela serve.', {
    title: z.string(), body: z.string().optional(), project_slug: z.string().optional(), milestone_id: z.number().int().optional(),
  }, a => createIdea({ title: a.title, body: a.body ?? null, project_slug: a.project_slug ?? null, source: 'central', author: 'agente', milestone_id: a.milestone_id ?? null }), h.backlog);
  tool('update_idea', 'Edita uma ideia ou muda o status. Aprovar (approved) ou descartar (archived) só quando o Gustavo pedir.', {
    id: z.number().int(), title: z.string().optional(), body: z.string().optional(), project_slug: z.string().optional(), status: ideaStatus.optional(),
    milestone_id: z.number().int().optional().describe('liga a ideia a um marco do roadmap'),
  }, ({ id, ...patch }) => updateIdea(id, patch), h.backlog);

  // ---------- rumo do projeto e gestor ----------
  tool('get_direction', 'Rumo atual do projeto (para onde vamos: objetivo, foco do momento, o que não fazer), definido pelo Gustavo.', { project_slug: z.string() }, a =>
    getDirection(a.project_slug) ?? 'Este projeto ainda não tem rumo escrito.');
  tool('update_direction', 'Atualiza o rumo do projeto (nova versão; a anterior fica no histórico). Só quando o Gustavo pediu ou quando o que você viu deixou o rumo desatualizado; explique o motivo em note.', {
    project_slug: z.string(), text: z.string().describe('rumo completo em markdown curto: Objetivo, Foco agora, Não fazer, Próximos marcos'), note: z.string().describe('por que mudou'),
  }, a => setDirection(a.project_slug, a.text, 'agente', a.note), h.projects);
  const horizon = z.enum(['now', 'next', 'later', 'done']).describe('now = Agora, next = Próximo, later = Depois, done = Feito');
  // ---------- entregas, o que aconteceu, produção ----------
  tool('list_deliveries', 'Notas de entrega das execuções (o que mudou, por quê, como testar, riscos, PR). status: review = esperando a revisão do Gustavo.', {
    status: z.enum(['review', 'info', 'accepted', 'adjusting', 'discarded', 'paused']).optional(), since: z.string().optional().describe('ISO; padrão: últimos 7 dias'),
    project_slug: z.string().optional(),
  }, a => listDeliveries(a.since ?? new Date(Date.now() - 7 * 86_400_000).toISOString(), a.status ?? null)
    .filter(d => !a.project_slug || d.project_slug === a.project_slug)
    .map(d => ({ id: d.id, run: d.run_id, project: d.project_slug, agent: d.agent_name, task: d.task_id, title: d.title, what: d.what.slice(0, 400),
      how_to_test: d.how_to_test, risks: d.risks, pr: d.pr_url, files: d.files, status: d.status, explained: d.explained, at: d.created_at })));
  tool('what_happened', 'Resumo do que aconteceu desde um momento: entregas, tarefas concluídas, roadmap, ideias, decisões, memórias, execuções e tempo de agente.', {
    since: z.string().describe('ISO (ex.: ontem 18h)'),
  }, a => {
    const d = digest(a.since);
    return { ...d, deliveries: d.deliveries.map(x => ({ project: x.project_slug, agent: x.agent_name, title: x.title, status: x.status, failed: x.outcome === 'failed' })) };
  });
  tool('production_status', 'O que está em develop e ainda não está em main (esperando produção), por repositório do projeto, com PRs e há quanto tempo.', {
    project_slug: z.string(), refresh: z.boolean().optional().describe('buscar o remoto agora (git fetch)'),
  }, async a => (await releaseStatus(a.project_slug, !!a.refresh)).filter(r => r.items.length || r.error)
    .map(r => ({ repo: r.name, from: r.dev, to: r.prod, commits: r.commits, oldest: r.oldest_at, error: r.error,
      prs: r.items.map(i => ({ pr: i.pr, title: i.title, author: i.author, at: i.at, delivery: i.delivery, task: i.task_id })) })));

  tool('list_milestones', 'Roadmap do projeto: marcos em Agora / Próximo / Depois / Feito, com progresso das tarefas ligadas.', { project_slug: z.string() }, a =>
    listMilestones(a.project_slug).map(m => ({ id: m.id, title: m.title, horizon: m.horizon, target: m.target, tasks: `${m.tasks_done}/${m.tasks}`, description: m.description, ideas: m.ideas, author: m.author, note: m.note })));
  const why = z.string().describe('de onde veio / por quê, curto (ex.: "reunião 02/11: cliente pediu exportação"). Aparece no histórico do roadmap.');
  tool('create_milestone', 'Cria um marco no roadmap do projeto (resultado que importa, não uma tarefa).', {
    project_slug: z.string(), title: z.string(), description: z.string().optional(), horizon: horizon.optional(), target: z.string().optional().describe('alvo livre: "dez", "Q1"'), note: why,
  }, a => createMilestone(a.project_slug, a, 'agente'), h.backlog);
  tool('update_milestone', 'Edita um marco ou muda o horizonte (ex.: concluído → done). Diga o motivo em note.', {
    id: z.number().int(), title: z.string().optional(), description: z.string().optional(), horizon: horizon.optional(), target: z.string().optional(), note: why,
  }, ({ id, ...i }) => updateMilestone(id, i, 'agente'), h.backlog);

  tool('plan_backlog', 'Põe o gestor do projeto para organizar o backlog a partir do rumo e das ideias aprovadas (roda como execução de agente). Use quando o Gustavo pedir para planejar/organizar um projeto.', {
    project_slug: z.string(), request: z.string().optional().describe('pedido específico do Gustavo'),
  }, a => { const r = planBacklog(a.project_slug, a.request ?? null, h.emit); return `Gestor trabalhando (execução #${r.id}).`; }, h.backlog);
  tool('promote_idea', 'Transforma uma ideia em tarefa no backlog do projeto.', { id: z.number().int(), project_slug: z.string() }, a => promoteIdea(a.id, a.project_slug), h.backlog);

  // ---------- decisões ----------
  tool('list_decisions', 'Lista decisões. status: proposed (esperando o Gustavo, padrão), approved, rejected, deferred, done.', { status: z.enum(['proposed', 'approved', 'rejected', 'deferred', 'running', 'done']).optional() }, a =>
    listProposals([a.status ?? 'proposed']).map(p => ({ id: p.id, project: p.project_slug, title: p.title, body: p.body, next_action: p.next_action, tier: p.tier })));
  tool('create_decision', 'Cria uma decisão para o Gustavo aprovar ou recusar. next_action: o que acontece se ele aprovar. tier: 0 risco baixo, 1 médio, 2 alto. task_id: quando a escolha é sobre uma tarefa que já existe (a decisão volta para ela, sem criar outra tarefa).', {
    title: z.string(), body: z.string().optional(), project_slug: z.string().optional(), next_action: z.string().optional(), tier: z.number().int().min(0).max(2).optional(),
    task_id: z.number().int().optional(),
  }, a => createProposal({ title: a.title, body: a.body ?? null, project_slug: a.project_slug ?? null, next_action: a.next_action ?? null, tier: a.tier ?? null, source: 'central', task_id: a.task_id ?? null }), () => { h.backlog(); h.projects(); });
  tool('decide', 'Registra a decisão do Gustavo sobre uma decisão (só quando ele disser o que quer). approve cria tarefa em todo.', {
    id: z.number().int(), verdict: z.enum(['approve', 'defer', 'reject']), reason: z.string().optional(),
  }, a => decide(a.id, a.verdict, a.reason ?? null), () => { h.backlog(); h.projects(); });

  // ---------- agentes (definições) ----------
  const agentShape = {
    name: z.string().optional(), description: z.string().optional(), project_slug: z.string().nullable().optional().describe('null = sem projeto'),
    instructions: z.string().optional().describe('papel e jeito de trabalhar do agente'), color: z.string().optional(),
    icon_kind: z.enum(['letter', 'emoji', 'lucide']).optional(), icon_value: z.string().optional().describe('emoji ou nome de ícone Lucide'),
    tools: z.array(z.string()).optional().describe('ferramentas extras, ex.: mcp__sentry'), permission: permission.optional(),
    model: z.enum(['', 'sonnet', 'opus', 'haiku', 'fable']).optional(),
    room: z.enum(['', 'gestao', 'eng', 'monitor', 'creative', 'business']).optional()
      .describe('sala no Escritório: gestao, eng (engenharia), monitor, creative, business; vazio = deduz pelo papel'),
  };
  tool('list_agents', 'Agentes definidos (papel, projeto, ferramentas extras, quantas conversas, rotinas e execuções).', {}, () =>
    listAgents().map(a => ({ id: a.id, name: a.name, description: a.description, project: a.project_slug, tools: a.tools, permission: a.permission, model: a.model, builtin: a.builtin, chats: a.chats, routines: a.routines, runs: a.runs, instructions: a.instructions.slice(0, 400) })));
  tool('create_agent', 'Cria um agente (ex.: "Suporte KultivAi", "Marketing"). project_slug é opcional: sem projeto ele trabalha numa pasta própria.', { ...agentShape, name: z.string() }, a =>
    createAgent({ ...a, name: a.name, project_slug: a.project_slug ?? null }), h.agents);
  tool('update_agent', 'Edita um agente: nome, papel/instruções, projeto, ferramentas, liberdade, modelo, ícone.', { id: z.number().int(), ...agentShape }, ({ id, ...patch }) => updateAgent(id, patch), h.agents);
  tool('delete_agent', 'Exclui um agente (e as conversas dele). Só use se o Gustavo pediu explicitamente.', { id: z.number().int(), confirm: z.literal(true) }, ({ id }) => deleteAgent(id), () => { h.agents(); h.routines(); });

  // ---------- execuções ----------
  tool('list_agent_runs', 'Execuções de agentes recentes (status, projeto, PR, resultado).', { project_slug: z.string().optional(), limit: z.number().int().max(50).optional() }, a =>
    listRuns(a.project_slug ?? null).slice(0, a.limit ?? 15).map(r => ({ id: r.id, project: r.project_slug, scope: r.scope, status: r.status, prompt: r.prompt.slice(0, 160), pr: r.pr_url, result: r.result?.slice(0, 400), session_used: r.usage_start != null && r.usage_end != null ? `${Math.max(r.usage_end - r.usage_start, 0)}%` : null })));
  tool('get_agent_run', 'Log de uma execução de agente (últimos eventos).', { id: z.number().int() }, ({ id }) => listEvents(id).slice(-40).map(e => `${e.kind}: ${e.text.slice(0, 400)}`));
  tool('start_agent', 'Coloca um agente para trabalhar numa tarefa. agent_id usa o papel e as ferramentas de um agente definido. Sem repo_path atua na pasta do projeto inteira (edits = só lê e organiza); com repo_path trabalha numa worktree e termina em PR draft; sem projeto (agente sem projeto) trabalha na pasta do agente.', {
    prompt: z.string(), project_slug: z.string().optional(), agent_id: z.number().int().optional(), repo_path: z.string().optional(),
    permission: permission.optional(), size: size.optional(), task_id: z.number().int().optional(),
  }, a => startRun({ project_slug: a.project_slug ?? null, agent_id: a.agent_id ?? null, repo_path: a.repo_path ?? null, prompt: a.prompt, permission: a.permission ?? 'edits', budget_usd: SIZE_BUDGET[a.size ?? 'medium'], proposal_id: null, task_id: a.task_id ?? null }, h.emit), h.backlog);
  tool('stop_agent', 'Interrompe uma execução de agente.', { id: z.number().int() }, ({ id }) => killRun(id, h.emit));
  tool('start_turn', 'Deixa um projeto evoluindo: vários agentes em paralelo em tarefas do backlog até um horário (ISO).', {
    project_slug: z.string(), items: z.array(z.object({ task_id: z.number().int(), repo_path: z.string() })), until: z.string(), size: size.optional(), permission: permission.optional(),
  }, a => startTurn({ project_slug: a.project_slug, items: a.items, until: a.until, budget_usd: SIZE_BUDGET[a.size ?? 'medium'] * a.items.length, permission: a.permission ?? 'edits' }, h.emit), h.backlog);
  tool('list_turns', 'Turnos recentes (deixar evoluindo) e seus resultados.', {}, () => listTurns().slice(0, 10));

  // ---------- rotinas ----------
  tool('list_routines', 'Rotinas (agentes com agenda): o que fazem, quando rodam, último resultado.', {}, () => listRoutines());
  tool('create_routine', 'Cria rotina (execução com agenda). schedule_kind daily: dias (0=domingo) e time HH:MM; interval: a cada interval_hours. agent_id faz a rotina rodar com o papel de um agente. Sem repo_path atua no projeto inteiro (edits = só lê e alimenta backlog, ideias e decisões).', {
    name: z.string(), project_slug: z.string().optional(), agent_id: z.number().int().optional(), prompt: z.string(), repo_path: z.string().optional(), permission: permission.optional(), size: size.optional(),
    schedule_kind: z.enum(['daily', 'interval']).optional(), days: z.array(z.number().int().min(0).max(6)).optional(), time: z.string().optional(),
    interval_hours: z.number().int().min(1).optional(), max_session: z.number().int().min(10).max(100).optional(), enabled: z.boolean().optional(),
  }, a => createRoutine({ ...a, project_slug: a.project_slug ?? null, agent_id: a.agent_id ?? null, repo_path: a.repo_path ?? null, permission: a.permission ?? 'edits', size: a.size ?? 'small', schedule_kind: a.schedule_kind ?? 'daily', days: a.days ?? [1, 2, 3, 4, 5], time: a.time ?? '08:00', interval_hours: a.interval_hours ?? 24 }), h.routines);
  tool('update_routine', 'Edita, liga ou desliga (enabled) uma rotina.', {
    id: z.number().int(), name: z.string().optional(), agent_id: z.number().int().nullable().optional(), prompt: z.string().optional(), repo_path: z.string().optional(), permission: permission.optional(), size: size.optional(),
    schedule_kind: z.enum(['daily', 'interval']).optional(), days: z.array(z.number().int().min(0).max(6)).optional(), time: z.string().optional(),
    interval_hours: z.number().int().min(1).optional(), max_session: z.number().int().min(10).max(100).optional(), enabled: z.boolean().optional(),
  }, ({ id, ...patch }) => updateRoutine(id, patch), h.routines);
  tool('delete_routine', 'Exclui uma rotina. Só use se o Gustavo pediu.', { id: z.number().int() }, ({ id }) => deleteRoutine(id), h.routines);
  tool('run_routine_now', 'Roda uma rotina agora, fora da agenda.', { id: z.number().int() }, ({ id }) => fireRoutine(id, h.emit, true), h.routines);

  // ---------- outros ----------
  tool('get_claude_usage', 'Cota do plano do Claude: sessão (5h), semana e limites por modelo, com horário de reinício.', {}, async () => (await getUsage(false)).limits);
  tool('import_pending', 'Importa pendências espalhadas: memórias do Claude, checklists de ROADMAP/PLAN e PRs abertos.', {}, () => importPending(), h.backlog);

  // ---------- código (índice local: símbolos, ligações e rank) ----------
  const kind = z.enum(['any', 'file', 'class', 'interface', 'type', 'function', 'method', 'component', 'service', 'route', 'lambda', 'tf_resource']);
  tool('code_map', 'Mapa ranqueado do código do projeto (arquivos e assinaturas mais relevantes para o foco), dentro de um orçamento de tokens. Use para se orientar antes de abrir arquivos.', {
    project: z.string().describe('slug do projeto'),
    focus: z.array(z.string()).optional().describe('arquivos, símbolos ou termos da tarefa: puxam o ranking para perto deles'),
    repo: z.string().optional().describe('nome do repositório para limitar'),
    budget: z.number().int().min(256).max(8000).optional().describe('tokens; padrão 2000'),
  }, a => codeMap(a.project, a.focus ?? [], a.budget ?? 2000, a.repo ?? null) || 'Índice vazio para este projeto (ainda indexando ou sem repositórios).');
  tool('code_search', 'Busca símbolos e arquivos por nome ou termo (pedaços de camelCase/snake_case valem), ordenados por relevância e importância.', {
    project: z.string(), query: z.string(), kind: kind.optional(), limit: z.number().int().max(50).optional(),
  }, a => searchCode(a.project, a.query, a.kind ?? 'any', a.limit ?? 15));
  tool('code_symbol', 'Definição de um símbolo ou arquivo: assinatura, doc, local e o código-fonte (com limite de linhas). key vem do code_search; nome simples também serve.', {
    key: z.string(), project: z.string().optional(), source: z.boolean().optional(), max_lines: z.number().int().max(400).optional(),
  }, a => codeSymbol(a.key, a.source ?? true, a.max_lines ?? 120, a.project ?? null));
  tool('code_neighbors', 'Quem usa e o que usa um símbolo, arquivo ou rota (importa, chama, injeta, chama a rota, rota declarada em, publica, testa). Ligações com confiança < 0.8 são heurísticas.', {
    key: z.string(), project: z.string().optional(), direction: z.enum(['in', 'out', 'both']).optional(),
    kinds: z.array(z.string()).optional().describe('imports, calls, references, injects, http_calls, routes_to, deploys, tests, template'),
    depth: z.number().int().min(1).max(3).optional(), limit: z.number().int().max(100).optional(),
  }, a => codeNeighbors(a.key, a.direction ?? 'both', a.depth ?? 1, a.kinds ?? null, a.limit ?? 30, a.project ?? null));
  tool('code_impact', 'Raio de impacto de uma mudança: arquivos, rotas e testes que dependem dos símbolos (ou das mudanças atuais no git).', {
    project: z.string(), keys: z.array(z.string()).optional(), git_diff: z.boolean().optional().describe('usar os arquivos alterados no working tree'),
    depth: z.number().int().min(1).max(4).optional(),
  }, a => codeImpact(a.project, a.keys ?? [], a.git_diff ?? false, a.depth ?? 2));

  // ---------- memória do projeto ----------
  tool('memory_recall', 'Fatos, decisões, convenções e armadilhas registrados do projeto (opcionalmente ligados a arquivos/símbolos).', {
    project: z.string(), query: z.string().optional(), keys: z.array(z.string()).optional(), limit: z.number().int().max(30).optional(),
  }, a => recallFacts(a.project, a.query ?? '', a.keys ?? [], a.limit ?? 10));
  tool('memory_remember', 'Registra um fato durável que o código não mostra (decisão, convenção, armadilha, como fazer). Uma afirmação curta e auto-contida.', {
    project: z.string(), kind: z.enum(['decision', 'convention', 'gotcha', 'fact', 'howto']), text: z.string().max(400),
    links: z.array(z.string()).optional().describe('keys de arquivos/símbolos relacionados (do code_search)'),
  }, a => createFact({ project_slug: a.project, kind: a.kind, text: a.text, links: a.links, source_kind: 'agent', author: 'agente' }), h.projects);
  tool('memory_supersede', 'Marca um fato como inválido (com motivo) e opcionalmente registra o substituto.', {
    id: z.number().int(), reason: z.string(), replacement: z.string().max(400).optional(),
  }, a => supersedeFact(a.id, a.reason, a.replacement ?? null, 'agente') ?? 'ok', h.projects);
  // ---------- memória do agente (entre conversas) ----------
  const me = callerAgent(caller);
  tool('remember', 'Guarda algo para lembrar nas próximas conversas: preferência do Gustavo, correção que ele fez, pessoa/cliente, decisão que vale além de um projeto, jeito de fazer. Curto e auto-contido. Fato de código de um projeto vai em memory_remember.', {
    text: z.string().max(400), kind: z.enum(['preferencia', 'fato', 'decisao', 'pessoa', 'como_fazer']),
    para: z.enum(['mim', 'todos']).describe('mim = sobre o SEU trabalho/papel (ex.: regras dos seus posts, do seu suporte); todos = sobre o Gustavo em geral ou algo que outros agentes também precisam (preferências gerais, clientes, decisões entre projetos). Na dúvida, mim.'),
  }, a => {
    const m = createMemory({ agent_id: a.para === 'mim' && me ? me : null, kind: a.kind, text: a.text, author: 'agente', source: caller ? `${caller.kind} #${caller.id}` : null });
    return `Guardado (#${m.id}, ${m.agent_id ? 'sua' : 'de todos'}).`;
  }, h.agents);
  tool('recall', 'Procura na sua memória e na de todos os agentes (o prompt já traz as principais; use para buscar algo específico).', { query: z.string().optional() },
    a => recallMemories(me, a.query ?? ''));
  tool('forget', 'Esquece uma memória que ficou errada ou velha (sai do prompt, fica registrado o motivo).', { id: z.number().int(), reason: z.string() }, a => {
    const m = get<{ agent_id: number | null }>('select agent_id from memories where id = ?', a.id);
    if (!m) return 'Memória não encontrada.';
    if (m.agent_id && m.agent_id !== me) return 'Essa memória é de outro agente.';
    forgetMemory(a.id, a.reason, 'agente');
    return 'Esquecida.';
  }, h.agents);

  // ---------- nota de entrega e espera (só execuções) ----------
  if (caller?.kind === 'run') {
    tool('need_gustavo', 'Falta algo que só o Gustavo resolve (sessão AWS/SSO expirada, gh sem login, credencial, VPN, acesso): registre e PARE. Ele resolve e a Central te retoma de onde parou, na mesma sessão. Não contorne nem desista da tarefa.', {
      reason: z.string().max(200).describe('o que falta, curto (ex.: "sessão AWS SSO expirada no perfil mkt-platform")'),
      fix: z.string().max(400).describe('o que ele precisa fazer'),
      command: z.string().max(300).optional().describe('o comando que ele roda, se houver (ex.: aws sso login --profile mkt-platform)'),
    }, a => {
      run('update runs set waiting = ? where id = ?', JSON.stringify({ reason: a.reason, fix: a.fix, command: a.command ?? null }), caller.id);
      return 'Registrado. Termine agora: diga em poucas linhas o que já fez e onde parou. A Central te retoma quando o Gustavo resolver.';
    }, h.backlog);
    tool('report_delivery', 'Antes de terminar, conte ao Gustavo o que você entregou. Ele lê isso no resumo de quando estava fora e na fila de revisão.', {
      title: z.string().max(160).describe('a entrega em uma linha (ex.: "Exportação do roadmap em PDF")'),
      what: z.string().max(2000).describe('o que mudou, concreto (arquivos/telas/comportamento)'),
      why: z.string().optional().describe('por que assim'),
      how_to_test: z.string().optional().describe('como o Gustavo confere em 1 minuto'),
      risks: z.string().optional().describe('o que ficou de fora, dúvidas, riscos'),
    }, a => { reportDelivery(caller.id, a); return 'Entrega registrada.'; }, h.backlog);
  }

  // ---------- status ao vivo (só quando a sessão foi aberta pela Central e sabemos quem chama) ----------
  if (caller) {
    tool('set_status', 'Mostra no painel do Gustavo (Escritório) o que você está fazendo agora. Chame ao começar cada etapa do trabalho: curto e concreto.', {
      phase: z.enum(['planejando', 'investigando', 'construindo', 'testando', 'revisando', 'entregando', 'escrevendo', 'esperando'])
        .describe('a etapa: planejando, investigando (lendo/entendendo), construindo (editando código), testando, revisando, entregando (commit/PR), escrevendo (texto), esperando'),
      doing: z.string().max(140).describe('o que, em poucas palavras (ex.: "exportação do roadmap em PDF")'),
      task_id: z.number().int().optional().describe('tarefa do backlog em que está trabalhando, se houver'),
    }, a => {
      const task = a.task_id ? get<{ id: number; title: string }>('select id, title from tasks where id = ?', a.task_id) ?? null : null;
      return setStatus(caller.kind, caller.id, a.phase, a.doing, task) ? 'ok' : 'Esta sessão não está sendo acompanhada.';
    });
  }
  return s;
}

/** Sobe o servidor e grava o --mcp-config que as sessões do Claude usam. */
export async function startMcp(h: Hooks): Promise<string> {
  const token = randomBytes(24).toString('hex');
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}` || !req.url?.startsWith('/mcp')) { res.writeHead(401).end(); return; }
    // /mcp/run/12 ou /mcp/chat/5: quem está chamando
    const m = /^\/mcp\/(chat|run)\/(\d+)/.exec(req.url);
    const caller = m ? { kind: m[1] as 'chat' | 'run', id: Number(m[2]) } : null;
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try {
      // sem estado: um servidor e um transporte por requisição
      const mcp = build(h, caller);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { transport.close(); mcp.close(); });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(e) }));
    }
  });
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  const file = join(app.getPath('userData'), 'central-mcp.json');
  writeFileSync(file, mcpConfigBody(url, token));
  const dir = join(app.getPath('userData'), 'mcp');
  rmSync(dir, { recursive: true, force: true });
  setMcpConfig({ file, dir, url, token });
  return url;
}

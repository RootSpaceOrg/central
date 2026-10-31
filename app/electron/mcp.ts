/**
 * Servidor MCP da Central: o agente Central, os agentes e as sessões do Claude Code abertas pela Central
 * leem e mexem em projetos, backlog, ideias, decisões e rotinas por aqui.
 * HTTP só em 127.0.0.1, porta aleatória e token novo a cada vez que o app abre.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { app } from 'electron';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
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
import { setMcpConfigPath } from './mcp-config';
import { createProject, deleteProject, listProjects, listRepos, recent, syncProjects, updateProject } from './projects';
import { SIZE_BUDGET, createRoutine, deleteRoutine, fireRoutine, listRoutines, updateRoutine } from './routines';
import { getUsage } from './usage';

export interface Hooks { emit: Emit; projects: () => void; backlog: () => void; routines: () => void; agents: () => void }

const INSTRUCTIONS = `Central do Gustavo: o lugar onde vivem os projetos dele (cada um é uma pasta em Development com vários repositórios),
o backlog (tarefas em Kanban: backlog, todo, doing, review, done), a base de ideias, as decisões que esperam por ele,
os agentes (definições com papel e instruções, com ou sem projeto), as execuções de agentes e as rotinas (execuções com agenda).
Use estas ferramentas para consultar e manter tudo verdadeiro. Tarefas e decisões sempre pertencem a um projeto (slug).
Prefira registrar descobertas como tarefa no backlog ou ideia em vez de só mencioná-las.`;

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (v: unknown): Result => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v ?? { ok: true }) }] });
const fail = (e: unknown): Result => ({ content: [{ type: 'text', text: `Erro: ${(e as Error)?.message ?? e}` }], isError: true });

const column = z.enum(['backlog', 'todo', 'doing', 'review', 'done']);
const permission = z.enum(['edits', 'full']).describe('edits = seguro (repo: edita e roda git/npm; projeto: só lê). full = sem restrição');
const size = z.enum(['small', 'medium', 'large']).describe('tamanho do trabalho; limita o consumo da cota');

function build(h: Hooks): McpServer {
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
      open_decisions: listProposals(['proposed']).length,
      new_ideas: listIdeas().filter(i => i.status === 'new').length,
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
    listTasks(a.project_slug ?? null).filter(t => !a.column || t.column === a.column).map(t => ({ id: t.id, project: t.project_slug, title: t.title, body: t.body?.slice(0, 300), column: t.column, priority: t.priority, repo: t.repo_path, pr: t.pr_url, agent: t.run_status })));
  tool('create_task', 'Cria tarefa no backlog de um projeto. priority: 0 urgente, 1 alta, 2 normal, 3 baixa.', {
    project_slug: z.string(), title: z.string(), body: z.string().optional(), column: column.optional(), priority: z.number().int().min(0).max(3).optional(),
    repo_path: z.string().optional().describe('caminho do repositório, se já souber onde o trabalho acontece'),
  }, a => createTask({ project_slug: a.project_slug, repo_path: a.repo_path ?? null, title: a.title, body: a.body ?? null, column: a.column ?? 'backlog', priority: (a.priority ?? 2) as 0 | 1 | 2 | 3, source: 'central', source_ref: `${Date.now()}-${Math.random()}` }), h.backlog);
  tool('update_task', 'Edita ou move uma tarefa (coluna, prioridade, título, descrição, projeto, repositório).', {
    id: z.number().int(), title: z.string().optional(), body: z.string().optional(), column: column.optional(), priority: z.number().int().min(0).max(3).optional(),
    project_slug: z.string().optional(), repo_path: z.string().optional(),
  }, ({ id, ...patch }) => updateTask(id, { ...patch, priority: patch.priority as 0 | 1 | 2 | 3 | undefined, position: patch.column ? 0 : undefined }), h.backlog);
  tool('delete_task', 'Exclui uma tarefa. Só use se o Gustavo pediu.', { id: z.number().int() }, ({ id }) => deleteTask(id), h.backlog);

  // ---------- ideias ----------
  tool('list_ideas', 'Lista ideias. status: new (padrão), promoted, archived.', { status: z.enum(['new', 'promoted', 'archived']).optional(), project_slug: z.string().optional() }, a =>
    listIdeas().filter(i => i.status === (a.status ?? 'new') && (!a.project_slug || i.project_slug === a.project_slug)).map(i => ({ id: i.id, project: i.project_slug, title: i.title, body: i.body?.slice(0, 300), source: i.source })));
  tool('create_idea', 'Guarda uma ideia na base (sem compromisso de fazer).', { title: z.string(), body: z.string().optional(), project_slug: z.string().optional() }, a =>
    createIdea({ title: a.title, body: a.body ?? null, project_slug: a.project_slug ?? null, source: 'central' }), h.backlog);
  tool('update_idea', 'Edita, arquiva (status archived) ou restaura (status new) uma ideia.', {
    id: z.number().int(), title: z.string().optional(), body: z.string().optional(), project_slug: z.string().optional(), status: z.enum(['new', 'archived']).optional(),
  }, ({ id, ...patch }) => updateIdea(id, patch), h.backlog);
  tool('promote_idea', 'Transforma uma ideia em tarefa no backlog do projeto.', { id: z.number().int(), project_slug: z.string() }, a => promoteIdea(a.id, a.project_slug), h.backlog);

  // ---------- decisões ----------
  tool('list_decisions', 'Lista decisões. status: proposed (esperando o Gustavo, padrão), approved, rejected, deferred, done.', { status: z.enum(['proposed', 'approved', 'rejected', 'deferred', 'running', 'done']).optional() }, a =>
    listProposals([a.status ?? 'proposed']).map(p => ({ id: p.id, project: p.project_slug, title: p.title, body: p.body, next_action: p.next_action, tier: p.tier })));
  tool('create_decision', 'Cria uma decisão para o Gustavo aprovar ou recusar. next_action: o que acontece se ele aprovar. tier: 0 risco baixo, 1 médio, 2 alto.', {
    title: z.string(), body: z.string().optional(), project_slug: z.string().optional(), next_action: z.string().optional(), tier: z.number().int().min(0).max(2).optional(),
  }, a => createProposal({ title: a.title, body: a.body ?? null, project_slug: a.project_slug ?? null, next_action: a.next_action ?? null, tier: a.tier ?? null, source: 'central' }), () => { h.backlog(); h.projects(); });
  tool('decide', 'Registra a decisão do Gustavo sobre uma decisão (só quando ele disser o que quer). approve cria tarefa em todo.', {
    id: z.number().int(), verdict: z.enum(['approve', 'defer', 'reject']), reason: z.string().optional(),
  }, a => decide(a.id, a.verdict, a.reason ?? null), () => { h.backlog(); h.projects(); });

  // ---------- agentes (definições) ----------
  const agentShape = {
    name: z.string().optional(), description: z.string().optional(), project_slug: z.string().nullable().optional().describe('null = sem projeto'),
    instructions: z.string().optional().describe('papel e jeito de trabalhar do agente'), color: z.string().optional(),
    icon_kind: z.enum(['letter', 'emoji', 'lucide']).optional(), icon_value: z.string().optional().describe('emoji ou nome de ícone Lucide'),
    tools: z.array(z.string()).optional().describe('ferramentas extras, ex.: mcp__sentry'), permission: permission.optional(),
    model: z.enum(['', 'sonnet', 'opus', 'haiku']).optional(),
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
  return s;
}

/** Sobe o servidor e grava o --mcp-config que as sessões do Claude usam. */
export async function startMcp(h: Hooks): Promise<string> {
  const token = randomBytes(24).toString('hex');
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}` || !req.url?.startsWith('/mcp')) { res.writeHead(401).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try {
      // sem estado: um servidor e um transporte por requisição
      const mcp = build(h);
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
  writeFileSync(file, JSON.stringify({ mcpServers: { central: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2));
  setMcpConfigPath(file);
  return url;
}

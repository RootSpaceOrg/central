/**
 * Conversas com os agentes da Central (a própria Central, Suporte KultivAi, Marketing…). Cada conversa é uma sessão do
 * Claude Code (usa a cota do plano), retomada com --resume na mesma pasta para manter o contexto.
 */
import { ChildProcess, execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

import type { ChatDto, ChatMessageDto, ChatRole } from '../src/app/shared/contract';
import { SESSION_TOOLS, agentCwd, agentPromptFile, agentTools, centralAgent, getAgent, sessionPromptFile } from './agentdefs';
import { DEV_ROOT, all, get, now, run } from './db';
import { mcpConfigPath } from './mcp-config';
import { childEnv } from './workspace';

type Notify = (chatId: number, message: ChatMessageDto | null, busy: boolean) => void;

/** passos internos do Claude que não dizem nada ao Gustavo */
export const INTERNAL = new Set(['ToolSearch', 'TodoWrite']);
const procs = new Map<number, ChildProcess>();

export const listChats = (agentId: number | null) => all<ChatDto>(
  `select id, agent_id, project_slug, title, created_at, updated_at from chats where (? is null or agent_id = ?) order by updated_at desc limit 200`, agentId, agentId);
export const listMessages = (chatId: number) => all<ChatMessageDto>('select * from chat_messages where chat_id = ? order by id', chatId);
export const deleteChat = (chatId: number) => { stopChat(chatId); run('delete from chats where id = ?', chatId); };
export function renameChat(chatId: number, title: string): void {
  if (!title.trim()) throw new Error('Título vazio.');
  run('update chats set title = ? where id = ?', title.trim().slice(0, 120), chatId);
}

function save(chatId: number, role: ChatRole, text: string, notify: Notify): void {
  const { lastInsertRowid } = run('insert into chat_messages (chat_id, role, text, at) values (?,?,?,?)', chatId, role, text, now());
  run('update chats set updated_at = ? where id = ?', now(), chatId);
  notify(chatId, get<ChatMessageDto>('select * from chat_messages where id = ?', Number(lastInsertRowid))!, true);
}

export function stopChat(chatId: number): void {
  const p = procs.get(chatId);
  if (p?.pid) execFile('taskkill', ['/pid', String(p.pid), '/T', '/F'], () => {});
}

/** Conversa que continua a sessão de uma execução (o agente lembra tudo o que fez nela). */
export function chatFromRun(runId: number): number {
  const r = get<{ id: number; prompt: string; session_id: string | null; agent_id: number | null; worktree_path: string | null; repo_path: string; scope: string }>(
    'select id, prompt, session_id, agent_id, worktree_path, repo_path, scope from runs where id = ?', runId);
  if (!r) throw new Error('Execução não encontrada.');
  if (!r.session_id) throw new Error('Esta execução não guardou a sessão (é anterior à v0.6).');
  const existing = get<{ id: number }>('select id from chats where session_id = ?', r.session_id);
  if (existing) return existing.id;
  const cwd = r.scope === 'repo' ? r.worktree_path : r.repo_path;
  if (!cwd || !existsSync(cwd)) throw new Error('A pasta da execução não existe mais.');
  const agentId = r.agent_id ?? centralAgent().id;
  return Number(run('insert into chats (agent_id, title, session_id, cwd) values (?,?,?,?)',
    agentId, `Execução #${r.id}: ${r.prompt.split('\n')[0].slice(0, 80)}`, r.session_id, cwd).lastInsertRowid);
}

export function sendChat(chatId: number | null, agentId: number, text: string, notify: Notify, onCentralChange: () => void, projectSlug: string | null = null): number {
  const msg = text.trim();
  if (!msg) throw new Error('Escreva uma mensagem.');
  if (chatId && procs.has(chatId)) throw new Error('O agente ainda está respondendo a mensagem anterior.');
  const chat = chatId ? get<{ agent_id: number | null; session_id: string | null; cwd: string | null; project_slug: string | null }>(
    'select agent_id, session_id, cwd, project_slug from chats where id = ?', chatId) : null;
  if (chatId && !chat) throw new Error('Conversa não encontrada.');
  const agent = getAgent(chat?.agent_id ?? agentId) ?? centralAgent();
  const slug = chat ? chat.project_slug : projectSlug;
  // conversas antigas (antes da v0.6) não guardavam a pasta: eram todas na raiz de Development
  let cwd = chat ? chat.cwd ?? DEV_ROOT : '';
  if (!chatId) {
    const folder = slug ? get<{ folder: string }>('select folder from projects where slug = ?', slug)?.folder : null;
    if (slug && (!folder || !existsSync(folder))) throw new Error('A pasta do projeto não existe.');
    cwd = folder ?? agentCwd(agent);
    chatId = Number(run('insert into chats (agent_id, title, cwd, project_slug) values (?,?,?,?)',
      agent.id, msg.replace(/\s+/g, ' ').slice(0, 70), cwd, slug).lastInsertRowid);
  }
  const id = chatId;
  save(id, 'user', msg, notify);

  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--append-system-prompt-file', `"${slug ? sessionPromptFile(slug) : agentPromptFile(agent)}"`];
  if (slug) args.push('--permission-mode', 'acceptEdits', '--allowedTools', `"${SESSION_TOOLS.join(',')}"`);
  else if (agent.permission === 'full') args.push('--permission-mode', 'bypassPermissions');
  else args.push('--allowedTools', `"${agentTools(agent).join(',')}"`);
  if (agent.model) args.push('--model', agent.model);
  const mcp = mcpConfigPath();
  if (mcp) args.push('--mcp-config', `"${mcp}"`);
  if (chat?.session_id) args.push('--resume', chat.session_id);

  const child = spawn('claude', args, { cwd, shell: true, windowsHide: true, env: childEnv() });
  procs.set(id, child);
  child.stdin.end(msg);

  let answered = false;
  createInterface({ input: child.stdout }).on('line', line => {
    let m: any;
    try { m = JSON.parse(line); } catch { return; }
    if (m.session_id && m.session_id !== chat?.session_id) run('update chats set session_id = ? where id = ?', m.session_id, id);
    if (m.type === 'assistant') {
      for (const b of m.message?.content ?? []) {
        if (b.type === 'text' && b.text.trim()) { answered = true; save(id, 'assistant', b.text.trim(), notify); }
        if (b.type === 'tool_use' && !INTERNAL.has(b.name)) {
          save(id, 'tool', describe(b.name, b.input), notify);
          if (String(b.name).startsWith('mcp__central__')) setTimeout(onCentralChange, 800);
        }
      }
    } else if (m.type === 'result' && m.is_error && !answered) {
      save(id, 'error', m.result || 'O agente não conseguiu responder.', notify);
    }
  });
  let stderr = '';
  child.stderr.on('data', d => { stderr = (stderr + d).slice(-2000); });
  child.on('close', code => {
    procs.delete(id);
    if (code !== 0 && !answered) save(id, 'error', stderr.trim() || 'Resposta interrompida.', notify);
    notify(id, null, false);
  });
  return id;
}

/** "Consultou as tarefas", "Criou uma ideia"… para mostrar no chat e nos logs o que foi feito. */
export function describe(name: string, input: any): string {
  const tool = String(name).replace(/^mcp__central__/, '');
  if (tool.startsWith('mcp__')) return `${tool.split('__')[1]}: ${tool.split('__').slice(2).join(' ').replace(/_/g, ' ')}`;
  const labels: Record<string, string> = {
    central_overview: 'Olhou o panorama', list_projects: 'Listou os projetos', get_project: `Abriu o projeto ${input?.slug ?? ''}`,
    create_project: `Criou o projeto ${input?.name ?? ''}`, update_project: `Editou o projeto ${input?.slug ?? ''}`, delete_project: `Excluiu o projeto ${input?.slug ?? ''}`,
    list_tasks: 'Consultou o backlog', create_task: `Criou a tarefa "${input?.title ?? ''}"`, update_task: `Atualizou a tarefa #${input?.id ?? ''}`,
    delete_task: `Excluiu a tarefa #${input?.id ?? ''}`, list_ideas: 'Consultou as ideias', create_idea: `Guardou a ideia "${input?.title ?? ''}"`,
    update_idea: `Atualizou a ideia #${input?.id ?? ''}`, promote_idea: `Transformou a ideia #${input?.id ?? ''} em tarefa`,
    list_decisions: 'Consultou as decisões', create_decision: `Criou a decisão "${input?.title ?? ''}"`, decide: `Registrou decisão #${input?.id ?? ''}`,
    list_agent_runs: 'Consultou as execuções', get_agent_run: `Leu o log da execução #${input?.id ?? ''}`, start_agent: 'Colocou um agente para trabalhar',
    stop_agent: `Interrompeu a execução #${input?.id ?? ''}`, start_turn: 'Começou um turno', list_turns: 'Consultou os turnos',
    list_routines: 'Consultou as rotinas', create_routine: `Criou a rotina "${input?.name ?? ''}"`, update_routine: `Editou a rotina #${input?.id ?? ''}`,
    delete_routine: `Excluiu a rotina #${input?.id ?? ''}`, run_routine_now: `Rodou a rotina #${input?.id ?? ''}`,
    list_agents: 'Consultou os agentes', create_agent: `Criou o agente "${input?.name ?? ''}"`, update_agent: `Editou o agente #${input?.id ?? ''}`,
    delete_agent: `Excluiu o agente #${input?.id ?? ''}`,
    get_claude_usage: 'Conferiu a cota do Claude', import_pending: 'Importou pendências',
    Read: `Leu ${String(input?.file_path ?? '').split(/[\\/]/).slice(-2).join('/')}`, Grep: `Buscou "${input?.pattern ?? ''}"`, Glob: `Listou ${input?.pattern ?? ''}`,
    WebSearch: `Pesquisou "${input?.query ?? ''}"`, WebFetch: 'Leu uma página', Bash: `Rodou ${String(input?.command ?? '').slice(0, 60)}`,
    Write: `Escreveu ${String(input?.file_path ?? '').split(/[\\/]/).slice(-1)[0]}`, Edit: `Editou ${String(input?.file_path ?? '').split(/[\\/]/).slice(-1)[0]}`,
  };
  return labels[tool] ?? tool;
}

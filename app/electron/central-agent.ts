/**
 * Agente Central: chat que orquestra a Central pelo MCP dela. Cada conversa é uma sessão do Claude Code
 * (usa a cota do plano do Gustavo), retomada com --resume para manter o contexto.
 */
import { app } from 'electron';
import { ChildProcess, execFile, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import type { ChatDto, ChatMessageDto, ChatRole } from '../src/app/shared/contract';
import { DEV_ROOT, all, get, now, run } from './db';
import { mcpConfigPath } from './mcp-config';
import { childEnv } from './workspace';

type Notify = (chatId: number, message: ChatMessageDto | null, busy: boolean) => void;

// Lê tudo e mexe na Central; não edita código (para isso existem os agentes).
const TOOLS = ['mcp__central', 'Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'Bash(git log:*)', 'Bash(git status:*)',
  'Bash(gh pr list:*)', 'Bash(gh pr view:*)', 'Bash(gh issue list:*)', 'Bash(gh run list:*)'];

const SYSTEM = `Você é a Central, a assistente que organiza o trabalho do Gustavo, dev solo que toca vários produtos SaaS.
Responda sempre em português do Brasil, curto e direto, como um colega de trabalho. Sem enrolação.

Você enxerga e controla a Central pelas ferramentas \`central\` (MCP): projetos (pastas em ${DEV_ROOT} com vários repositórios),
backlog em Kanban, base de ideias, decisões que esperam o Gustavo, agentes, turnos e rotinas, e a cota do plano do Claude.
Você também pode ler os arquivos dos projetos (Read, Grep, Glob) para entender o código antes de propor algo.

Como trabalhar:
- Consulte antes de afirmar. Comece por central_overview quando a pergunta for ampla.
- Números e estado (commits, repositórios, tarefas, agentes) vêm das ferramentas da Central (central_overview, get_project, list_*).
  Não use Bash para contar ou listar: só git log, git status e gh para detalhes que a Central não tem.
- Quando ele pedir para fazer algo, faça pelas ferramentas e diga em uma linha o que mudou.
- Para trabalho de código, crie tarefas e coloque agentes para trabalhar (start_agent) em vez de editar arquivos você mesma.
- Excluir projeto, tarefa ou rotina: só com pedido explícito. Se o pedido for ambíguo, pergunte antes.
- Se a cota da sessão estiver alta (acima de 80%), avise antes de disparar agentes.
- Ao listar coisas, use listas curtas com o essencial (título, projeto, estado).`;

/** passos internos do Claude que não dizem nada ao Gustavo */
export const INTERNAL = new Set(['ToolSearch', 'TodoWrite']);
const procs = new Map<number, ChildProcess>();
let promptFile: string | null = null;

export const listChats = () => all<ChatDto>('select id, title, created_at, updated_at from chats order by updated_at desc limit 50');
export const listMessages = (chatId: number) => all<ChatMessageDto>('select * from chat_messages where chat_id = ? order by id', chatId);
export const deleteChat = (chatId: number) => { stopChat(chatId); run('delete from chats where id = ?', chatId); };

function save(chatId: number, role: ChatRole, text: string, notify: Notify): void {
  const { lastInsertRowid } = run('insert into chat_messages (chat_id, role, text, at) values (?,?,?,?)', chatId, role, text, now());
  run('update chats set updated_at = ? where id = ?', now(), chatId);
  notify(chatId, get<ChatMessageDto>('select * from chat_messages where id = ?', Number(lastInsertRowid))!, true);
}

export function stopChat(chatId: number): void {
  const p = procs.get(chatId);
  if (p?.pid) execFile('taskkill', ['/pid', String(p.pid), '/T', '/F'], () => {});
}

export function sendChat(chatId: number | null, text: string, notify: Notify, onCentralChange: () => void): number {
  const msg = text.trim();
  if (!msg) throw new Error('Escreva uma mensagem.');
  if (chatId && procs.has(chatId)) throw new Error('A Central ainda está respondendo a mensagem anterior.');
  if (!chatId) {
    chatId = Number(run('insert into chats (title) values (?)', msg.replace(/\s+/g, ' ').slice(0, 70)).lastInsertRowid);
  }
  const id = chatId;
  save(id, 'user', msg, notify);

  if (!promptFile) {
    promptFile = join(app.getPath('userData'), 'central-agent.md');
    writeFileSync(promptFile, SYSTEM);
  }
  const session = get<{ session_id: string | null }>('select session_id from chats where id = ?', id)?.session_id;
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--append-system-prompt-file', `"${promptFile}"`,
    '--allowedTools', `"${TOOLS.join(',')}"`];
  const mcp = mcpConfigPath();
  if (mcp) args.push('--mcp-config', `"${mcp}"`);
  if (session) args.push('--resume', session);

  const child = spawn('claude', args, { cwd: DEV_ROOT, shell: true, windowsHide: true, env: childEnv() });
  procs.set(id, child);
  child.stdin.end(msg);

  let answered = false;
  createInterface({ input: child.stdout }).on('line', line => {
    let m: any;
    try { m = JSON.parse(line); } catch { return; }
    if (m.session_id && m.session_id !== session) run('update chats set session_id = ? where id = ?', m.session_id, id);
    if (m.type === 'assistant') {
      for (const b of m.message?.content ?? []) {
        if (b.type === 'text' && b.text.trim()) { answered = true; save(id, 'assistant', b.text.trim(), notify); }
        if (b.type === 'tool_use' && !INTERNAL.has(b.name)) {
          save(id, 'tool', describe(b.name, b.input), notify);
          if (String(b.name).startsWith('mcp__central__')) setTimeout(onCentralChange, 800);
        }
      }
    } else if (m.type === 'result' && m.is_error && !answered) {
      save(id, 'error', m.result || 'A Central não conseguiu responder.', notify);
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
  const labels: Record<string, string> = {
    central_overview: 'Olhou o panorama', list_projects: 'Listou os projetos', get_project: `Abriu o projeto ${input?.slug ?? ''}`,
    create_project: `Criou o projeto ${input?.name ?? ''}`, update_project: `Editou o projeto ${input?.slug ?? ''}`, delete_project: `Excluiu o projeto ${input?.slug ?? ''}`,
    list_tasks: 'Consultou o backlog', create_task: `Criou a tarefa "${input?.title ?? ''}"`, update_task: `Atualizou a tarefa #${input?.id ?? ''}`,
    delete_task: `Excluiu a tarefa #${input?.id ?? ''}`, list_ideas: 'Consultou as ideias', create_idea: `Guardou a ideia "${input?.title ?? ''}"`,
    update_idea: `Atualizou a ideia #${input?.id ?? ''}`, promote_idea: `Transformou a ideia #${input?.id ?? ''} em tarefa`,
    list_decisions: 'Consultou as decisões', create_decision: `Criou a decisão "${input?.title ?? ''}"`, decide: `Registrou decisão #${input?.id ?? ''}`,
    list_agent_runs: 'Consultou os agentes', get_agent_run: `Leu o log do agente #${input?.id ?? ''}`, start_agent: 'Colocou um agente para trabalhar',
    stop_agent: `Interrompeu o agente #${input?.id ?? ''}`, start_turn: 'Começou um turno', list_turns: 'Consultou os turnos',
    list_routines: 'Consultou as rotinas', create_routine: `Criou a rotina "${input?.name ?? ''}"`, update_routine: `Editou a rotina #${input?.id ?? ''}`,
    delete_routine: `Excluiu a rotina #${input?.id ?? ''}`, run_routine_now: `Rodou a rotina #${input?.id ?? ''}`,
    get_claude_usage: 'Conferiu a cota do Claude', import_pending: 'Importou pendências',
    Read: `Leu ${String(input?.file_path ?? '').split(/[\\/]/).slice(-2).join('/')}`, Grep: `Buscou "${input?.pattern ?? ''}"`, Glob: `Listou ${input?.pattern ?? ''}`,
    WebSearch: `Pesquisou "${input?.query ?? ''}"`, WebFetch: 'Leu uma página', Bash: `Rodou ${String(input?.command ?? '').slice(0, 60)}`,
  };
  return labels[tool] ?? tool;
}

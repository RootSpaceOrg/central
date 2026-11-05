/**
 * Conversas com os agentes da Central (a própria Central, Suporte KultivAi, Marketing…). Cada conversa é uma sessão do
 * Claude Code (usa a cota do plano), retomada com --resume na mesma pasta para manter o contexto.
 */
import { ChildProcess, execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

import type { ChatDto, ChatMessageDto, ChatOptions, ChatRole } from '../src/app/shared/contract';
import { SESSION_TOOLS, agentCwd, agentPromptFile, agentTools, centralAgent, getAgent, restrictedTools, sessionPromptFile } from './agentdefs';
import { DEV_ROOT, all, get, now, run } from './db';
import { reopenDelivery } from './deliveries';
import { mcpConfigPath } from './mcp-config';
import { childEnv } from './workspace';
import { recordTouch } from './context/context';
import { track, untrack } from './activity';

type Notify = (chatId: number, message: ChatMessageDto | null, busy: boolean) => void;

/** passos internos do Claude que não dizem nada ao Gustavo */
export const INTERNAL = new Set(['ToolSearch', 'TodoWrite']);
const procs = new Map<number, ChildProcess>();
/**
 * Conversa respondendo: a entrada do Claude fica aberta (stream-json) e a mensagem nova entra na mesma sessão, como no
 * terminal (ele lê assim que termina o passo atual). Depois do resultado a entrada fecha; o que chegar nesse intervalo
 * vai como próxima mensagem quando o processo terminar.
 */
const inbox = new Map<number, { open: boolean; later: string[] }>();
const userLine = (text: string) => `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;

export const listChats = (agentId: number | null) => all<ChatDto>(
  `select id, agent_id, project_slug, title, created_at, updated_at, model, effort from chats where (? is null or agent_id = ?) order by updated_at desc limit 200`, agentId, agentId);
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

/** A Central vai fechar: encerra as conversas respondendo (senão o Claude seguiria sozinho, sem ninguém ouvindo). */
export function stopAllChats(): void {
  for (const p of procs.values()) if (p.pid) { try { execFileSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* já saiu */ } }
  procs.clear();
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

const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

/** Texto ao vivo das respostas: o main liga ao evento da tela. */
let onStream: (chatId: number, text: string) => void = () => {};
export function onChatStream(fn: typeof onStream): void { onStream = fn; }

export function sendChat(chatId: number | null, agentId: number, text: string, notify: Notify, onCentralChange: () => void, projectSlug: string | null = null,
  options: ChatOptions | null = null, alreadySaved = false): number {
  // modelo: apelido (opus, sonnet…) ou nome completo; nada que vire outra opção na linha de comando
  if (options && (!/^[\w.\-\[\]]*$/.test(options.model) || !EFFORTS.includes(options.effort))) throw new Error('Modelo ou nível de raciocínio inválido.');
  const msg = text.trim();
  if (!msg) throw new Error('Escreva uma mensagem.');
  if (chatId && procs.has(chatId)) {
    // respondendo: entra na sessão em andamento (ou fica para a próxima, se a entrada já fechou)
    const box = inbox.get(chatId);
    save(chatId, 'user', msg, notify);
    if (box?.open) procs.get(chatId)!.stdin?.write(userLine(msg));
    else (box ?? inbox.set(chatId, { open: false, later: [] }).get(chatId)!).later.push(msg);
    return chatId;
  }
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
  if (options) run('update chats set model = ?, effort = ? where id = ?', options.model, options.effort, id);
  const chosen = get<{ model: string; effort: string }>('select model, effort from chats where id = ?', id)!;
  if (!alreadySaved) save(id, 'user', msg, notify);

  // --include-partial-messages: o texto chega em pedaços enquanto o Claude escreve (a tela mostra ao vivo)
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--append-system-prompt-file', `"${slug ? sessionPromptFile(slug) : agentPromptFile(agent)}"`];
  // continuação de uma execução (pedir ajuste): edita no worktree dela como a execução editava
  const fromRun = !!chat?.cwd && !!get('select 1 from runs where worktree_path = ?', chat.cwd);
  if (agent.restricted) args.push('--allowedTools', `"${restrictedTools(agent).join(',')}"`);
  else if (slug || fromRun) args.push('--permission-mode', 'acceptEdits', '--allowedTools', `"${[...new Set([...SESSION_TOOLS, ...agentTools(agent)])].join(',')}"`);
  else if (agent.permission === 'full') args.push('--permission-mode', 'bypassPermissions');
  else args.push('--allowedTools', `"${agentTools(agent).join(',')}"`);
  const model = chosen.model || agent.model;
  if (model) args.push('--model', model);
  if (chosen.effort) args.push('--effort', chosen.effort);
  const mcp = mcpConfigPath({ kind: 'chat', id });
  if (mcp) args.push('--mcp-config', `"${mcp}"`);
  if (chat?.session_id) args.push('--resume', chat.session_id);

  const child = spawn('claude', args, { cwd, shell: true, windowsHide: true, env: childEnv() });
  procs.set(id, child);
  inbox.set(id, { open: true, later: [] });
  child.stdin.write(userLine(msg));

  let answered = false;
  const tracker = track('chat', id, describe, text => save(id, 'tool', text, notify));
  let streaming = '';
  let streamTimer: ReturnType<typeof setTimeout> | undefined;
  const flushSoon = () => { streamTimer ??= setTimeout(() => { streamTimer = undefined; onStream(id, streaming); }, 80); };
  createInterface({ input: child.stdout }).on('line', line => {
    let m: any;
    try { m = JSON.parse(line); } catch { return; }
    if (m.session_id && m.session_id !== chat?.session_id) run('update chats set session_id = ? where id = ?', m.session_id, id);
    tracker.handle(m);
    // pedaço de texto da resposta principal (subagentes não): acumula e manda para a tela no máximo a cada 80 ms
    if (m.type === 'stream_event' && !m.parent_tool_use_id) {
      const ev = m.event;
      if (ev?.type === 'content_block_start' && ev.content_block?.type === 'text') streaming = '';
      if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { streaming += ev.delta.text; flushSoon(); }
      return;
    }
    // passos de subagente ficam recuados no histórico; o texto deles não é a resposta da conversa
    const sub = tracker.isSubagentStep(m);
    if (m.type === 'assistant') {
      for (const b of m.message?.content ?? []) {
        if (b.type === 'text' && b.text.trim() && !sub) {
          answered = true;
          // a mensagem completa substitui o texto ao vivo
          streaming = '';
          clearTimeout(streamTimer);
          streamTimer = undefined;
          onStream(id, '');
          save(id, 'assistant', b.text.trim(), notify);
        }
        if (b.type === 'tool_use' && !INTERNAL.has(b.name)) {
          recordTouch(b.name, b.input, { chatId: id });
          save(id, 'tool', `${sub ? '↳ ' : ''}${describe(b.name, b.input)}`, notify);
          if (String(b.name).startsWith('mcp__central__')) setTimeout(onCentralChange, 800);
        }
      }
    }
    // respondeu: fecha a entrada (o Claude termina e sai); o que chegar depois disto vai na próxima vez
    if (m.type === 'result') { const box = inbox.get(id); if (box?.open) { box.open = false; child.stdin.end(); } }
    if (m.type === 'result' && m.is_error && !answered) {
      save(id, 'error', m.result || 'O agente não conseguiu responder.', notify);
    }
  });
  let stderr = '';
  child.stderr.on('data', d => { stderr = (stderr + d).slice(-2000); });
  child.on('close', code => {
    procs.delete(id);
    const later = inbox.get(id)?.later ?? [];
    inbox.delete(id);
    untrack('chat', id, tracker);
    clearTimeout(streamTimer);
    onStream(id, '');
    if (code !== 0 && !answered) save(id, 'error', stderr.trim() || 'Resposta interrompida.', notify);
    notify(id, null, false);
    if (later.length) setTimeout(() => { try { sendChat(id, agent.id, later.join('\n\n'), notify, onCentralChange, null, null, true); } catch { /* conversa apagada */ } }, 100);
    // terminou um ajuste pedido na entrega: ela volta para a revisão com o diff novo
    const runId = fromRun ? get<{ id: number }>('select id from runs where worktree_path = ?', chat!.cwd)?.id : null;
    if (runId) reopenDelivery(runId).then(onCentralChange, () => {});
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
    update_idea: `Atualizou a ideia #${input?.id ?? ''}`, promote_idea: `Transformou a ideia #${input?.id ?? ''} em tarefa`, triage_agent: 'Viu o agente de triagem',
    list_decisions: 'Consultou as decisões', create_decision: `Criou a decisão "${input?.title ?? ''}"`, decide: `Registrou decisão #${input?.id ?? ''}`,
    list_agent_runs: 'Consultou as execuções', get_agent_run: `Leu o log da execução #${input?.id ?? ''}`, start_agent: 'Colocou um agente para trabalhar', notify_agent: 'Avisou outro agente', continue_run: `Continuou a execução #${input?.run_id ?? ''}`, transcrever: 'Transcreveu um áudio', analisar_video: 'Analisou um vídeo', whatsapp_send: `Mandou WhatsApp para ${input?.to ?? ''}`, take_over: `Passou a execução #${input?.run_id ?? ''} adiante`,
    stop_agent: `Interrompeu a execução #${input?.id ?? ''}`, start_turn: 'Começou um turno', list_turns: 'Consultou os turnos',
    list_routines: 'Consultou as rotinas', create_routine: `Criou a rotina "${input?.name ?? ''}"`, update_routine: `Editou a rotina #${input?.id ?? ''}`,
    delete_routine: `Excluiu a rotina #${input?.id ?? ''}`, run_routine_now: `Rodou a rotina #${input?.id ?? ''}`,
    list_agents: 'Consultou os agentes', create_agent: `Criou o agente "${input?.name ?? ''}"`, update_agent: `Editou o agente #${input?.id ?? ''}`,
    delete_agent: `Excluiu o agente #${input?.id ?? ''}`,
    get_claude_usage: 'Conferiu a cota do Claude', import_pending: 'Importou pendências',
    code_map: 'Leu o mapa do código', code_search: `Buscou no índice "${input?.query ?? ''}"`, code_symbol: `Abriu ${String(input?.key ?? '').split(/[#:]/).pop()}`,
    code_neighbors: `Viu as ligações de ${String(input?.key ?? '').split(/[#:]/).pop()}`, code_impact: 'Calculou o impacto da mudança',
    memory_recall: 'Consultou a memória do projeto', memory_remember: `Guardou na memória: "${String(input?.text ?? '').slice(0, 60)}"`,
    memory_supersede: `Atualizou o fato #${input?.id ?? ''}`,
    remember: `Lembrou${input?.para === 'todos' ? ' (para todos)' : ''}: "${String(input?.text ?? '').slice(0, 60)}"`, recall: 'Consultou a memória',
    forget: `Esqueceu a memória #${input?.id ?? ''}`, list_deliveries: 'Consultou as entregas', what_happened: 'Viu o que aconteceu', production_status: `Viu o que espera produção em ${input?.project_slug ?? ''}`,
    list_boards: 'Consultou os quadros', create_board: `Criou o quadro "${input?.name ?? ''}"`, move_on_board: `Moveu a tarefa #${input?.task_id ?? ''} no quadro`,
    report_delivery: `Entrega: ${String(input?.title ?? '').slice(0, 60)}`, set_status: `${String(input?.phase ?? '')}: ${String(input?.doing ?? '').slice(0, 60)}`,
    Read: `Leu ${String(input?.file_path ?? '').split(/[\\/]/).slice(-2).join('/')}`, Grep: `Buscou "${input?.pattern ?? ''}"`, Glob: `Listou ${input?.pattern ?? ''}`,
    Agent: `Subagente: ${input?.description ?? ''}`, Task: `Subagente: ${input?.description ?? ''}`,
    TaskCreate: `Plano: ${input?.subject ?? ''}`, TaskUpdate: `Plano: passo ${input?.taskId ?? ''} ${input?.status === 'completed' ? 'concluído' : input?.status === 'in_progress' ? 'em andamento' : 'atualizado'}`,
    TodoWrite: 'Atualizou o plano', TaskList: 'Conferiu o plano', TaskGet: 'Conferiu o plano',
    list_milestones: 'Consultou o roadmap', create_milestone: `Criou o marco "${input?.title ?? ''}"`, update_milestone: `Atualizou o marco #${input?.id ?? ''}`,
    WebSearch: `Pesquisou "${input?.query ?? ''}"`, WebFetch: 'Leu uma página', Bash: `Rodou ${String(input?.command ?? '').slice(0, 60)}`,
    Write: `Escreveu ${String(input?.file_path ?? '').split(/[\\/]/).slice(-1)[0]}`, Edit: `Editou ${String(input?.file_path ?? '').split(/[\\/]/).slice(-1)[0]}`,
  };
  return labels[tool] ?? tool;
}

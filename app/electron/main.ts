import { BrowserWindow, Notification, app, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron';
import { execFile } from 'node:child_process';
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Api, Events } from '../src/app/shared/contract';
import { CHAT_MEDIA, DB_PATH, DEV_ROOT, all, get, run } from './db';
import { imageDataUrl, saveImage } from './chat-images';
import { addMcpServer, listMcpServers, removeMcpServer } from './mcp-servers';
import { adaptImport, discoverProjects, exportData, inspectImport, swapDatabase } from './data-transfer';
import { continueRun, grantRun, dto as runDto, handoffRun, killRun, pauseAllOnQuit, listEvents, listRuns, listTurns, startRun, startTurn, stopTurn, unpauseRun, watchQuota, watchTurns } from './agents';
import {
  createIdea, createProposal, createTask, decide, deleteProposal, deleteTask, getSetting, importPending, listIdeas, listProposals, listTasks, promoteIdea,
  setSetting, syncCiFailures, syncPullRequests, updateIdea, updateTask,
} from './backlog';
import { buildUpdate, checkUpdate, installUpdate } from './updater';
import { getNotif, getPrefs, keepAliveOnClose, markQuitting, notify, setNotif, setPrefs, setupTray } from './desktop';
import type { NotifKind } from './notif';
import { chatFromRun, deleteChat, grantChat, resumeInterruptedChats, setChatYolo, listChats, listMessages, onChatStream, renameChat, sendChat, stopChat, stopAllChats } from './central-agent';
import { closeSession, createSession, listSessions, updateSession } from './sessions';
import { importClaudeSession, listClaudeSessions } from './claude-import';
import { claimOf, listActivity, onActivity } from './activity';
import { createBoard, deleteBoard, listBoards, removeFromBoard, saveColumns, setStage, stagesOf, updateBoard } from './board';
import { digest, listDeliveries, reviewDelivery, reviewBoard } from './deliveries';
import { dispatchTodo, dispatchTriage } from './dispatch';
import { brakeLabel, getLimits, readUsage, setLimits } from './governor';
import { getUsage, usageNow } from './usage';
import { callExtension, installExtension, listExtensions, onExtensionsChange, setExtensionEnabled, startInstalled, stopAllExtensions, uninstallExtension } from './extensions';
import { analyzeVideo, initMedia, prepareLocal, setSttConfig, sttStatus, transcribeFile } from './media';
import { inbound as waInbound, testPresence as waPresence, initWhatsApp, chatsStatus, digestListened, listContacts, listGroups, pairAccount, setAccountAgent, setAccountOpen, setChatCfgs, setSender as waSetSender, waStatus } from './whatsapp';
import { releaseStatus, releaseSummary } from './release';
import { createMemory, deleteMemory, forgetMemory, listMemories, updateMemory } from './memories';
import { createMilestone, deleteMilestone, listMilestones, milestoneEvents, reorderMilestones, updateMilestone } from './roadmap';
import { contextBlock, contextStatus, graphData, indexAll, indexProject, nodeDetail, searchHits, startContext } from './context/context';
import { createFact, deleteFact, importClaudeMemory, listFacts, supersedeFact, updateFact } from './context/memory';
import { directionHistory, getDirection, planBacklog, setDirection } from './direction';
import { abandonGuide, answerCard, approvePlan, askStrategist, guideIdle, listGuides, requestPlan, setPlanItem, setStep, startGuide } from './guides';
import { createAgent, deleteAgent, listAgents, seedAgents, seedAgentsV2, updateAgent, sessionPromptFile } from './agentdefs';
import { startMcp } from './mcp';
import { SIZE_BUDGET, createRoutine, onRoutineFail, deleteRoutine, fireRoutine, listRoutines, updateRoutine, watchRoutines } from './routines';
import { createProject, deleteProject, listProjects, listRepos, recent, reorderProjects, syncProjects, updateProject } from './projects';
import {
  cloneRepo, createTerminal, githubRepos, killAllTerminals, killTerminal, listDir, readFile, resizeTerminal, writeFile, writeTerminal,
} from './workspace';
import { fixPath } from './proc';

// macOS: o PATH do terminal (claude, git, gh) antes de qualquer agente rodar
fixPath();
if (process.platform === 'win32') app.setAppUserModelId('dev.gustavoreis.central');

const DEV = process.argv.includes('--dev');
const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
// Depuração: --route=/projetos/x abre direto numa tela; --capture=arquivo.png salva um print e fecha.
const ROUTE = arg('route');
const CAPTURE = arg('capture');
let win: BrowserWindow | null = null;

function send<K extends keyof Events>(channel: K, payload: Events[K]): void {
  win?.webContents.send(channel, payload);
}

function handle<K extends keyof Api>(channel: K, fn: (...args: Parameters<Api[K]>) => ReturnType<Api[K]> | Promise<ReturnType<Api[K]>>): void {
  ipcMain.handle(channel, (_e, ...args) => fn(...(args as Parameters<Api[K]>)));
}

const changed = () => send('projects:changed', null);
const routinesChanged = () => send('routines:changed', null);
const agentsChanged = () => send('agents:changed', null);
// backlog mexeu (tela, MCP, execução): avisa a tela e vê se o responsável pelo "A fazer" tem tarefa nova
let dispatchTimer: ReturnType<typeof setTimeout> | null = null;
const backlogChanged = () => {
  send('backlog:changed', null);
  if (!dispatchTimer) dispatchTimer = setTimeout(() => { dispatchTimer = null; dispatchNow(); }, 2000);
};
const dispatchNow = () => {
  if (CAPTURE && !process.argv.includes('--dispatch')) return; // testes não disparam agentes sozinhos (a não ser que peçam)
  const quota = () => getUsage(false).then(u => u.limits.find(l => l.kind === 'session')?.percent ?? null, () => null);
  dispatchTodo({
    quota, setting: getSetting, setSetting, claimed: id => !!claimOf(id),
    start: ({ small, ...input }) => startRun({ ...input, budget_usd: small ? SIZE_BUDGET.small : SIZE_BUDGET.large, proposal_id: null }, emitRun),
  }).catch(() => {});
  // agente de triagem: lê as ideias novas e deixa uma recomendação (gatilho em Triagem)
  dispatchTriage({
    quota, setting: getSetting,
    start: input => startRun({ ...input, project_slug: null, repo_path: null, permission: 'edits', budget_usd: SIZE_BUDGET.medium, proposal_id: null, task_id: null }, emitRun),
  }).then(n => { if (n) send('backlog:changed', null); }, () => {});
  wakeAtReset();
};
/**
 * Freado pela cota: em vez de esperar a próxima conferência (até 1 min), acorda 5 s depois da renovação que a API
 * informa, com o uso atualizado, e despacha na hora.
 */
let resetTimer: { at: string; t: ReturnType<typeof setTimeout> } | null = null;
function wakeAtReset(): void {
  const u = readUsage(usageNow()), l = getLimits();
  const bySession = (u.session ?? 0) >= Math.min(...l.session), byWeek = (u.week ?? 0) >= Math.min(...l.week);
  const at = bySession ? u.sessionReset : byWeek ? u.weekReset : null;
  if (!at || resetTimer?.at === at) return;
  const ms = Date.parse(at) - Date.now() + 5000;
  if (!(ms > 0 && ms < 8 * 3_600_000)) return;
  if (resetTimer) clearTimeout(resetTimer.t);
  resetTimer = { at, t: setTimeout(() => { resetTimer = null; getUsage(true).finally(dispatchNow); }, ms) };
}
const contextChanged = (project: string) => send('context:changed', { project });
const factProject = (id: number) => get<{ p: string }>('select project_slug p from facts where id = ?', id)?.p ?? '';
const navigate = (route: string) => send('app:navigate', route);
// testes (--capture) não mostram notificação na tela de quem está usando o PC
const toast = (title: string, body: string, route: string | null, kind: NotifKind = 'system', ok = true) => { if (!CAPTURE) notify(title, body, route, () => win, navigate, kind, ok); };
// a falha da rotina de comando já avisa como execução (abaixo); não avisa duas vezes
onRoutineFail(() => {});
/** avisa uma vez quando cada execução termina (o tipo decide se avisa: Preferências → Notificações) */
const notified = new Set<number>();
const notifiedWaiting = new Set<number>();
/** "tudo terminou": conta o que terminou desde o último aviso e avisa quando nada mais roda nem espera na fila */
const sinceIdle = { done: 0, failed: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined };
const checkIdle = () => {
  clearTimeout(sinceIdle.timer);
  sinceIdle.timer = setTimeout(() => {
    const active = get<{ n: number }>(`select count(*) n from runs where status in ('queued','preparing','running') and paused is null`)!.n;
    if (active || !sinceIdle.done) return;
    toast('Tudo pronto', `${sinceIdle.done} ${sinceIdle.done === 1 ? 'execução terminou' : 'execuções terminaram'}${sinceIdle.failed ? `, ${sinceIdle.failed} com falha` : ''}. Nada rodando nem na fila.`, '/execucoes', 'idle');
    sinceIdle.done = 0; sinceIdle.failed = 0;
  }, 45_000);
};
const emitRun = {
  event: (e: Events['run:event']) => send('run:event', e),
  update: (r: Events['run:update']) => {
    send('run:update', r);
    if ((r.status === 'succeeded' || r.status === 'failed') && r.finished_at && !notified.has(r.id)) {
      notified.add(r.id);
      const ok = r.status === 'succeeded';
      const kind: NotifKind = r.routine_id ? 'routine' : r.board_id ? 'board' : 'run';
      const who = kind === 'routine' ? 'Rotina' : kind === 'board' ? 'Etapa do quadro' : 'Agente';
      toast(ok ? `${who} concluiu` : `${who} falhou`, `${r.prompt.split('\n')[0]}${r.pr_url ? ' (PR aberto)' : ''}`, `/execucoes?run=${r.id}`, kind, ok);
      sinceIdle.done++; if (!ok) sinceIdle.failed++;
      checkIdle();
    }
    if (r.waiting && !notifiedWaiting.has(r.id)) {
      notifiedWaiting.add(r.id);
      let reason = '';
      try { reason = JSON.parse(r.waiting).reason ?? ''; } catch { /* texto antigo */ }
      toast('Um agente está esperando você', reason || r.prompt.split('\n')[0], `/execucoes?run=${r.id}`, 'waiting');
    }
  },
  changed: () => { backlogChanged(); changed(); },
};

// ---------- IPC ----------

function registerIpc(): void {
  handle('window:fullscreen', on => { win?.setFullScreen(!!on); });
  // área de transferência do sistema (funciona mesmo sem a janela em foco, ao contrário do navigator.clipboard)
  handle('app:copy', text => { clipboard.writeText(String(text)); });
  handle('app:info', () => ({ home: app.getPath('home'), dev_root: DEV_ROOT, db_path: DB_PATH, version: app.getVersion(), data_dir: app.getPath('userData'), platform: process.platform }));

  handle('projects:list', () => listProjects());
  handle('projects:create', input => {
    const p = createProject(input);
    syncProjects(p.slug, changed);
    return p;
  });
  handle('projects:update', (slug, patch) => {
    updateProject(slug, patch);
    if (patch.folder) syncProjects(slug, changed);
    changed();
  });
  handle('projects:delete', slug => { deleteProject(slug); changed(); backlogChanged(); });
  handle('dialog:image', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Imagem', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'] }] });
    if (r.canceled) return null;
    const file = r.filePaths[0];
    const ext = file.split('.').pop()!.toLowerCase();
    const mime = ext === 'svg' ? 'svg+xml' : ext === 'jpg' ? 'jpeg' : ext;
    const buf = readFileSync(file);
    if (buf.length <= 400 * 1024) return `data:image/${mime};base64,${buf.toString('base64')}`;
    // foto grande: reduz para ícone (png/jpg; o nativeImage do Windows não lê webp/gif/svg)
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) throw new Error('Imagem grande demais (máximo 400 KB). Use PNG ou JPG, que a Central reduz sozinha.');
    const { width, height } = img.getSize();
    const small = img.resize(width >= height ? { width: 256 } : { height: 256 }).toPNG();
    return `data:image/png;base64,${small.toString('base64')}`;
  });
  handle('projects:sync', slug => { syncProjects(slug, changed); });
  handle('projects:reorder', slugs => { reorderProjects(slugs); changed(); });
  handle('repos:list', slug => listRepos(slug));
  handle('commits:recent', (slug, days, limit) => recent(slug, days, limit));

  handle('proposals:list', statuses => listProposals(statuses));
  handle('proposals:create', input => { const p = createProposal(input); changed(); return p; });
  handle('proposals:decide', (id, verdict, reason) => { decide(id, verdict, reason); backlogChanged(); changed(); });
  handle('proposals:delete', id => { deleteProposal(id); backlogChanged(); changed(); });
  // Direcionar para quem pediu: na mesma sessão que criou a decisão. null = não dá (a tela abre uma conversa nova)
  handle('proposals:steer', (id, agentId, text) => {
    const p = get<{ agent_id: number | null; origin_chat: number | null; origin_run: number | null }>('select agent_id, origin_chat, origin_run from proposals where id = ?', id);
    if (!p || !p.agent_id || p.agent_id !== agentId) return null;
    let chatId: number | null = null;
    if (p.origin_chat && get('select 1 from chats where id = ?', p.origin_chat)) chatId = p.origin_chat;
    else if (p.origin_run && !get(`select 1 from runs where id = ? and status in ('queued','preparing','running')`, p.origin_run)) {
      try { chatId = chatFromRun(p.origin_run); } catch { chatId = null; }
    }
    if (!chatId) return null;
    sendChat(chatId, agentId, text, chatNotify, () => { changed(); backlogChanged(); }, null, null);
    changed();
    return chatId;
  });

  handle('runs:list', slug => listRuns(slug));
  handle('runs:start', input => startRun(input, emitRun));
  handle('runs:kill', id => killRun(id, emitRun));
  handle('runs:unpause', id => unpauseRun(id, emitRun));
  handle('runs:continue', (id, note) => continueRun(id, note, emitRun));
  handle('runs:grant', id => grantRun(id, emitRun));
  handle('runs:handoff', (id, agentId, note) => handoffRun(id, agentId, note, emitRun));
  handle('runs:events', id => listEvents(id));

  handle('fs:list', dir => listDir(dir));
  handle('fs:read', path => readFile(path));
  handle('fs:write', (path, content) => writeFile(path, content));

  handle('pty:create', input => createTerminal(input, input.kind === 'claude' && input.project_slug ? sessionPromptFile(input.project_slug) : null, (id, data) => send('pty:data', { id, data }), (id, code) => send('pty:exit', { id, code })));
  handle('pty:write', (id, data) => { writeTerminal(id, data); });
  handle('pty:resize', (id, cols, rows) => resizeTerminal(id, cols, rows));
  handle('pty:kill', id => killTerminal(id));

  handle('github:repos', () => githubRepos());
  handle('github:clone', (fullName, folder) => cloneRepo(fullName, folder, p => send('clone:progress', p), () => syncProjects(null, changed)));

  handle('shell:reveal', path => { shell.openPath(path); });
  handle('shell:vscode', path => { execFile('code', [path], { shell: true, windowsHide: true }, () => {}); });
  handle('shell:external', url => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });
  handle('usage:get', force => getUsage(force));

  handle('ideas:list', () => listIdeas());
  handle('ideas:create', input => { const i = createIdea(input); backlogChanged(); return i; });
  handle('ideas:update', (id, patch) => { updateIdea(id, patch); backlogChanged(); });
  handle('ideas:promote', (id, slug) => { const t = promoteIdea(id, slug); backlogChanged(); return t; });
  handle('ideas:import', async () => { const r = await importPending(); backlogChanged(); return r; });

  handle('tasks:list', slug => listTasks(slug));
  handle('tasks:create', input => { const t = createTask(input); backlogChanged(); return t; });
  handle('tasks:update', (id, patch) => { updateTask(id, patch); backlogChanged(); });
  handle('tasks:delete', id => { deleteTask(id); backlogChanged(); });

  handle('turns:list', () => listTurns());
  handle('turns:start', input => startTurn(input, emitRun));
  handle('turns:stop', id => stopTurn(id, emitRun));

  handle('prefs:get', () => getPrefs());
  handle('prefs:set', patch => setPrefs(patch, () => win, navigate));
  handle('update:check', force => checkUpdate(force));
  handle('update:install', () => installUpdate(() => { markQuitting(); pauseAllOnQuit(); stopAllChats(); stopAllExtensions(); killAllTerminals(); }));
  handle('update:build', publish => buildUpdate(publish, line => send('update:log', { line }), (ok, message) => send('update:built', { ok, message })));

  handle('routines:list', () => listRoutines());
  handle('direction:get', slug => getDirection(slug));
  handle('direction:history', slug => directionHistory(slug));
  handle('direction:set', (slug, text, note) => { const d = setDirection(slug, text, 'gustavo', note); changed(); return d; });
  handle('backlog:plan', (slug, request) => planBacklog(slug, request, emitRun));
  handle('routines:create', input => { const r = createRoutine(input); routinesChanged(); return r; });
  handle('routines:update', (id, patch) => { updateRoutine(id, patch); routinesChanged(); });
  handle('routines:delete', id => { deleteRoutine(id); routinesChanged(); });
  handle('routines:fire', async id => { const r = await fireRoutine(id, emitRun, true); routinesChanged(); return r; });

  const chatNotify = (chat_id: number, message: Events['chat:event']['message'], busy: boolean): void => {
    send('chat:event', { chat_id, message, busy });
    // guiar projeto: quando um dos dois termina de falar, o outro recebe a vez
    if (!message && !busy) try { guideIdle(chat_id, guideDeps); } catch (e) { console.error('guia', e); }
  };
  const guideDeps = { notify: chatNotify, changed: () => { send('guides:changed', null); changed(); } };
  handle('guides:list', () => listGuides());
  handle('guides:start', (slug, direct) => startGuide(slug, direct, guideDeps));
  handle('guides:step', (id, step) => { setStep(id, step); send('guides:changed', null); });
  handle('guides:answer', (id, cardId, answer) => { answerCard(id, cardId, answer); send('guides:changed', null); });
  handle('guides:plan', id => requestPlan(id, guideDeps));
  handle('guides:item', (id, itemId, patch) => { setPlanItem(id, itemId, patch); send('guides:changed', null); });
  handle('guides:approve', id => { approvePlan(id, guideDeps); backlogChanged(); });
  handle('guides:ask', (id, q) => askStrategist(id, q, guideDeps));
  handle('guides:abandon', id => { abandonGuide(id); send('guides:changed', null); });
  // WhatsApp (extensão): os donos conversam com a Central por lá; a resposta aparece aqui também
  initWhatsApp({ notify: chatNotify, changed: () => { changed(); backlogChanged(); }, onStatus: () => send('ext:changed', null), centralId: () => get<{ id: number }>('select id from agents where builtin = 1')!.id,
    startListen: input => startRun({ ...input, repo_path: null, permission: 'edits', budget_usd: SIZE_BUDGET.small, proposal_id: null }, emitRun).id });
  handle('agents:list', () => listAgents());
  handle('agents:create', input => { const a = createAgent(input); agentsChanged(); return a; });
  handle('agents:update', (id, patch) => { updateAgent(id, patch); agentsChanged(); });
  handle('agents:delete', id => { deleteAgent(id); agentsChanged(); routinesChanged(); });

  handle('chat:list', agentId => listChats(agentId));
  handle('chat:messages', id => listMessages(id));
  handle('chat:send', (id, agentId, text, slug, options) => sendChat(id, agentId, text, chatNotify, () => { changed(); backlogChanged(); routinesChanged(); agentsChanged(); }, slug ?? null, options ?? null));
  handle('sessions:list', slug => listSessions(slug));
  handle('sessions:create', (slug, kind, chatId) => createSession(slug, kind, chatId ?? null));
  handle('sessions:update', (id, patch) => updateSession(id, patch));
  handle('sessions:close', id => closeSession(id));
  handle('claude:sessions', () => listClaudeSessions());
  handle('activity:list', () => listActivity());
  handle('milestones:list', slug => listMilestones(slug));
  handle('milestones:create', (slug, input) => { const m = createMilestone(slug, input); backlogChanged(); return m; });
  handle('milestones:update', (id, input) => { updateMilestone(id, input); backlogChanged(); });
  handle('milestones:delete', id => { deleteMilestone(id); backlogChanged(); });
  handle('milestones:reorder', (ids, horizon) => { reorderMilestones(ids, horizon); backlogChanged(); });
  handle('milestones:events', slug => milestoneEvents(slug));
  handle('context:status', () => contextStatus());
  handle('context:reindex', (slug, force) => { indexProject(slug, force); importClaudeMemory(slug); });
  handle('context:graph', slug => graphData(slug));
  handle('context:node', key => nodeDetail(key));
  handle('context:search', (slug, q) => searchHits(slug, q));
  handle('context:block', (slug, focus, budget) => contextBlock(slug, focus ? [focus] : [], budget));
  handle('boards:list', () => listBoards());
  handle('boards:create', input => { const b = createBoard(input); backlogChanged(); return b; });
  handle('boards:update', (id, patch) => { updateBoard(id, patch); backlogChanged(); });
  handle('boards:delete', id => { deleteBoard(id); backlogChanged(); });
  handle('boards:columns', (id, cols) => { const c = saveColumns(id, cols); backlogChanged(); return c; });
  handle('boards:stages', () => stagesOf());
  handle('boards:place', (taskId, boardId, stage, position) => { setStage(taskId, boardId, stage, position); backlogChanged(); });
  handle('boards:remove', (taskId, boardId) => { removeFromBoard(taskId, boardId); backlogChanged(); });
  handle('deliveries:list', (since, status) => listDeliveries(since, status));
  handle('deliveries:board', () => reviewBoard());
  handle('deliveries:review', (id, action, note) => { reviewDelivery(id, action, note); backlogChanged(); });
  handle('digest:get', since => digest(since));
  handle('release:status', (slug, refresh) => releaseStatus(slug, !!refresh));
  handle('release:summary', () => releaseSummary());
  handle('memories:list', (scope, retired) => listMemories(scope, !!retired));
  handle('memories:create', input => { const m = createMemory(input); agentsChanged(); return m; });
  handle('memories:update', (id, patch) => { updateMemory(id, patch); agentsChanged(); });
  handle('memories:forget', (id, reason) => { forgetMemory(id, reason); agentsChanged(); });
  handle('memories:delete', id => { deleteMemory(id); agentsChanged(); });
  handle('facts:list', slug => listFacts(slug));
  handle('facts:create', input => { const f = createFact(input); contextChanged(input.project_slug); return f; });
  handle('facts:update', (id, patch) => { updateFact(id, patch); contextChanged(factProject(id)); });
  handle('facts:supersede', (id, reason, replacement) => { supersedeFact(id, reason, replacement); contextChanged(factProject(id)); });
  handle('facts:delete', id => { const p = factProject(id); deleteFact(id); contextChanged(p); });
  handle('facts:import', slug => { const n = importClaudeMemory(slug); contextChanged(slug); return n; });
  handle('claude:import', (id, slug) => importClaudeSession(id, slug));
  handle('chat:fromRun', runId => chatFromRun(runId));
  // descarta o "esperando você" sem retomar: a tarefa volta para a fila e a próxima execução usa a configuração atual do agente
  handle('runs:dismissWaiting', runId => { run('update runs set waiting = null where id = ?', runId); emitRun.update(runDto(runId)); backlogChanged(); });
  handle('runs:resume', (runId, note) => {
    const w = get<{ waiting: string | null; agent_id: number | null }>('select waiting, agent_id from runs where id = ?', runId);
    if (!w?.waiting) throw new Error('Essa execução não está esperando.');
    const why = (JSON.parse(w.waiting) as { reason: string }).reason;
    const chatId = chatFromRun(runId);
    run('update runs set waiting = null where id = ?', runId);
    const agentId = get<{ a: number }>('select agent_id a from chats where id = ?', chatId)!.a;
    sendChat(chatId, agentId, `O Gustavo resolveu o que faltava (${why}).${note?.trim() ? ` Ele disse: ${note.trim()}` : ''}\nContinue de onde parou e termine a tarefa; no fim, conte a entrega.`,
      chatNotify, () => { changed(); backlogChanged(); }, null, null);
    emitRun.update(runDto(runId));
    backlogChanged();
    return chatId;
  });
  handle('chat:rename', (id, title) => { renameChat(id, title); });
  handle('chat:stop', id => stopChat(id));
  handle('chat:delete', id => deleteChat(id));

  // ---------- extensões ----------
  handle('ext:list', () => listExtensions());
  handle('ext:install', async id => { await installExtension(id); });
  handle('ext:uninstall', async id => { await uninstallExtension(id); });
  handle('ext:enable', (id, on) => setExtensionEnabled(id, on));
  handle('wa:status', () => waStatus());
  handle('wa:pair', (account, phone) => pairAccount(account, phone));
  handle('wa:logout', async account => { await callExtension('whatsapp', 'logout', { account }); });
  handle('wa:setAgent', (account, agentId) => { setAccountAgent(account, agentId); send('ext:changed', null); });
  handle('wa:setOpen', (account, on) => { setAccountOpen(account, on); send('ext:changed', null); });
  handle('wa:contacts', () => listContacts());
  handle('wa:groups', account => listGroups(account));
  handle('wa:chats', () => chatsStatus());
  handle('wa:setChats', list => { setChatCfgs(list); send('ext:changed', null); });
  // ler agora o que acumulou numa conversa escutada (sem esperar o intervalo)
  handle('wa:digestNow', (account, chat) => { const c = chatsStatus().find(x => x.account === account && x.chat === chat && x.listen); return c ? digestListened({ account: c.account, chat: c.chat, name: c.name, group: c.group, agent_id: c.listen_agent }) : null; });
  handle('stt:status', () => sttStatus());
  handle('stt:config', patch => { setSttConfig(patch); });
  handle('stt:prepare', async () => { await prepareLocal(); });
  handle('chat:grant', (chatId, kind, value) => grantChat(chatId, { kind, value }));
  handle('chat:yolo', (chatId, on) => setChatYolo(chatId, on));
  // levar a Central para outro computador (Preferências → Sobre) e achar projetos na primeira abertura
  handle('data:export', async () => {
    const r = await dialog.showSaveDialog(win!, { title: 'Exportar dados da Central', defaultPath: join(app.getPath('documents'), `central-dados-${new Date().toISOString().slice(0, 10)}.db`), filters: [{ name: 'Dados da Central', extensions: ['db'] }] });
    if (r.canceled || !r.filePath) return null;
    exportData(r.filePath);
    return r.filePath;
  });
  handle('data:pickImport', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Importar dados da Central', properties: ['openFile'], filters: [{ name: 'Dados da Central', extensions: ['db'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return { path: r.filePaths[0], counts: inspectImport(r.filePaths[0]) };
  });
  handle('data:import', path => {
    inspectImport(path);
    const prepared = join(app.getPath('temp'), `central-import-${Date.now()}.db`);
    copyFileSync(path, prepared);
    adaptImport(prepared);
    // fecha tudo que usa o banco antes de trocar, e abre de novo já com os dados novos
    pauseAllOnQuit(); stopAllChats(); stopAllExtensions(); killAllTerminals();
    swapDatabase(prepared);
    if (!CAPTURE) app.relaunch(); // nos testes, a próxima abertura confere
    app.exit(0);
  });
  handle('projects:discover', () => discoverProjects());
  // notificações: o que avisa, som, não perturbe
  handle('notif:get', () => getNotif());
  handle('notif:set', patch => setNotif(patch));
  handle('notif:test', () => {
    const p = getNotif();
    if (Notification.isSupported()) new Notification({ title: 'Central', body: 'Assim chegam os avisos.', silent: p.sound !== 'system' }).show();
    if (p.sound !== 'system' && p.sound !== 'none') win?.webContents.send('notify:sound', p.sound);
  });
  // MCPs do Claude Code (Preferências → MCPs)
  handle('mcp:list', force => listMcpServers(!!force));
  handle('mcp:add', input => addMcpServer(input));
  handle('mcp:remove', name => removeMcpServer(name));
  // imagens nos chats: a tela salva o print colado e mostra as miniaturas
  handle('chat:attach', (bytes, ext) => saveImage(CHAT_MEDIA, bytes, ext));
  handle('chat:image', path => imageDataUrl(CHAT_MEDIA, path));
  // ditado nos chats: o áudio gravado na tela vira texto pelo motor escolhido (o ffmpeg da extensão abre o webm)
  handle('stt:dictate', async audio => {
    const file = join(app.getPath('temp'), `central-ditado-${Date.now()}.webm`);
    writeFileSync(file, Buffer.from(audio));
    try { return (await transcribeFile(file)).text; } finally { rmSync(file, { force: true }); }
  });
  // só nos testes (--capture): transcrever/analisar direto
  if (CAPTURE) ipcMain.handle('stt:test', async (_e, kind: string, path: string) => (kind === 'video' ? analyzeVideo(path) : transcribeFile(path)));
  // só nos testes (--capture): simula uma mensagem chegando e devolve o que a Central responderia pelo WhatsApp
  if (CAPTURE) ipcMain.handle('wa:test-presence', (_e, account: string, chat: string, state: string) => { waPresence(account, chat, state); });
  if (CAPTURE) ipcMain.handle('wa:test-inbound', async (_e, m: Record<string, unknown>) => {
    const sent: { account: string; to: string; text: string }[] = [];
    waSetSender(async (account, to, text) => { sent.push({ account, to, text }); return {}; });
    waInbound({ account: 'main', id: 't', chat: '5511900000000@s.whatsapp.net', phone: null, name: null, fromMe: false, self: false, text: '', at: Date.now(), ...m } as never);
    for (let i = 0; i < 240 && !sent.length; i++) await new Promise(r => setTimeout(r, 1000));
    return sent;
  });

  // freio da cota: as faixas (Preferências) e o que ele está segurando agora (barra de uso)
  handle('gov:get', () => ({ limits: getLimits(), brake: brakeLabel(readUsage(usageNow())) }));
  handle('gov:set', l => { const v = setLimits(l); setSetting('gov:limits', JSON.stringify(v)); send('gov:changed', null); return v; });
  handle('settings:get', key => getSetting(key));
  handle('settings:set', (key, value) => { setSetting(key, value); if (key.startsWith('triage:')) backlogChanged(); });

  handle('dialog:folder', async defaultPath => {
    const r = await dialog.showOpenDialog(win!, { defaultPath, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1024, minHeight: 640,
    icon: join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#141922',
    title: 'Central',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#141922', symbolColor: '#8A93A6', height: 40 },
    show: false,
    // print de depuração: fora da tela, sem foco e sem barra de tarefas, para não atrapalhar quem está usando o PC
    ...(CAPTURE ? { x: -4000, y: 0, focusable: false, skipTaskbar: true } : {}),
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: !CAPTURE },
  });
  // aberto pelo Windows ao iniciar (--hidden): fica só na bandeja
  win.once('ready-to-show', () => (CAPTURE ? win!.showInactive() : process.argv.includes('--hidden') && getPrefs().tray ? null : win!.show()));
  keepAliveOnClose(win);
  // Links externos abrem no navegador, nunca dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  const hash = ROUTE ? `#${ROUTE}` : '';
  if (DEV) win.loadURL(`http://localhost:4300/${hash}`);
  else win.loadFile(join(__dirname, '..', 'dist', 'web', 'browser', 'index.html'), { hash: ROUTE });
  // Windows desligando ou saindo da conta: o before-quit pode não rodar; pausa igual ao fechar normal
  win.on('session-end', () => { markQuitting(); pauseAllOnQuit(); stopAllChats(); stopAllExtensions(); });
  if (CAPTURE) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const js = arg('exec64') && Buffer.from(arg('exec64')!, 'base64').toString('utf8');
      if (js) {
        const out = await win!.webContents.executeJavaScript(js).catch(e => `erro: ${e}`);
        console.log('EXEC', JSON.stringify(out));
        await new Promise(r => setTimeout(r, 4000));
      }
      // janela atrás de outras não redesenha: força um quadro novo antes do print
      win!.webContents.invalidate();
      await new Promise(r => setTimeout(r, 400));
      writeFileSync(CAPTURE, (await win!.webContents.capturePage()).toPNG());
      app.quit();
    }, Number(arg('wait') ?? 6000)));
  }
}

app.whenReady().then(() => {
  seedAgents();
  seedAgentsV2();
  registerIpc();
  createWindow();
  // conversas que a Central interrompeu ao fechar continuam (as execuções voltam pela fila, na mesma sessão)
  if (!CAPTURE || process.argv.includes('--dispatch')) setTimeout(() => resumeInterruptedChats((chat_id, message, busy) => send('chat:event', { chat_id, message, busy }), () => { changed(); backlogChanged(); }), 4000);
  if (!CAPTURE) setupTray(() => win, navigate);
  // extensões instaladas (WhatsApp…) ligam junto; o WhatsApp conversa com a Central pelos donos cadastrados
  onExtensionsChange(() => send('ext:changed', null));
  initMedia(() => send('ext:changed', null));
  if (!CAPTURE || process.argv.includes('--extensions')) startInstalled();
  try { setLimits(JSON.parse(getSetting('gov:limits') ?? 'null')); } catch { /* fica o padrão */ }
  watchTurns(emitRun);
  // freio da cota: pausa perto do limite e retoma quando renova (testes só com --dispatch)
  if (!CAPTURE || process.argv.includes('--dispatch')) watchQuota(emitRun);
  watchRoutines({ ...emitRun, changed: () => { emitRun.changed(); routinesChanged(); } });
  // índice de código: um processo à parte indexa os projetos e acompanha as mudanças
  startContext(slug => contextChanged(slug));
  onActivity((scope, ref, activity) => send('activity', { scope, ref, activity: activity as never }));
  onChatStream((chat_id, text) => send('chat:stream', { chat_id, text }));
  // responsável pelo "A fazer": confere de minuto em minuto (vaga liberada, cota voltou, horário abriu)
  setInterval(dispatchNow, 60_000);
  setTimeout(() => {
    indexAll();
    for (const p of all<{ slug: string }>(`select slug from projects where status <> 'dead'`)) importClaudeMemory(p.slug);
  }, CAPTURE ? 500 : 8000);
  startMcp({ emit: emitRun, projects: changed, backlog: backlogChanged, routines: routinesChanged, agents: agentsChanged })
    .catch(e => console.error('MCP da Central não subiu', e));
  // sincroniza repositórios e, depois, leva para Feito as tarefas cujo PR foi mergeado
  // e abre decisões para CI quebrado nos repositórios ativos
  const watchGithub = () => Promise.all([syncPullRequests(), syncCiFailures()])
    .then(([prs, ci]) => {
      if (prs) backlogChanged();
      if (ci) { backlogChanged(); changed(); toast('CI quebrado', `${ci} ${ci === 1 ? 'repositório está' : 'repositórios estão'} com o GitHub Actions falhando.`, '/triagem', 'ci', false); }
    });
  // depois da varredura dos repositórios, o índice pega os que acabaram de aparecer (incremental: barato)
  syncProjects(null, changed).then(() => { indexAll(); return watchGithub(); });
  setInterval(watchGithub, 15 * 60_000);
});

app.on('before-quit', () => { markQuitting(); pauseAllOnQuit(); stopAllChats(); stopAllExtensions(); });

// uma Central só: abrir de novo traz a janela que já está rodando (na bandeja, por exemplo)
// (só no app de verdade: dev e testes com --data rodam ao lado da instalada)
if (!CAPTURE && !DEV && !arg('data') && !app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
// Mac: clicar no ícone do Dock com a janela escondida (na bandeja) traz ela de volta
app.on('activate', () => { if (win) { win.show(); win.focus(); } });

app.on('window-all-closed', () => {
  killAllTerminals();
  app.quit();
});

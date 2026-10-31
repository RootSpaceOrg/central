import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Api, Events } from '../src/app/shared/contract';
import { DB_PATH, DEV_ROOT } from './db';
import { killRun, listEvents, listRuns, listTurns, startRun, startTurn, stopTurn, watchTurns } from './agents';
import {
  createIdea, createProposal, createTask, decide, deleteTask, getSetting, importPending, listIdeas, listProposals, listTasks, promoteIdea,
  setSetting, syncCiFailures, syncPullRequests, updateIdea, updateTask,
} from './backlog';
import { buildUpdate, checkUpdate, installUpdate } from './updater';
import { getUsage } from './usage';
import { getPrefs, keepAliveOnClose, markQuitting, notify, setPrefs, setupTray } from './desktop';
import { chatFromRun, deleteChat, listChats, listMessages, renameChat, sendChat, stopChat } from './central-agent';
import { createAgent, deleteAgent, listAgents, seedAgents, seedAgentsV2, updateAgent } from './agentdefs';
import { startMcp } from './mcp';
import { createRoutine, deleteRoutine, fireRoutine, listRoutines, updateRoutine, watchRoutines } from './routines';
import { createProject, deleteProject, listProjects, listRepos, recent, syncProjects, updateProject } from './projects';
import {
  cloneRepo, createTerminal, githubRepos, killAllTerminals, killTerminal, listDir, readFile, resizeTerminal, writeFile, writeTerminal,
} from './workspace';

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
const backlogChanged = () => send('backlog:changed', null);
const navigate = (route: string) => send('app:navigate', route);
// testes (--capture) não mostram notificação na tela de quem está usando o PC
const toast = (title: string, body: string, route: string | null) => { if (!CAPTURE) notify(title, body, route, () => win, navigate); };
/** avisa uma vez quando cada execução termina */
const notified = new Set<number>();
const emitRun = {
  event: (e: Events['run:event']) => send('run:event', e),
  update: (r: Events['run:update']) => {
    send('run:update', r);
    if ((r.status === 'succeeded' || r.status === 'failed') && r.finished_at && !notified.has(r.id)) {
      notified.add(r.id);
      const who = r.routine_id ? 'Rotina' : 'Agente';
      toast(r.status === 'succeeded' ? `${who} concluiu` : `${who} falhou`, `${r.prompt.split('\n')[0]}${r.pr_url ? ' (PR aberto)' : ''}`, `/execucoes?run=${r.id}`);
    }
  },
  changed: () => { backlogChanged(); changed(); },
};

// ---------- IPC ----------

function registerIpc(): void {
  handle('app:info', () => ({ home: app.getPath('home'), dev_root: DEV_ROOT, db_path: DB_PATH, version: app.getVersion() }));

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
    if (buf.length > 400 * 1024) throw new Error('Imagem grande demais (máximo 400 KB).');
    return `data:image/${mime};base64,${buf.toString('base64')}`;
  });
  handle('projects:sync', slug => { syncProjects(slug, changed); });
  handle('repos:list', slug => listRepos(slug));
  handle('commits:recent', (slug, days, limit) => recent(slug, days, limit));

  handle('proposals:list', statuses => listProposals(statuses));
  handle('proposals:create', input => { const p = createProposal(input); changed(); return p; });
  handle('proposals:decide', (id, verdict, reason) => { decide(id, verdict, reason); backlogChanged(); changed(); });

  handle('runs:list', slug => listRuns(slug));
  handle('runs:start', input => startRun(input, emitRun));
  handle('runs:kill', id => killRun(id, emitRun));
  handle('runs:events', id => listEvents(id));

  handle('fs:list', dir => listDir(dir));
  handle('fs:read', path => readFile(path));
  handle('fs:write', (path, content) => writeFile(path, content));

  handle('pty:create', input => createTerminal(input, (id, data) => send('pty:data', { id, data }), (id, code) => send('pty:exit', { id, code })));
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
  handle('update:install', () => installUpdate());
  handle('update:build', publish => buildUpdate(publish, line => send('update:log', { line }), (ok, message) => send('update:built', { ok, message })));

  handle('routines:list', () => listRoutines());
  handle('routines:create', input => { const r = createRoutine(input); routinesChanged(); return r; });
  handle('routines:update', (id, patch) => { updateRoutine(id, patch); routinesChanged(); });
  handle('routines:delete', id => { deleteRoutine(id); routinesChanged(); });
  handle('routines:fire', async id => { const r = await fireRoutine(id, emitRun, true); routinesChanged(); return r; });

  const chatNotify = (chat_id: number, message: Events['chat:event']['message'], busy: boolean) => send('chat:event', { chat_id, message, busy });
  handle('agents:list', () => listAgents());
  handle('agents:create', input => { const a = createAgent(input); agentsChanged(); return a; });
  handle('agents:update', (id, patch) => { updateAgent(id, patch); agentsChanged(); });
  handle('agents:delete', id => { deleteAgent(id); agentsChanged(); routinesChanged(); });

  handle('chat:list', agentId => listChats(agentId));
  handle('chat:messages', id => listMessages(id));
  handle('chat:send', (id, agentId, text) => sendChat(id, agentId, text, chatNotify, () => { changed(); backlogChanged(); routinesChanged(); agentsChanged(); }));
  handle('chat:fromRun', runId => chatFromRun(runId));
  handle('chat:rename', (id, title) => { renameChat(id, title); });
  handle('chat:stop', id => stopChat(id));
  handle('chat:delete', id => deleteChat(id));

  handle('settings:get', key => getSetting(key));
  handle('settings:set', (key, value) => { setSetting(key, value); });

  handle('dialog:folder', async defaultPath => {
    const r = await dialog.showOpenDialog(win!, { defaultPath, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1024, minHeight: 640,
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
  if (!CAPTURE) setupTray(() => win, navigate);
  watchTurns(emitRun);
  watchRoutines({ ...emitRun, changed: () => { emitRun.changed(); routinesChanged(); } });
  startMcp({ emit: emitRun, projects: changed, backlog: backlogChanged, routines: routinesChanged, agents: agentsChanged })
    .catch(e => console.error('MCP da Central não subiu', e));
  // sincroniza repositórios e, depois, leva para Feito as tarefas cujo PR foi mergeado
  // e abre decisões para CI quebrado nos repositórios ativos
  const watchGithub = () => Promise.all([syncPullRequests(), syncCiFailures()])
    .then(([prs, ci]) => {
      if (prs) backlogChanged();
      if (ci) { backlogChanged(); changed(); toast('CI quebrado', `${ci} ${ci === 1 ? 'repositório está' : 'repositórios estão'} com o GitHub Actions falhando.`, '/decisoes'); }
    });
  syncProjects(null, changed).then(watchGithub);
  setInterval(watchGithub, 15 * 60_000);
});

app.on('before-quit', () => markQuitting());

// uma Central só: abrir de novo traz a janela que já está rodando (na bandeja, por exemplo)
// (só no app de verdade: dev e testes com --data rodam ao lado da instalada)
if (!CAPTURE && !DEV && !arg('data') && !app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

app.on('window-all-closed', () => {
  killAllTerminals();
  app.quit();
});

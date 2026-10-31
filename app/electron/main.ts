import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Api, Events, NewProposalInput, ProposalDto, ProposalStatus, Verdict } from '../src/app/shared/contract';
import { DB_PATH, DEV_ROOT, all, get, now, run } from './db';
import { killRun, listEvents, listRuns, listTurns, startRun, startTurn, stopTurn, watchTurns } from './agents';
import {
  createIdea, createTask, deleteTask, getSetting, importPending, listIdeas, listTasks, promoteIdea, setSetting, updateIdea, updateTask,
} from './backlog';
import { buildUpdate, checkUpdate, installUpdate } from './updater';
import { getUsage } from './usage';
import { createProject, listProjects, listRepos, recent, syncProjects, updateProject } from './projects';
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
const backlogChanged = () => send('backlog:changed', null);
const emitRun = {
  event: (e: Events['run:event']) => send('run:event', e),
  update: (r: Events['run:update']) => send('run:update', r),
  changed: () => { backlogChanged(); changed(); },
};

// ---------- propostas ----------

const VERDICT: Record<Verdict, ProposalStatus> = { approve: 'approved', defer: 'deferred', reject: 'rejected' };

function listProposals(statuses: ProposalStatus[]): ProposalDto[] {
  return all<ProposalDto>(`select id, project_slug, title, body, tier, est_attention_min, next_action, status, source, created_at, updated_at
    from proposals where status in (${statuses.map(() => '?').join(',') || "''"})
    order by coalesce(tier, 9), created_at desc`, ...statuses);
}

function createProposal(input: NewProposalInput): ProposalDto {
  const title = input.title?.trim();
  if (!title) throw new Error('Escreva o que precisa acontecer.');
  const { lastInsertRowid } = run(`insert into proposals (project_slug, title, body, source, source_ref) values (?,?,?,'manual',?)`,
    input.project_slug || null, title, input.body?.trim() || null, `${Date.now()}-${Math.random()}`);
  return get<ProposalDto>('select * from proposals where id = ?', Number(lastInsertRowid))!;
}

function decide(id: number, verdict: Verdict, reason: string | null): void {
  if (!VERDICT[verdict]) throw new Error('Decisão inválida.');
  if (!run('update proposals set status = ?, updated_at = ? where id = ?', VERDICT[verdict], now(), id).changes) {
    throw new Error('Proposta não encontrada.');
  }
  run('insert into decisions (proposal_id, verdict, reason) values (?,?,?)', id, verdict, reason);
  // aprovar vira tarefa em "A fazer", pronta para um agente
  const p = get<ProposalDto>('select * from proposals where id = ?', id)!;
  if (verdict === 'approve' && p.project_slug && !get('select 1 from tasks where proposal_id = ?', id)) {
    createTask({
      project_slug: p.project_slug, repo_path: null, title: p.title,
      body: [p.body, p.next_action && `Próximo passo esperado: ${p.next_action}`].filter(Boolean).join('\n\n') || null,
      column: 'todo', priority: p.tier === 2 ? 0 : 1, proposal_id: id,
    });
    backlogChanged();
  }
  changed();
}

// ---------- IPC ----------

function registerIpc(): void {
  handle('app:info', () => ({ home: app.getPath('home'), dev_root: DEV_ROOT, db_path: DB_PATH, version: app.getVersion() }));

  handle('projects:list', () => listProjects());
  handle('projects:create', input => {
    const p = createProject(input);
    syncProjects(p.slug, changed);
    return p;
  });
  handle('projects:update', (slug, patch) => { updateProject(slug, patch); changed(); });
  handle('projects:sync', slug => { syncProjects(slug, changed); });
  handle('repos:list', slug => listRepos(slug));
  handle('commits:recent', (slug, days, limit) => recent(slug, days, limit));

  handle('proposals:list', statuses => listProposals(statuses));
  handle('proposals:create', input => { const p = createProposal(input); changed(); return p; });
  handle('proposals:decide', (id, verdict, reason) => decide(id, verdict, reason));

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

  handle('update:check', () => checkUpdate());
  handle('update:install', () => installUpdate());
  handle('update:build', () => buildUpdate(line => send('update:log', { line }), (ok, message) => send('update:built', { ok, message })));

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
  win.once('ready-to-show', () => (CAPTURE ? win!.showInactive() : win!.show()));
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
  registerIpc();
  createWindow();
  watchTurns(emitRun);
  syncProjects(null, changed);
});

app.on('window-all-closed', () => {
  killAllTerminals();
  app.quit();
});

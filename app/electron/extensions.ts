/**
 * Extensões instaláveis: integrações que não vêm no núcleo da Central (WhatsApp hoje; transcrição de chamadas e outras
 * depois). Cada uma é um arquivo só (empacotado em dist-ext/, publicado como anexo do release), baixado para
 * %APPDATA%/Central/extensions/<id>/ e rodado num processo próprio (utilityProcess): se ela travar ou cair, a Central
 * segue; ela volta sozinha. O hash de cada arquivo vem fixo no app (ext-catalog.json): arquivo diferente não roda.
 */
import { UtilityProcess, app, utilityProcess } from 'electron';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { getSetting, setSetting } from './backlog';
import catalogJson from './ext-catalog.json';

export interface ExtensionInfo { id: string; name: string; version: string; description: string; warning?: string; file: string; sha256: string }
const CATALOG = catalogJson as Record<string, ExtensionInfo>;
const REPO = 'RootSpaceOrg/central';
const execFileP = promisify(execFile);

const dirOf = (id: string) => join(app.getPath('userData'), 'extensions', id);
const fileOf = (id: string) => join(dirOf(id), CATALOG[id].file);
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

type Listener = (event: string, data: any) => void;
const procs = new Map<string, UtilityProcess>();
const listeners = new Map<string, Set<Listener>>();
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let seq = 0;
/** a Central está fechando: extensão que sai não volta (senão o processo novo segura o app aberto) */
let quitting = false;
/** avisa a tela quando muda (instalou, ligou, caiu) */
let onChange: () => void = () => {};
export const onExtensionsChange = (fn: () => void) => { onChange = fn; };

export const installed = (id: string) => !!CATALOG[id] && existsSync(fileOf(id));
export const running = (id: string) => procs.has(id);

export function listExtensions() {
  return Object.values(CATALOG).map(e => ({ ...e, installed: installed(e.id), running: running(e.id), enabled: getSetting(`ext:${e.id}:enabled`) !== '0' }));
}

/** Instala (ou atualiza): em dev copia do build local; instalado, baixa do release desta versão pelo gh. */
export async function installExtension(id: string): Promise<void> {
  const e = CATALOG[id];
  if (!e) throw new Error('Extensão desconhecida.');
  mkdirSync(dirOf(id), { recursive: true });
  const local = join(app.getAppPath(), 'dist-ext', e.file);
  if (!app.isPackaged && existsSync(local)) copyFileSync(local, fileOf(id));
  else {
    // o release desta versão; se ele não trouxer o arquivo, o mais recente (o hash garante que é o mesmo arquivo)
    const get = (tag: string[]) => execFileP('gh', ['release', 'download', ...tag, '-R', REPO, '-p', e.file, '-D', dirOf(id), '--clobber'], { windowsHide: true });
    try { await get([`v${app.getVersion()}`]); }
    catch {
      try { await get([]); }
      catch { throw new Error('Não deu para baixar a extensão do GitHub (o gh está logado e com acesso ao repositório?).'); }
    }
  }
  if (!existsSync(fileOf(id)) || sha(fileOf(id)) !== e.sha256) {
    rmSync(fileOf(id), { force: true });
    throw new Error('O arquivo baixado não confere com o esperado; não foi instalado.');
  }
  // versões antigas do arquivo saem (a pasta guarda o resto: sessão, dados)
  for (const f of readdirSync(dirOf(id))) if (f.startsWith(`${id}-`) && f.endsWith('.mjs') && f !== e.file) rmSync(join(dirOf(id), f), { force: true });
  setSetting(`ext:${id}:enabled`, '1');
  stopExtension(id);
  startExtension(id);
  onChange();
}

/** Desabilitar para o processo e não liga mais ao abrir; a pasta (sessão do WhatsApp, modelos) fica para quando voltar. */
export function setExtensionEnabled(id: string, on: boolean): void {
  if (!installed(id)) throw new Error('Extensão não instalada.');
  setSetting(`ext:${id}:enabled`, on ? '1' : '0');
  if (on) startExtension(id); else stopExtension(id);
  onChange();
}

export async function uninstallExtension(id: string): Promise<void> {
  setSetting(`ext:${id}:enabled`, '0');
  stopExtension(id);
  // a pasta leva junto a sessão do WhatsApp e o que mais a extensão guardou
  rmSync(dirOf(id), { recursive: true, force: true });
  onChange();
}

export function startExtension(id: string): void {
  if (procs.has(id) || !installed(id)) return;
  if (sha(fileOf(id)) !== CATALOG[id].sha256) { emit(id, 'log', 'Arquivo da extensão alterado: não vou rodar. Reinstale.'); return; }
  const child = utilityProcess.fork(fileOf(id), [dirOf(id)], { serviceName: `Central · ${CATALOG[id].name}`, stdio: 'pipe' });
  procs.set(id, child);
  child.stderr?.on('data', d => emit(id, 'log', String(d).trim()));
  child.on('message', (m: any) => {
    if (m?.id !== undefined && pending.has(m.id)) {
      const p = pending.get(m.id)!;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result);
    } else if (m?.event) emit(id, m.event, m.data);
  });
  child.on('exit', () => {
    if (procs.get(id) !== child) return;
    procs.delete(id);
    emit(id, 'status', { state: 'disconnected', me: null, code: null, stopped: true });
    onChange();
    // caiu sozinha: volta em 5 s (se continua ligada)
    if (!quitting && getSetting(`ext:${id}:enabled`) === '1') setTimeout(() => { if (!quitting) startExtension(id); }, 5000);
  });
  onChange();
}

export function stopExtension(id: string): void {
  const p = procs.get(id);
  procs.delete(id);
  p?.kill();
}

/** A Central vai fechar: para todas, sem religar. */
export function stopAllExtensions(): void {
  quitting = true;
  for (const id of [...procs.keys()]) stopExtension(id);
}

/** Liga as instaladas quando a Central abre. */
export function startInstalled(): void {
  for (const id of Object.keys(CATALOG)) {
    if (getSetting(`ext:${id}:enabled`) === '0') continue;
    if (installed(id)) startExtension(id);
    // estava instalada numa versão anterior: atualiza sozinha (a sessão do WhatsApp e os dados ficam na pasta)
    else if (getSetting(`ext:${id}:enabled`) === '1') installExtension(id).catch(e => emit(id, 'log', `atualização: ${e.message}`));
  }
}

export function callExtension<T = any>(id: string, call: string, args: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
  const p = procs.get(id);
  if (!p) return Promise.reject(new Error(`A extensão ${CATALOG[id]?.name ?? id} não está ${installed(id) ? 'rodando' : 'instalada'}.`));
  const n = ++seq;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(n); reject(new Error('A extensão não respondeu a tempo.')); }, timeoutMs);
    pending.set(n, { resolve, reject, timer });
    p.postMessage({ id: n, call, args });
  });
}

export function onExtensionEvent(id: string, fn: Listener): void {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id)!.add(fn);
}

function emit(id: string, event: string, data: any): void {
  for (const fn of listeners.get(id) ?? []) { try { fn(event, data); } catch { /* um ouvinte com erro não derruba os outros */ } }
}

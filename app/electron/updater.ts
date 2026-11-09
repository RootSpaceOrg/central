/**
 * Atualização dentro do app. Duas fontes de versão nova:
 * - local: <código da Central>/app/release (o que `npm run dist` gera nesta máquina);
 * - github: releases de RootSpaceOrg/central (público), lidas e baixadas por HTTPS sem login (o gh logado fica de reserva).
 * Instala em silêncio e reabre. Também gera (e publica) uma versão nova a partir do código.
 */
import { app, shell } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { UpdateInfoDto } from '../src/app/shared/contract';
import { getSetting } from './backlog';
import { DEV_ROOT } from './db';
import { childEnv } from './workspace';
import { REPO, downloadAsset, listReleases } from './github';

const execFileP = promisify(execFile);
const INSTALLER = process.platform === 'darwin' ? /^Central-(\d+\.\d+\.\d+)-\w+\.dmg$/ : /^Central Setup (\d+\.\d+\.\d+)\.exe$/;
const REMOTE_TTL = 10 * 60_000;
let building = false;
let remote: { at: number; version: string | null; publishedAt: string | null; error: string | null } | null = null;

/** Pasta do código da Central (onde roda `npm run dist`). Configurável em settings 'update:source'. */
export const sourceDir = () => getSetting('update:source') ?? join(DEV_ROOT, 'Central', 'app');

/** -1, 0 ou 1, comparando "1.2.10" com "1.2.9" numericamente. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0) ? 1 : -1;
  return 0;
}

function localLatest(): { version: string; path: string; builtAt: string } | null {
  const release = join(sourceDir(), 'release');
  let best: { version: string; path: string; builtAt: string } | null = null;
  for (const name of existsSync(release) ? readdirSync(release) : []) {
    const v = name.match(INSTALLER)?.[1];
    if (v && (!best || compareVersions(v, best.version) > 0)) {
      const path = join(release, name);
      best = { version: v, path, builtAt: statSync(path).mtime.toISOString() };
    }
  }
  return best;
}

async function remoteLatest(force: boolean) {
  if (!force && remote && Date.now() - remote.at < REMOTE_TTL) return remote;
  try {
    const tags = (await listReleases())
      .map(r => ({ v: r.tag.replace(/^v/, ''), at: r.publishedAt })).filter(r => /^\d+\.\d+\.\d+$/.test(r.v))
      .sort((a, b) => compareVersions(b.v, a.v));
    remote = { at: Date.now(), version: tags[0]?.v ?? null, publishedAt: tags[0]?.at ?? null, error: null };
  } catch (e) {
    remote = { at: Date.now(), version: null, publishedAt: null, error: 'Não deu para consultar o GitHub (sem internet?).' };
    void e;
  }
  return remote;
}

export async function checkUpdate(force = false): Promise<UpdateInfoDto> {
  const current = app.getVersion();
  const local = localLatest();
  const gh = await remoteLatest(force);
  const localNew = local && compareVersions(local.version, current) > 0 ? local : null;
  const remoteNew = gh.version && compareVersions(gh.version, current) > 0 ? gh.version : null;
  // mesma versão nos dois: prefere o arquivo local (não precisa baixar)
  const useRemote = remoteNew && (!localNew || compareVersions(remoteNew, localNew.version) > 0);
  return {
    current,
    latest: useRemote ? remoteNew : localNew?.version ?? null,
    installer_path: useRemote ? null : localNew?.path ?? null,
    built_at: useRemote ? gh.publishedAt : localNew?.builtAt ?? null,
    source: useRemote ? 'github' : localNew ? 'local' : null,
    github_error: gh.error,
    source_dir: sourceDir(),
    source_exists: existsSync(join(sourceDir(), 'package.json')),
    building,
  };
}

/** Baixa (se vier do GitHub), roda o instalador em silêncio pedindo para reabrir, e fecha este app. */
export async function installUpdate(beforeInstall: () => void = () => {}): Promise<void> {
  const info = await checkUpdate(true);
  if (!info.latest) throw new Error('Nenhuma versão nova encontrada.');
  // Mac: baixa o .dmg da versão e abre (arrastar para Aplicativos, como todo app de Mac)
  if (process.platform === 'darwin') {
    if (info.installer_path) { await shell.openPath(info.installer_path); return; } // gerado aqui (a partir do código)
    const dir = join(app.getPath('temp'), 'central-update', info.latest);
    mkdirSync(dir, { recursive: true });
    const dmg = `Central-${info.latest}-${process.arch}.dmg`;
    const file = await downloadAsset(`v${info.latest}`, n => n === dmg, dir, dmg)
      .catch(() => { throw new Error(`A versão ${info.latest} ainda não tem o pacote para Mac (${dmg}).`); });
    await shell.openPath(file);
    return;
  }
  let installer = info.installer_path;
  if (!installer) {
    const dir = join(app.getPath('temp'), 'central-update', info.latest);
    mkdirSync(dir, { recursive: true });
    // o GitHub guarda o instalador com pontos no lugar dos espaços (Central.Setup.X.exe): acha pela extensão
    installer = await downloadAsset(`v${info.latest}`, n => /\.exe$/i.test(n) && n.includes(info.latest!), dir, '*.exe');
  }
  // antes de o instalador fechar a Central: pausa as execuções (voltam na mesma sessão) e guarda as conversas para retomar
  beforeInstall();
  // --updated: o instalador mantém os atalhos (os ícones fixados na barra de tarefas e no Iniciar não somem)
  spawn(installer, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  setTimeout(() => app.quit(), 300);
}

/** Sobe a versão, roda `npm run dist` e, se pedido, publica a release no GitHub. Log vai para a tela. */
export function buildUpdate(publish: boolean, log: (line: string) => void, done: (ok: boolean, message: string) => void): void {
  if (building) throw new Error('Já existe uma versão sendo gerada.');
  const dir = sourceDir();
  if (!existsSync(join(dir, 'package.json'))) throw new Error(`Código da Central não encontrado em ${dir}.`);
  building = true;
  const forward = (d: Buffer) => d.toString().split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(log);
  const step = (cmd: string, args: string[], next: (code: number | null) => void) => {
    log(`> ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, { cwd: dir, shell: true, windowsHide: true, env: childEnv() });
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('close', next);
  };
  const finish = (ok: boolean, message: string) => { building = false; done(ok, message); };

  // sobe a versão de correção (0.4.1 → 0.4.2) para o instalador novo ser maior que o instalado
  step('npm', ['version', 'patch', '--no-git-tag-version'], code => {
    if (code !== 0) return finish(false, 'Não deu para subir a versão.');
    step('npm', ['run', process.platform === 'darwin' ? 'dist:mac' : 'dist'], async code => {
      const local = localLatest();
      if (code !== 0 || !local) return finish(false, `O build falhou (código ${code}). Veja o log acima.`);
      if (!publish) return finish(true, `Versão ${local.version} pronta para instalar.`);
      step('gh', ['release', 'create', `v${local.version}`, `"${local.path}"`, '-R', REPO, '--title', `"Central ${local.version}"`,
        '--notes', `"Gerada pela Central em ${new Date().toLocaleString('pt-BR')}."`], code => {
        remote = null;
        finish(true, code === 0
          ? `Versão ${local.version} pronta e publicada no GitHub.`
          : `Versão ${local.version} pronta aqui, mas a publicação no GitHub falhou. Veja o log.`);
      });
    });
  });
}

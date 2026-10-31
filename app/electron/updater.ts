/**
 * Atualização dentro do app, sem servidor: os instaladores ficam em <código da Central>/app/release
 * (gerados por `npm run dist`). O app procura uma versão maior que a sua, roda o instalador em modo
 * silencioso e reabre. Também sabe gerar uma versão nova a partir do código.
 */
import { app } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { UpdateInfoDto } from '../src/app/shared/contract';
import { DEV_ROOT } from './db';
import { getSetting } from './backlog';
import { childEnv } from './workspace';

const INSTALLER = /^Central Setup (\d+\.\d+\.\d+)\.exe$/;
let building = false;

/** Pasta do código da Central (onde roda `npm run dist`). Configurável em settings 'update:source'. */
export const sourceDir = () => getSetting('update:source') ?? join(DEV_ROOT, 'Central', 'app');

/** -1, 0 ou 1, comparando "1.2.10" com "1.2.9" numericamente. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0) ? 1 : -1;
  return 0;
}

export function checkUpdate(): UpdateInfoDto {
  const dir = sourceDir();
  const release = join(dir, 'release');
  const current = app.getVersion();
  let latest: string | null = null, installer: string | null = null, builtAt: string | null = null;
  for (const name of existsSync(release) ? readdirSync(release) : []) {
    const v = name.match(INSTALLER)?.[1];
    if (v && compareVersions(v, current) > 0 && (!latest || compareVersions(v, latest) > 0)) {
      latest = v;
      installer = join(release, name);
      builtAt = statSync(installer).mtime.toISOString();
    }
  }
  return { current, latest, installer_path: installer, built_at: builtAt, source_dir: dir, source_exists: existsSync(join(dir, 'package.json')), building };
}

/** Roda o instalador em silêncio, pede para reabrir o app ao fim e fecha este. */
export function installUpdate(): void {
  const { installer_path } = checkUpdate();
  if (!installer_path) throw new Error('Nenhuma versão nova encontrada.');
  spawn(installer_path, ['/S', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  setTimeout(() => app.quit(), 300);
}

/** Sobe a versão e roda `npm run dist` no código da Central, com o log indo para a tela. */
export function buildUpdate(log: (line: string) => void, done: (ok: boolean, message: string) => void): void {
  if (building) throw new Error('Já existe uma versão sendo gerada.');
  const dir = sourceDir();
  if (!existsSync(join(dir, 'package.json'))) throw new Error(`Código da Central não encontrado em ${dir}.`);
  building = true;
  // sobe a versão de correção (0.4.0 → 0.4.1) para o instalador novo ser maior que o instalado
  const child = spawn('npm version patch --no-git-tag-version && npm run dist', { cwd: dir, shell: true, windowsHide: true, env: childEnv() });
  const forward = (d: Buffer) => d.toString().split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(log);
  child.stdout.on('data', forward);
  child.stderr.on('data', forward);
  child.on('close', code => {
    building = false;
    const { latest } = checkUpdate();
    if (code !== 0) done(false, `O build falhou (código ${code}). Veja o log acima.`);
    else if (!latest) done(false, 'Build terminou, mas a versão gerada não é maior que a instalada.');
    else done(true, `Versão ${latest} pronta para instalar.`);
  });
}

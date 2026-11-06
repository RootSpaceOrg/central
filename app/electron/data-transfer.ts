/**
 * Levar a Central para outro computador: exportar tudo num arquivo (cópia consistente do banco) e importar esse arquivo
 * aqui, com os caminhos ajustados para este disco. Importar substitui os dados atuais (o banco de agora vira backup).
 * Também acha as pastas de projeto dentro de Development, para a primeira abertura.
 */
import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { basename, join } from 'node:path';

import { DB_PATH, DEV_ROOT, db, get } from './db';
import { remapPath } from './remap-path';

/** cópia consistente do banco (mesmo com a Central rodando) */
export function exportData(file: string): void {
  if (existsSync(file)) rmSync(file);
  db.prepare('vacuum into ?').run(file);
}

const COUNTS = ['projects', 'tasks', 'ideas', 'agents', 'chats', 'memories', 'routines'] as const;

/** o que tem no arquivo, para você confirmar antes de importar */
export function inspectImport(file: string): Record<string, number> {
  let other: DatabaseSync;
  try { other = new DatabaseSync(file, { readOnly: true }); } catch { throw new Error('Esse arquivo não é um banco da Central.'); }
  try {
    if (!other.prepare(`select 1 from sqlite_master where type = 'table' and name = 'projects'`).get()) throw new Error('Esse arquivo não é um banco da Central.');
    const out: Record<string, number> = {};
    for (const t of COUNTS) {
      try { out[t] = Number((other.prepare(`select count(*) n from ${t}`).get() as { n: number }).n); } catch { out[t] = 0; }
    }
    return out;
  } finally { other.close(); }
}

/** colunas com caminho de pasta (tabela, coluna) */
const PATH_COLUMNS: [string, string][] = [
  ['projects', 'folder'], ['repos', 'path'], ['commits', 'repo_path'], ['tasks', 'repo_path'], ['runs', 'repo_path'],
  ['runs', 'worktree_path'], ['routines', 'repo_path'], ['chats', 'cwd'],
];

/**
 * Prepara a cópia para este computador: caminhos de outro disco viram os daqui. Conversa que mudou de pasta perde a
 * sessão do Claude (o histórico do Claude ficou no outro computador); as mensagens continuam na Central.
 */
export function adaptImport(file: string): number {
  const other = new DatabaseSync(file);
  let changed = 0;
  try {
    other.exec('pragma foreign_keys = off');
    for (const [table, col] of PATH_COLUMNS) {
      let rows: Record<string, string | null>[];
      try { rows = other.prepare(`select rowid id, ${col} v from ${table} where ${col} is not null`).all() as Record<string, string | null>[]; } catch { continue; }
      for (const r of rows) {
        const to = remapPath(r['v'] as string, DEV_ROOT, existsSync);
        if (to === r['v']) continue;
        other.prepare(`update ${table} set ${col} = ? where rowid = ?`).run(to, r['id'] as unknown as number);
        if (table === 'chats') other.prepare('update chats set session_id = null, add_dirs = null where rowid = ?').run(r['id'] as unknown as number);
        changed++;
      }
    }
    const src = other.prepare(`select value from settings where key = 'update:source'`).get() as { value: string } | undefined;
    if (src) other.prepare(`update settings set value = ? where key = 'update:source'`).run(remapPath(src.value, DEV_ROOT, existsSync));
  } finally { other.close(); }
  return changed;
}

/** troca o banco: o atual vira backup ao lado (central.db.antes-AAAA-MM-DD…) */
export function swapDatabase(prepared: string): string {
  const backup = `${DB_PATH}.antes-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  db.close();
  copyFileSync(DB_PATH, backup);
  for (const ext of ['-wal', '-shm']) rmSync(DB_PATH + ext, { force: true });
  copyFileSync(prepared, DB_PATH);
  return backup;
}

/** pastas dentro de Development que parecem projeto (têm repositório git, nelas ou um nível abaixo) e ainda não são */
export function discoverProjects(): { name: string; folder: string; repos: number }[] {
  if (!existsSync(DEV_ROOT)) return [];
  const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
  const out: { name: string; folder: string; repos: number }[] = [];
  for (const name of readdirSync(DEV_ROOT)) {
    const folder = join(DEV_ROOT, name);
    if (name.startsWith('.') || !isDir(folder) || get('select 1 from projects where folder = ?', folder)) continue;
    let repos = existsSync(join(folder, '.git')) ? 1 : 0;
    if (!repos) { try { repos = readdirSync(folder).filter(c => existsSync(join(folder, c, '.git'))).length; } catch { /* sem acesso */ } }
    if (repos) out.push({ name: basename(folder), folder, repos });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

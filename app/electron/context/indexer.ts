/**
 * Indexador (roda num utilityProcess do Electron, fora do processo principal): lê os arquivos versionados dos repositórios
 * de um projeto, extrai definições e referências, resolve as ligações e calcula o rank. Incremental por tamanho/data/hash;
 * fs.watch reindexa o que mudar (com espera de 2 s para juntar várias gravações).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { FSWatcher, readFileSync, statSync, watch } from 'node:fs';
import { basename, dirname, join, posix } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { Def, LANG_BY_EXT, Lang, Ref, extract, extractHtml, initParsers } from './extract';
import { openIndex, words } from './index-db';
import { ppr } from './rank';

interface Repo { name: string; path: string }
type In = { type: 'index'; project: string; repos: Repo[]; force?: boolean } | { type: 'watch'; project: string; repos: Repo[] } | { type: 'unwatch'; project: string };

const port = (process as any).parentPort as { on: (e: 'message', cb: (m: { data: any }) => void) => void; postMessage: (m: unknown) => void };
const send = (m: unknown) => port.postMessage(m);

const MAX = 1024 * 1024;
/** sobe quando a extração ou a resolução mudam: o índice antigo é refeito por inteiro uma vez */
const VERSION = 3;
const SKIP = /(^|\/)(node_modules|dist|build|\.angular|\.terraform|cdk\.out|coverage|__pycache__|\.venv|venv)\//;
// palavras que viram chamada em todo lugar: sem import ou mesmo arquivo, não liga (seria ruído)
const COMMON = new Set(['get', 'set', 'map', 'filter', 'push', 'then', 'catch', 'find', 'some', 'join', 'split', 'replace', 'log', 'error',
  'emit', 'next', 'subscribe', 'pipe', 'update', 'add', 'delete', 'has', 'keys', 'values', 'toString', 'slice', 'trim', 'append', 'format',
  'items', 'len', 'str', 'int', 'print', 'open', 'close', 'read', 'write', 'load', 'save', 'run', 'send', 'call', 'apply', 'bind', 'reduce']);

let db: DatabaseSync;
const queue: In[] = [];
let busy = false;
const watchers = new Map<string, FSWatcher[]>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const reposOf = new Map<string, Repo[]>();

port.on('message', ({ data }) => {
  if (data.type === 'init') { db = openIndex(data.dbPath); return; }
  if (data.type === 'watch') return startWatch(data.project, data.repos);
  if (data.type === 'unwatch') return stopWatch(data.project);
  const queued = queue.find(q => q.type === 'index' && q.project === data.project) as Extract<In, { type: 'index' }> | undefined;
  if (queued) queued.force ||= !!data.force;
  else queue.push(data);
  pump();
});

async function pump(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await initParsers();
    while (queue.length) {
      const job = queue.shift()!;
      if (job.type !== 'index') continue;
      const t0 = Date.now();
      try {
        reposOf.set(job.project, job.repos);
        indexProject(job.project, job.repos, !!job.force);
        const stats = state(job.project, Date.now() - t0, null);
        send({ type: 'done', project: job.project, stats });
      } catch (e) {
        state(job.project, Date.now() - t0, String((e as Error).message ?? e));
        send({ type: 'error', project: job.project, message: String((e as Error).message ?? e) });
      }
    }
  } finally {
    busy = false;
  }
}

function state(project: string, ms: number, error: string | null) {
  const n = (sql: string) => (db.prepare(sql).get(project) as { n: number }).n;
  const s = { files: n('select count(*) n from files where project = ?'), nodes: n('select count(*) n from nodes where project = ?'),
    edges: n('select count(*) n from edges where project = ?') };
  db.prepare(`insert into index_state (project, files, nodes, edges, indexed_at, ms, error, version) values (?,?,?,?,?,?,?,?)
    on conflict(project) do update set files = excluded.files, nodes = excluded.nodes, edges = excluded.edges, indexed_at = excluded.indexed_at,
    ms = excluded.ms, error = excluded.error, version = excluded.version`).run(project, s.files, s.nodes, s.edges, new Date().toISOString(), ms, error, error ? 0 : VERSION);
  return { ...s, ms, error };
}

function gitFiles(repo: string): string[] {
  try {
    return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repo, maxBuffer: 64 * 1024 * 1024, windowsHide: true })
      .toString('utf8').split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

const langOf = (path: string): Lang | 'html' | null => {
  if (/\.min\.js$|\.d\.ts$/.test(path)) return null;
  const ext = path.split('.').pop()!.toLowerCase();
  return ext === 'html' ? 'html' : LANG_BY_EXT[ext] ?? null;
};

function indexProject(project: string, repos: Repo[], force: boolean): void {
  const v = (db.prepare('select version from index_state where project = ?').get(project) as { version: number } | undefined)?.version;
  if (v !== VERSION) {
    // índice de outra versão do indexador: refaz o projeto do zero (mais rápido que reindexar arquivo por arquivo)
    db.prepare('delete from nodes_fts where project = ?').run(project);
    db.prepare('delete from files where project = ?').run(project);
    db.prepare('delete from nodes where project = ?').run(project);
    force = true;
  }
  const wanted: { repo: Repo; path: string; lang: Lang | 'html' }[] = [];
  for (const repo of repos) {
    for (const path of gitFiles(repo.path)) {
      const lang = langOf(path);
      if (lang && !SKIP.test(path)) wanted.push({ repo, path, lang });
    }
  }
  const known = new Map((db.prepare('select id, repo_path, path, size, mtime_ms, hash from files where project = ?').all(project) as any[])
    .map(f => [`${f.repo_path}|${f.path}`, f]));
  const keep = new Set<string>();
  let done = 0;
  const changed: number[] = [];
  db.exec('begin');
  try {
    for (const w of wanted) {
      const abs = join(w.repo.path, w.path);
      const id = `${w.repo.path}|${w.path}`;
      keep.add(id);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.size > MAX) continue;
      const cur = known.get(id);
      if (!force && cur && cur.size === st.size && cur.mtime_ms === Math.floor(st.mtimeMs)) continue;
      const src = readFileSync(abs, 'utf8');
      const hash = createHash('sha1').update(src).digest('hex');
      if (!force && cur && cur.hash === hash) {
        db.prepare('update files set mtime_ms = ?, size = ? where id = ?').run(Math.floor(st.mtimeMs), st.size, cur.id);
        continue;
      }
      changed.push(indexFile(project, w.repo, w.path, w.lang, src, st.size, Math.floor(st.mtimeMs), hash, cur?.id ?? null));
      if (++done % 50 === 0) send({ type: 'progress', project, done, total: wanted.length });
    }
    for (const [id, f] of known) {
      if (keep.has(id)) continue;
      db.prepare('delete from nodes_fts where rowid in (select id from nodes where file_id = ?)').run(f.id);
      db.prepare('delete from nodes where file_id = ?').run(f.id);
      db.prepare('delete from files where id = ?').run(f.id);
      changed.push(-1);
    }
    db.exec('commit');
  } catch (e) {
    db.exec('rollback');
    throw e;
  }
  if (changed.length || force || !known.size) { resolve(project); rank(project); }
}

function indexFile(project: string, repo: Repo, path: string, lang: Lang | 'html', src: string, size: number, mtime: number, hash: string, oldId: number | null): number {
  if (oldId) {
    db.prepare('delete from nodes_fts where rowid in (select id from nodes where file_id = ?)').run(oldId);
    db.prepare('delete from nodes where file_id = ?').run(oldId);
    db.prepare('delete from refs where file_id = ?').run(oldId);
  }
  const fileId = oldId ?? Number(db.prepare('insert into files (project, repo, repo_path, path, lang, size, mtime_ms, hash) values (?,?,?,?,?,?,?,?)')
    .run(project, repo.name, repo.path, path, lang, size, mtime, hash).lastInsertRowid);
  if (oldId) db.prepare('update files set size = ?, mtime_ms = ?, hash = ?, lang = ? where id = ?').run(size, mtime, hash, lang, fileId);

  const fileKey = `${project}/${repo.name}:${path}`;
  const insNode = db.prepare(`insert into nodes (project, key, file_id, kind, name, qualname, signature, doc, line_start, line_end, exported)
    values (?,?,?,?,?,?,?,?,?,?,?) on conflict(key) do update set file_id = excluded.file_id returning id`);
  const fts = db.prepare('insert into nodes_fts (rowid, key, project, words) values (?,?,?,?)');
  const fileNode = (insNode.get(project, fileKey, fileId, 'file', basename(path), path, null, null, 1, null, 0) as { id: number }).id;
  fts.run(fileNode, fileKey, project, words(path));

  let found: { defs: Def[]; refs: Ref[] };
  try {
    found = lang === 'html' ? { defs: [], refs: extractHtml(src) } : extract(path, lang, src);
  } catch {
    found = { defs: [], refs: [] };
  }
  const spans: { id: number; a: number; b: number }[] = [];
  const used = new Set<string>();
  for (const d of found.defs) {
    let key = `${fileKey}#${d.qualname}`;
    if (used.has(key)) key = `${key}@${d.line_start}`;
    used.add(key);
    const id = (insNode.get(project, key, fileId, d.kind, d.name, d.qualname, d.signature, d.doc, d.line_start, d.line_end, d.exported ? 1 : 0) as { id: number }).id;
    spans.push({ id, a: d.line_start, b: d.line_end });
    fts.run(id, key, project, `${words(d.qualname)} ${words(path)} ${d.doc ?? ''}`);
  }
  // cada referência sai do menor símbolo que a contém (ou do arquivo)
  const insRef = db.prepare('insert into refs (file_id, from_node, name, kind, detail, line) values (?,?,?,?,?,?)');
  for (const r of found.refs) {
    const owner = spans.filter(s => s.a <= r.line && r.line <= s.b).sort((x, y) => (x.b - x.a) - (y.b - y.a))[0];
    insRef.run(fileId, owner?.id ?? fileNode, r.name, r.kind, r.detail, r.line);
  }
  return fileId;
}

// ---------- resolução das ligações ----------

interface FileRow { id: number; repo: string; repo_path: string; path: string; lang: string; node: number }
interface DefRow { id: number; name: string; kind: string; file_id: number; doc: string | null; qualname: string }

const TS_EXT = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.js'];
const TEST = /(\.spec\.|\.test\.|(^|\/)tests?\/|(^|\/)test_[^/]*\.py$|_test\.py$)/;
const family = (lang: string) => (lang === 'py' ? 'py' : lang === 'tf' ? 'tf' : 'web');

/**
 * Refaz todas as arestas do projeto a partir das referências (em cascata de confiança: import > mesmo arquivo > mesma pasta
 * > único no repo > único no projeto > até 3 candidatos).
 */
// ponytail: re-resolve o projeto inteiro a cada mudança (segundos em projetos grandes); por nomes afetados se pesar.
function resolve(project: string): void {
  const files = new Map((db.prepare(`select f.id, f.repo, f.repo_path, f.path, f.lang, n.id node from files f join nodes n on n.file_id = f.id and n.kind = 'file'
    where f.project = ?`).all(project) as unknown as FileRow[]).map(f => [f.id, f]));
  const byPath = new Map([...files.values()].map(f => [`${f.repo_path}|${f.path}`, f]));
  const defs = db.prepare(`select id, name, kind, file_id, doc, qualname from nodes where project = ? and kind not in ('file','route')`).all(project) as unknown as DefRow[];
  const byName = new Map<string, DefRow[]>();
  for (const d of defs) byName.set(d.name, [...(byName.get(d.name) ?? []), d]);
  const bySelector = new Map(defs.filter(d => d.kind === 'component' && d.doc?.startsWith('<')).map(d => [d.doc!.slice(1, -1), d]));
  const refs = db.prepare(`select r.file_id, r.from_node, r.name, r.kind, r.detail from refs r join files f on f.id = r.file_id where f.project = ?`).all(project) as any[];

  db.exec('begin');
  try {
    db.prepare('delete from edges where project = ?').run(project);
    db.prepare(`delete from nodes_fts where rowid in (select id from nodes where project = ? and kind = 'route')`).run(project);
    db.prepare(`delete from nodes where project = ? and kind = 'route'`).run(project);
    const edge = db.prepare(`insert into edges (project, src, dst, kind, weight, confidence) values (?,?,?,?,1,?)
      on conflict(src, dst, kind) do update set weight = weight + 1, confidence = max(confidence, excluded.confidence)`);
    const add = (src: number, dst: number, kind: string, conf: number) => { if (src !== dst) edge.run(project, src, dst, kind, conf); };

    // imports: arquivo → arquivo, e o nome importado → arquivo de origem
    const imported = new Map<number, Map<string, FileRow>>();
    for (const r of refs.filter(x => x.kind === 'import')) {
      const f = files.get(r.file_id)!;
      const target = resolveImport(f, r.detail ?? r.name, byPath, files);
      if (!target) continue;
      const isTest = TEST.test(f.path);
      add(f.node, target.node, isTest ? 'tests' : 'imports', 0.95);
      const m = imported.get(f.id) ?? new Map<string, FileRow>();
      m.set(r.name, target);
      imported.set(f.id, m);
    }
    // template .html → componente de mesmo nome
    for (const f of files.values()) {
      if (f.lang !== 'html') continue;
      const ts = byPath.get(`${f.repo_path}|${f.path.replace(/\.html$/, '.ts')}`);
      if (ts) add(ts.node, f.node, 'template', 1);
    }
    const routes = new Map<string, number>();
    const route = (name: string) => {
      let id = routes.get(name);
      if (!id) {
        const key = `${project}/route:${name}`;
        id = Number(db.prepare(`insert into nodes (project, key, file_id, kind, name, qualname) values (?,?,null,'route',?,?)`).run(project, key, name, name).lastInsertRowid);
        db.prepare('insert into nodes_fts (rowid, key, project, words) values (?,?,?,?)').run(id, key, project, `rota ${words(name)}`);
        routes.set(name, id);
      }
      return id;
    };

    for (const r of refs) {
      const f = files.get(r.file_id)!;
      if (r.kind === 'import') continue;
      if (r.kind === 'http') {
        // Angular chama a rota; no Terraform, a rota aponta para o recurso que a declara
        if (f.lang === 'tf') add(route(r.name), r.from_node, 'routes_to', 0.9);
        else add(r.from_node, route(r.name), 'http_calls', 0.85);
        continue;
      }
      if (r.kind === 'selector') {
        const c = bySelector.get(r.name);
        if (c) add(r.from_node, c.id, 'references', 0.9);
        continue;
      }
      if (r.kind === 'handler') {
        // "app.main.handler" → função handler em .../app/main.py
        const mod = (r.detail as string).split('.').slice(0, -1).join('/');
        const cands = (byName.get(r.name) ?? []).filter(d => files.get(d.file_id)?.lang === 'py');
        const best = cands.find(d => files.get(d.file_id)!.path.replace(/\.py$/, '').endsWith(mod)) ?? (cands.length === 1 ? cands[0] : null);
        if (best) add(r.from_node, best.id, 'deploys', cands.length === 1 || mod ? 0.85 : 0.6);
        continue;
      }
      // só liga dentro da mesma família de linguagem; código de produção não "chama" funções de teste
      const fam = family(f.lang);
      const fromTest = TEST.test(f.path);
      const cands = byName.get(r.name)?.filter(d => {
        const x = files.get(d.file_id)!;
        return family(x.lang) === fam && (fromTest || !TEST.test(x.path));
      });
      if (!cands?.length) continue;
      const kind = r.kind === 'call' ? 'calls' : r.kind === 'inject' ? 'injects' : 'references';
      const viaImport = imported.get(f.id)?.get(r.name);
      let picked: DefRow[] = [];
      let conf = 0;
      if (viaImport) { picked = cands.filter(d => d.file_id === viaImport.id); conf = 0.95; }
      if (!picked.length) { picked = cands.filter(d => d.file_id === f.id); conf = 0.9; }
      if (!picked.length && !COMMON.has(r.name) && r.name.length > 2) {
        const dir = dirname(f.path);
        const sameDir = cands.filter(d => { const x = files.get(d.file_id)!; return x.repo_path === f.repo_path && dirname(x.path) === dir; });
        const sameRepo = cands.filter(d => files.get(d.file_id)!.repo_path === f.repo_path);
        if (sameDir.length === 1) { picked = sameDir; conf = 0.85; }
        else if (sameRepo.length === 1) { picked = sameRepo; conf = 0.75; }
        else if (cands.length === 1) { picked = cands; conf = 0.6; }
        else if (cands.length <= 3 && r.kind !== 'call') { picked = cands; conf = 0.3; }
      }
      for (const d of picked) add(r.from_node, d.id, kind, conf);
    }
    db.exec('commit');
  } catch (e) {
    db.exec('rollback');
    throw e;
  }
}

function resolveImport(f: FileRow, source: string, byPath: Map<string, FileRow>, files: Map<number, FileRow>): FileRow | null {
  if (f.lang === 'py') {
    // "app.services.templates" ou ".templates": arquivo do mesmo repo cujo caminho termina no módulo
    const rel = source.replace(/^\.+/, '').replace(/\./g, '/');
    if (!rel) return null;
    for (const x of files.values()) {
      if (x.repo_path === f.repo_path && x.lang === 'py' && (x.path.endsWith(`${rel}.py`) || x.path.endsWith(`${rel}/__init__.py`))) return x;
    }
    return null;
  }
  if (source.startsWith('.')) {
    const base = posix.normalize(posix.join(posix.dirname(f.path), source));
    for (const ext of TS_EXT) {
      const hit = byPath.get(`${f.repo_path}|${base}${ext}`);
      if (hit) return hit;
    }
    return null;
  }
  // aliases (@app/x, src/x): procura pelo final do caminho no mesmo repo; pacotes externos não acham nada
  const tail = source.replace(/^[@~]\/?/, '').replace(/^[^/]+\//, '');
  if (!source.includes('/') || !tail) return null;
  for (const x of files.values()) {
    if (x.repo_path === f.repo_path && /\.(ts|tsx|js)$/.test(x.path) && x.path.replace(/\.(ts|tsx|js)$/, '').replace(/\/index$/, '').endsWith(tail)) return x;
  }
  return null;
}

/** PageRank global por arquivo (arestas somadas por arquivo); cada símbolo recebe a parte do arquivo pelas entradas. */
function rank(project: string): void {
  const fileOf = new Map((db.prepare(`select id, coalesce(file_id, -id) f from nodes where project = ?`).all(project) as any[]).map(n => [n.id, n.f]));
  const ids = [...new Set(fileOf.values())];
  const idx = new Map(ids.map((f, i) => [f, i]));
  const agg = new Map<string, number>();
  const indeg = new Map<number, number>();
  for (const e of db.prepare(`select src, dst, weight, confidence from edges where project = ?`).all(project) as any[]) {
    const a = idx.get(fileOf.get(e.src)), b = idx.get(fileOf.get(e.dst));
    indeg.set(e.dst, (indeg.get(e.dst) ?? 0) + Math.sqrt(e.weight) * e.confidence);
    if (a === undefined || b === undefined || a === b) continue;
    agg.set(`${a}|${b}`, (agg.get(`${a}|${b}`) ?? 0) + Math.sqrt(e.weight) * e.confidence);
  }
  const r = ppr(ids.length || 1, [...agg].map(([k, w]) => { const [a, b] = k.split('|').map(Number); return [a, b, w] as [number, number, number]; }), new Map());
  const upd = db.prepare('update nodes set rank = ? where id = ?');
  db.exec('begin');
  for (const [node, f] of fileOf) upd.run(r[idx.get(f)!] * (1 + (indeg.get(node) ?? 0)), node);
  db.exec('commit');
}

// ---------- acompanhar mudanças ----------

function startWatch(project: string, repos: Repo[]): void {
  stopWatch(project);
  reposOf.set(project, repos);
  const list: FSWatcher[] = [];
  for (const repo of repos) {
    try {
      list.push(watch(repo.path, { recursive: true }, (_e, file) => {
        const p = String(file ?? '').replace(/\\/g, '/');
        if (!p || p.startsWith('.git/') || SKIP.test(p) || !langOf(p)) return;
        clearTimeout(timers.get(project));
        timers.set(project, setTimeout(() => {
          if (!queue.some(q => q.type === 'index' && q.project === project)) queue.push({ type: 'index', project, repos: reposOf.get(project)! });
          pump();
        }, 2000));
      }));
    } catch { /* pasta sumiu: o próximo sync resolve */ }
  }
  watchers.set(project, list);
}

function stopWatch(project: string): void {
  for (const w of watchers.get(project) ?? []) w.close();
  watchers.delete(project);
}

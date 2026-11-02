/**
 * Contexto de código no processo principal: controla o indexador (utilityProcess), responde às consultas dos agentes
 * (MCP) e da tela de grafo, monta o mapa do código com orçamento de tokens e registra o que cada execução tocou.
 */
import { UtilityProcess, app, utilityProcess } from 'electron';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { CodeHitDto, ContextStatusDto, GraphDto, NodeDetailDto } from '../../src/app/shared/contract';
import { all, get, run } from '../db';
import { openIndex, words } from './index-db';
import { listFacts } from './memory';
import { ppr, tokens } from './rank';

let proc: UtilityProcess | null = null;
let idx: DatabaseSync;
const indexing = new Map<string, { done: number; total: number }>();
let notify: (slug: string) => void = () => {};

export const INDEX_PATH = () => join(app.getPath('userData'), 'code-index.sqlite');

const reposOf = (slug: string) => all<{ name: string; path: string }>('select name, path from repos where project_slug = ? order by name', slug)
  .filter(r => existsSync(r.path));

export function startContext(onChange: (slug: string) => void): void {
  notify = onChange;
  idx = openIndex(INDEX_PATH());
  proc = utilityProcess.fork(join(__dirname, 'context', 'indexer.js'), [], { serviceName: 'Central: índice de código' });
  proc.postMessage({ type: 'init', dbPath: INDEX_PATH() });
  proc.on('message', (m: any) => {
    if (m.type === 'progress') indexing.set(m.project, { done: m.done, total: m.total });
    if (m.type === 'done' || m.type === 'error') indexing.delete(m.project);
    notify(m.project);
  });
  proc.on('exit', () => { proc = null; indexing.clear(); });
}

/** Indexa (incremental) e passa a acompanhar mudanças dos repositórios do projeto. */
export function indexProject(slug: string, force = false): void {
  if (!proc) return;
  const repos = reposOf(slug);
  if (!repos.length) return;
  indexing.set(slug, indexing.get(slug) ?? { done: 0, total: 0 });
  proc.postMessage({ type: 'index', project: slug, repos, force });
  proc.postMessage({ type: 'watch', project: slug, repos });
  notify(slug);
}

/** Projetos vivos (não mortos), um de cada vez no indexador. */
export function indexAll(): void {
  for (const p of all<{ slug: string }>(`select slug from projects where status <> 'dead' order by status = 'active' desc, name`)) indexProject(p.slug);
}

export function contextStatus(): ContextStatusDto[] {
  const rows = idx ? (idx.prepare('select * from index_state').all() as any[]) : [];
  const projects = all<{ slug: string }>(`select slug from projects where status <> 'dead'`);
  return projects.map(({ slug }) => {
    const s = rows.find(r => r.project === slug);
    const p = indexing.get(slug);
    return { project: slug, files: s?.files ?? 0, nodes: s?.nodes ?? 0, edges: s?.edges ?? 0, indexed_at: s?.indexed_at ?? null, ms: s?.ms ?? null,
      error: s?.error ?? null, indexing: !!p, done: p?.done ?? 0, total: p?.total ?? 0 };
  });
}

// ---------- achar nós ----------

interface NodeRow { id: number; project: string; key: string; file_id: number | null; kind: string; name: string; qualname: string; signature: string | null;
  doc: string | null; line_start: number | null; line_end: number | null; rank: number }

/** Aceita a chave completa, sem o projeto ("repo:caminho#Simbolo"), ou só o nome. */
export function findNode(key: string, project?: string | null): NodeRow | null {
  const q = idx.prepare('select * from nodes where key = ?');
  return (q.get(key) as unknown as NodeRow)
    ?? (idx.prepare(`select * from nodes where key like ? and (? is null or project = ?) order by rank desc limit 1`).get(`%/${key}`, project ?? null, project ?? null) as unknown as NodeRow)
    ?? (idx.prepare(`select * from nodes where (qualname = ? or name = ?) and (? is null or project = ?) order by rank desc limit 1`)
      .get(key, key, project ?? null, project ?? null) as unknown as NodeRow)
    ?? null;
}

const short = (key: string) => key.replace(/^[^/]+\//, '');
const fileOfKey = (key: string) => key.split('#')[0];

export function searchCode(project: string, query: string, kind = 'any', limit = 15): string {
  const q = words(query).split(' ').filter(w => w.length > 1).map(w => `"${w.replace(/"/g, '')}"*`).join(' ');
  if (!q) return 'Busca vazia.';
  const rows = idx.prepare(`select n.kind, n.key, n.line_start, n.signature from nodes_fts f join nodes n on n.key = f.key
    where nodes_fts match ? and f.project = ? and (? = 'any' or n.kind = ?) order by bm25(nodes_fts) - n.rank * 50 limit ?`)
    .all(q, project, kind, kind, limit) as any[];
  if (!rows.length) return `Nada encontrado para "${query}" no índice do ${project}. Tente outro termo ou Grep.`;
  return rows.map(r => `${r.kind.padEnd(10)} ${short(r.key)}${r.line_start ? `:${r.line_start}` : ''}${r.signature ? `  ${r.signature}` : ''}`).join('\n');
}

/** Para a busca da tela de grafo. */
export function searchHits(project: string, query: string, limit = 30): CodeHitDto[] {
  const q = words(query).split(' ').filter(w => w.length > 1).map(w => `"${w.replace(/"/g, '')}"*`).join(' ');
  if (!q) return [];
  return (idx.prepare(`select n.key, n.kind, n.qualname, n.signature, n.line_start line from nodes_fts f join nodes n on n.key = f.key
    where nodes_fts match ? and f.project = ? order by bm25(nodes_fts) - n.rank * 50 limit ?`).all(q, project, limit) as any[])
    .map(r => ({ ...r, file_key: fileOfKey(r.key) }));
}

function abs(n: NodeRow): string | null {
  if (!n.file_id) return null;
  const f = idx.prepare('select repo_path, path from files where id = ?').get(n.file_id) as { repo_path: string; path: string } | undefined;
  return f ? join(f.repo_path, f.path) : null;
}

export function codeSymbol(key: string, source = true, maxLines = 120, project?: string | null): string {
  const n = findNode(key, project);
  if (!n) return `Não achei "${key}" no índice. Use code_search.`;
  const file = abs(n);
  const head = [`${n.kind} ${short(n.key)}`, file ? `arquivo: ${file}${n.line_start ? `:${n.line_start}-${n.line_end ?? n.line_start}` : ''}` : '', n.doc ? `doc: ${n.doc}` : '',
    n.signature ? `assinatura: ${n.signature}` : ''].filter(Boolean);
  if (source && file && existsSync(file)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const a = (n.line_start ?? 1) - 1;
    const b = Math.min(n.kind === 'file' ? lines.length : n.line_end ?? a + 1, a + maxLines);
    head.push('```', ...lines.slice(a, b).map((l, i) => `${a + i + 1}  ${l}`), '```');
    if (b - a >= maxLines) head.push(`(cortado em ${maxLines} linhas)`);
  }
  return head.join('\n');
}

const EDGE_LABEL: Record<string, string> = {
  imports: 'importa', calls: 'chama', references: 'usa', injects: 'injeta', http_calls: 'chama a rota', routes_to: 'rota declarada em',
  deploys: 'publica', tests: 'testa', template: 'template',
};

function edgesOf(id: number, dir: 'in' | 'out', kinds: string[] | null) {
  const sql = dir === 'out'
    ? `select n.*, e.kind ekind, e.confidence from edges e join nodes n on n.id = e.dst where e.src = ?`
    : `select n.*, e.kind ekind, e.confidence from edges e join nodes n on n.id = e.src where e.dst = ?`;
  // ekind = tipo da ligação; kind = tipo do nó vizinho
  return (idx.prepare(sql).all(id) as any[]).filter(r => !kinds?.length || kinds.includes(r.ekind));
}

/** Quem usa / o que usa (de um símbolo; de um arquivo, junta os símbolos dele). */
export function codeNeighbors(key: string, direction: 'in' | 'out' | 'both' = 'both', depth = 1, kinds: string[] | null = null, limit = 30, project?: string | null): string {
  const n = findNode(key, project);
  if (!n) return `Não achei "${key}" no índice.`;
  const start = n.kind === 'file' ? (idx.prepare('select id from nodes where file_id = ?').all(n.file_id) as { id: number }[]).map(x => x.id) : [n.id];
  const out: string[] = [`${n.kind} ${short(n.key)}`];
  for (const dir of (direction === 'both' ? ['out', 'in'] : [direction]) as ('in' | 'out')[]) {
    const seen = new Set(start);
    let frontier = start;
    const lines: string[] = [];
    for (let d = 1; d <= depth && frontier.length; d++) {
      const next: number[] = [];
      for (const id of frontier) {
        for (const r of edgesOf(id, dir, kinds)) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          next.push(r.id);
          lines.push(`${'  '.repeat(d - 1)}${dir === 'out' ? '→' : '←'} ${EDGE_LABEL[r.ekind] ?? r.ekind}  ${r.kind === 'route' ? r.name : short(r.key)}${r.line_start ? `:${r.line_start}` : ''}${r.confidence < 0.8 ? `  (confiança ${r.confidence})` : ''}`);
        }
      }
      frontier = next;
    }
    out.push(`${dir === 'out' ? 'Usa' : 'Usado por'} (${lines.length}):`, ...lines.slice(0, limit));
    if (lines.length > limit) out.push(`  … mais ${lines.length - limit}`);
  }
  out.push('Arestas com confiança < 0.8 são heurísticas: confirme com Grep se for crítico.');
  return out.join('\n');
}

/** Raio de impacto: o que depende (direta ou indiretamente) dos símbolos/arquivos, e os testes a rodar. */
export function codeImpact(project: string, keys: string[] = [], gitDiff = false, depth = 2): string {
  const starts = new Set<number>();
  for (const k of keys) {
    const n = findNode(k, project);
    if (!n) continue;
    if (n.kind === 'file') for (const x of idx.prepare('select id from nodes where file_id = ?').all(n.file_id) as { id: number }[]) starts.add(x.id);
    else starts.add(n.id);
  }
  if (gitDiff) {
    for (const r of reposOf(project)) {
      let changed: string[] = [];
      try { changed = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: r.path, windowsHide: true }).toString().split('\n').filter(Boolean); } catch { /* sem git */ }
      for (const p of changed) {
        for (const x of idx.prepare(`select n.id from nodes n join files f on f.id = n.file_id where f.repo_path = ? and f.path = ?`).all(r.path, p) as { id: number }[]) starts.add(x.id);
      }
    }
  }
  if (!starts.size) return 'Nada para analisar: passe keys ou use git_diff com mudanças no working tree.';
  const hit = new Map<number, number>();
  let frontier = [...starts];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: number[] = [];
    for (const id of frontier) for (const r of edgesOf(id, 'in', null)) if (!starts.has(r.id) && !hit.has(r.id)) { hit.set(r.id, d); next.push(r.id); }
    frontier = next;
  }
  const rows = [...hit].map(([id, d]) => ({ d, n: idx.prepare('select * from nodes where id = ?').get(id) as unknown as NodeRow }));
  const files = new Map<string, number>();
  for (const { d, n } of rows) { const f = fileOfKey(n.key); if (!files.has(f) || files.get(f)! > d) files.set(f, d); }
  const tests = [...files.keys()].filter(f => /(\.spec\.|\.test\.|test_[^/]*\.py$|_test\.py$)/.test(f));
  return [
    `Afetados (${files.size} arquivos, profundidade ≤ ${depth}):`,
    ...[...files].sort((a, b) => a[1] - b[1]).slice(0, 60).map(([f, d]) => `  ${d}  ${short(f)}`),
    ...rows.filter(r => r.n.kind === 'route').map(r => `  rota ${r.n.name}`),
    tests.length ? `Testes a rodar:\n${tests.map(t => `  ${short(t)}`).join('\n')}` : 'Nenhum teste ligado pelo índice (confira por nome).',
  ].join('\n');
}

// ---------- mapa do código ----------

/**
 * Mapa ranqueado (estilo Aider): os arquivos mais relevantes para o foco, com as assinaturas, até caber no orçamento.
 * Saída determinística (mesma entrada, mesmo texto) para aproveitar o cache de prompt.
 */
export function codeMap(project: string, focus: string[] = [], budget = 2000, repo?: string | null): string {
  if (!idx) return '';
  const files = idx.prepare(`select f.id, f.repo, f.path, n.id node from files f join nodes n on n.file_id = f.id and n.kind = 'file'
    where f.project = ? and (? is null or f.repo = ?) order by f.repo, f.path`).all(project, repo ?? null, repo ?? null) as any[];
  if (!files.length) return '';
  const at = new Map(files.map((f, i) => [f.id, i]));
  const fileOf = new Map((idx.prepare('select id, file_id from nodes where project = ? and file_id is not null').all(project) as any[]).map(n => [n.id, n.file_id]));
  const agg = new Map<string, number>();
  for (const e of idx.prepare('select src, dst, weight, confidence from edges where project = ?').all(project) as any[]) {
    const a = at.get(fileOf.get(e.src)), b = at.get(fileOf.get(e.dst));
    if (a === undefined || b === undefined || a === b) continue;
    agg.set(`${a}|${b}`, (agg.get(`${a}|${b}`) ?? 0) + Math.sqrt(e.weight) * e.confidence);
  }
  // sementes: caminhos e símbolos citados no foco + o que execuções recentes tocaram
  const seeds = new Map<number, number>();
  const bump = (fileId: number | undefined, w: number) => { const i = fileId === undefined ? undefined : at.get(fileId); if (i !== undefined) seeds.set(i, (seeds.get(i) ?? 0) + w); };
  const text = focus.join(' ');
  for (const f of files) if (text && (text.includes(f.path) || text.includes(f.path.split('/').pop()!.replace(/\.\w+$/, '')))) bump(f.id, 1);
  const terms = [...new Set(text.match(/[A-Za-z_][A-Za-z0-9_]{3,}/g) ?? [])].slice(0, 40);
  for (const t of terms) {
    for (const r of idx.prepare(`select n.file_id from nodes_fts f join nodes n on n.key = f.key where nodes_fts match ? and f.project = ? limit 8`)
      .all(`"${words(t).split(' ').join('" "')}"`, project) as any[]) bump(r.file_id, 0.5);
  }
  for (const t of all<{ node_key: string }>(`select node_key from touches where project_slug = ? and at > datetime('now', '-14 days') order by id desc limit 200`, project)) {
    const r = idx.prepare('select file_id from nodes where key = ?').get(t.node_key) as { file_id: number } | undefined;
    bump(r?.file_id, 0.3);
  }
  const r = ppr(files.length, [...agg].map(([k, w]) => { const [a, b] = k.split('|').map(Number); return [a, b, w] as [number, number, number]; }), seeds);
  // o PageRank leva o peso para as dependências das sementes; as próprias sementes vêm primeiro
  const top = Math.max(...r), maxSeed = Math.max(0, ...seeds.values());
  const order = files.map((f, i) => ({ f, s: r[i] + (maxSeed ? (seeds.get(i) ?? 0) / maxSeed * top : 0) }))
    .sort((a, b) => b.s - a.s || a.f.path.localeCompare(b.f.path));

  const defsOf = idx.prepare(`select kind, qualname, signature, line_start from nodes where file_id = ? and kind <> 'file' order by line_start limit 25`);
  const render = (n: number) => order.slice(0, n).map(({ f }) => {
    const defs = defsOf.all(f.id) as any[];
    const sig = (d: any) => { const t = (d.signature ?? d.qualname).replace(/\s*\{.*$/, '').replace(/\s*=>.*$/, ' =>'); return t.length > 110 ? `${t.slice(0, 107)}…` : t; };
    return [`${f.repo}:${f.path}`, ...defs.map(d => `│${d.qualname.includes('.') ? '  ' : ''}${sig(d)}`), defs.length ? '⋮' : '']
      .filter(Boolean).join('\n');
  }).join('\n');
  // busca binária no número de arquivos que cabe no orçamento
  let lo = 1, hi = Math.min(order.length, 400), best = render(1);
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = render(mid);
    if (tokens(s) <= budget) { best = s; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/** Bloco que vai no prompt dos agentes e sessões do projeto: mapa + memória + como usar as ferramentas. */
export function contextBlock(project: string, focus: string[], mapBudget: number): string {
  let map = '';
  try { map = codeMap(project, focus, mapBudget); } catch { /* índice ainda não existe */ }
  const facts = listFacts(project, false).filter(f => f.status === 'active');
  const text = focus.join(' ').toLowerCase();
  const chosen = [...facts.filter(f => f.pinned), ...facts.filter(f => !f.pinned && text && words(f.text).split(' ').some(w => w.length > 4 && text.includes(w)))]
    .slice(0, 12);
  if (!map && !chosen.length) return '';
  const st = idx?.prepare('select files, indexed_at from index_state where project = ?').get(project) as { files: number; indexed_at: string } | undefined;
  return [
    map ? `## Mapa do código (índice da Central, ${st?.files ?? '?'} arquivos, ${st?.indexed_at?.slice(0, 16).replace('T', ' ') ?? ''})\n${map}` : '',
    chosen.length ? `## Memória do projeto\n${chosen.map(f => `- [${f.kind} #${f.id}] ${f.text}${f.links.length ? ` → ${f.links.slice(0, 2).map(short).join(', ')}` : ''}`).join('\n')}` : '',
    'Antes de Grep/Glob amplos, use as ferramentas da Central: code_search, code_symbol, code_neighbors, code_impact e code_map (mais detalhe).\n'
      + 'Registre com memory_remember só fatos duráveis que o código não mostra (decisões, convenções, armadilhas).',
  ].filter(Boolean).join('\n\n');
}

// ---------- tela de grafo ----------

/** Grafo do projeto no nível de arquivo (+ rotas), com as ligações somadas. Os símbolos vêm sob demanda (nodeDetail). */
export function graphData(project: string): GraphDto {
  const files = idx.prepare(`select n.key, n.rank, f.repo, f.path, f.lang, (select count(*) from nodes x where x.file_id = f.id) - 1 defs
    from files f join nodes n on n.file_id = f.id and n.kind = 'file' where f.project = ?`).all(project) as any[];
  const routes = idx.prepare(`select key, name, rank from nodes where project = ? and kind = 'route'`).all(project) as any[];
  const fileKey = new Map((idx.prepare(`select n.id, coalesce(fn.key, n.key) fkey from nodes n left join nodes fn on fn.file_id = n.file_id and fn.kind = 'file'
    where n.project = ?`).all(project) as any[]).map(r => [r.id, r.fkey]));
  const agg = new Map<string, { source: string; target: string; kinds: Set<string>; weight: number }>();
  for (const e of idx.prepare('select src, dst, kind, weight from edges where project = ?').all(project) as any[]) {
    const a = fileKey.get(e.src), b = fileKey.get(e.dst);
    if (!a || !b || a === b) continue;
    const k = `${a}|${b}`;
    const cur = agg.get(k) ?? { source: a, target: b, kinds: new Set<string>(), weight: 0 };
    cur.kinds.add(e.kind);
    cur.weight += e.weight;
    agg.set(k, cur);
  }
  const facts = new Map<string, number>();
  for (const l of all<{ node_key: string }>(`select l.node_key from fact_links l join facts f on f.id = l.fact_id where f.project_slug = ? and f.status = 'active'`, project)) {
    const k = fileOfKey(l.node_key);
    facts.set(k, (facts.get(k) ?? 0) + 1);
  }
  const touched = new Map<string, number>();
  for (const t of all<{ node_key: string; n: number }>(`select node_key, count(*) n from touches where project_slug = ? and at > datetime('now', '-30 days') group by node_key`, project)) {
    const k = fileOfKey(t.node_key);
    touched.set(k, (touched.get(k) ?? 0) + t.n);
  }
  return {
    nodes: [
      ...files.map(f => ({ key: f.key, kind: 'file', label: f.path.split('/').pop(), repo: f.repo, path: f.path, lang: f.lang, rank: f.rank, defs: f.defs,
        facts: facts.get(f.key) ?? 0, touches: touched.get(f.key) ?? 0 })),
      ...routes.map(r => ({ key: r.key, kind: 'route', label: r.name, repo: '', path: r.name, lang: 'route', rank: r.rank, defs: 0, facts: 0, touches: 0 })),
    ],
    edges: [...agg.values()].map(e => ({ source: e.source, target: e.target, kinds: [...e.kinds], weight: e.weight })),
  };
}

export function nodeDetail(key: string): NodeDetailDto | null {
  const n = findNode(key);
  if (!n) return null;
  const file = abs(n);
  const symbols = n.kind === 'file'
    ? (idx.prepare(`select key, kind, qualname, signature, line_start from nodes where file_id = ? and kind <> 'file' order by line_start`).all(n.file_id) as any[])
    : [];
  const ids = n.kind === 'file' ? [n.id, ...symbols.map(s => (idx.prepare('select id from nodes where key = ?').get(s.key) as { id: number }).id)] : [n.id];
  const link = (dir: 'in' | 'out') => {
    const m = new Map<string, { key: string; label: string; kinds: Set<string>; confidence: number }>();
    for (const id of ids) {
      for (const r of edgesOf(id, dir, null)) {
        if (ids.includes(r.id)) continue;
        const k = r.kind === 'route' ? r.key : n.kind === 'file' ? fileOfKey(r.key) : r.key;
        const cur = m.get(k) ?? { key: k, label: r.kind === 'route' ? r.name : short(k), kinds: new Set<string>(), confidence: 0 };
        cur.kinds.add(EDGE_LABEL[r.ekind] ?? r.ekind);
        cur.confidence = Math.max(cur.confidence, r.confidence);
        m.set(k, cur);
      }
    }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label)).map(x => ({ ...x, kinds: [...x.kinds] }));
  };
  let preview: string | null = null;
  if (file && existsSync(file)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const a = (n.line_start ?? 1) - 1;
    preview = lines.slice(a, a + 60).join('\n');
  }
  const project = n.project;
  const keys = n.kind === 'file' ? [n.key, ...symbols.map(s => s.key)] : [n.key, fileOfKey(n.key)];
  return {
    key: n.key, kind: n.kind, name: n.name, qualname: n.qualname, signature: n.signature, doc: n.doc, file, line: n.line_start,
    symbols: symbols.map(s => ({ key: s.key, kind: s.kind, qualname: s.qualname, signature: s.signature, line: s.line_start })),
    outgoing: link('out'), incoming: link('in'), preview,
    facts: listFacts(project, true).filter(f => f.links.some(l => keys.includes(l))),
    touches: all<{ how: string; at: string; run_id: number | null; chat_id: number | null }>(
      `select how, at, run_id, chat_id from touches where node_key in (${keys.map(() => '?').join(',')}) order by id desc limit 20`, ...keys),
  };
}

// ---------- o que os agentes tocaram ----------

/** Liga um arquivo (caminho absoluto) ao nó do índice. */
export function keyForPath(path: string): { project: string; key: string } | null {
  if (!idx || !path) return null;
  const norm = path.replace(/\//g, '\\').toLowerCase();
  for (const f of idx.prepare('select distinct project, repo, repo_path from files').all() as any[]) {
    const rp = String(f.repo_path).replace(/\//g, '\\').toLowerCase();
    if (norm.startsWith(`${rp}\\`)) return { project: f.project, key: `${f.project}/${f.repo}:${relative(f.repo_path, path).replace(/\\/g, '/')}` };
  }
  return null;
}

/** Chamado a cada ferramenta usada por uma execução ou conversa (stream-json). */
export function recordTouch(tool: string, input: any, ref: { runId?: number | null; chatId?: number | null }): void {
  try {
    const how = tool === 'Read' ? 'read' : tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' ? 'edit' : tool.startsWith('mcp__central__code_') ? 'consultou' : null;
    if (!how) return;
    const target = input?.file_path ? keyForPath(String(input.file_path)) : input?.key ? (() => { const n = findNode(String(input.key)); return n ? { project: n.project, key: n.key } : null; })() : null;
    if (!target) return;
    run('insert into touches (project_slug, run_id, chat_id, node_key, how) values (?,?,?,?,?)', target.project, ref.runId ?? null, ref.chatId ?? null, target.key, how);
  } catch { /* telemetria nunca derruba a execução */ }
}

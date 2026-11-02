/** Montagem de um nível do mapa do código (puro, sem Angular nem Cytoscape). Self-check: `node scripts/context.check.mjs`. */
import type { GraphDto, GraphNodeDto } from '../../../../../../shared/contract';

const PALETTE = ['#7FA2FF', '#3FBF8A', '#E0B44C', '#B48CFF', '#4CC9F0', '#F07167', '#62D4A3', '#EBC670', '#9DB8FF', '#F58C84'];
const LANG: Record<string, string> = { ts: '#5B8DEF', tsx: '#5B8DEF', js: '#E0B44C', py: '#3FBF8A', tf: '#B48CFF', html: '#F58C84', route: '#C6A6FF' };
const STACK = new Set(['http_calls', 'routes_to', 'deploys']);

/** Caminho de navegação: [] = raiz do projeto (repositórios); ['repo'] = raiz do repo; ['repo','app','x'] = pasta. */
export type Scope = string[];

/** Onde um nó vive: ['repo', ...pastas] (arquivo) ou ['rotas', primeiro trecho] (rota). */
export function placeOf(n: GraphNodeDto): string[] {
  if (n.kind === 'route') return ['rotas', n.path.split(' ')[1]?.split('/').filter(Boolean)[0] ?? '/'];
  return [n.repo, ...n.path.split('/').slice(0, -1)];
}

export interface ViewNode { id: string; kind: string; label: string; full?: string; size: number; color: string; base: string; facts: number; touches: number; scope?: Scope }
export interface ViewEdge { id: string; source: string; target: string; width: number; color: string }
export interface View { nodes: ViewNode[]; edges: ViewEdge[] }

/** Nó visível de cada arquivo no nível atual: o próprio arquivo (se mora aqui) ou a subpasta/área que o contém. */
function visibleKey(n: GraphNodeDto, scope: Scope): { key: string; dir: Scope | null } {
  const place = placeOf(n);
  const inside = scope.every((s, i) => place[i] === s);
  if (!inside) {
    // fora do nível atual: vira a "área" de primeiro nível diferente (para as ligações que saem daqui aparecerem)
    let i = 0;
    while (i < scope.length && place[i] === scope[i]) i++;
    const dir = place.slice(0, i + 1);
    return { key: `dir:${dir.join('/')}`, dir };
  }
  if (place.length === scope.length) return { key: n.key, dir: null };
  const dir = place.slice(0, scope.length + 1);
  return { key: `dir:${dir.join('/')}`, dir };
}

export function buildView(data: GraphDto, scope: Scope): View {
  const nodes = new Map<string, ViewNode & { files: number; rank: number; outside: boolean }>();
  const where = new Map<string, string>();
  const tops = [...new Set(data.nodes.map(n => placeOf(n)[0]))].sort();
  for (const n of data.nodes) {
    const { key, dir } = visibleKey(n, scope);
    where.set(n.key, key);
    const outside = !!dir && !scope.every((s, i) => dir[i] === s);
    const cur = nodes.get(key);
    if (cur) {
      cur.files++; cur.rank += n.rank; cur.facts += n.facts; cur.touches += n.touches;
      continue;
    }
    const color = dir ? PALETTE[tops.indexOf(dir[0]) % PALETTE.length] : LANG[n.lang] ?? '#8A93A6';
    nodes.set(key, {
      id: key, kind: dir ? 'dir' : n.kind, label: dir ? dir[dir.length - 1] : n.label, size: 0, color, base: color,
      facts: n.facts, touches: n.touches, scope: dir ?? undefined, files: 1, rank: n.rank, outside,
    });
  }
  // fora do nível atual só aparece o que tem ligação com algo daqui
  const edges = new Map<string, ViewEdge & { weight: number; stack: boolean; tests: boolean }>();
  for (const e of data.edges) {
    const a = where.get(e.source), b = where.get(e.target);
    if (!a || !b || a === b) continue;
    const id = `${a}>${b}`;
    const cur = edges.get(id) ?? { id, source: a, target: b, width: 1, color: '#3B4559', weight: 0, stack: false, tests: false };
    cur.weight += e.weight;
    cur.stack ||= e.kinds.some(k => STACK.has(k));
    cur.tests ||= e.kinds.includes('tests');
    edges.set(id, cur);
  }
  const linked = new Set([...edges.values()].flatMap(e => [e.source, e.target]));
  const maxRank = Math.max(1e-9, ...[...nodes.values()].map(n => n.rank));
  const visible = [...nodes.values()].filter(n => !n.outside || linked.has(n.id));
  const ids = new Set(visible.map(n => n.id));
  // "mkt-platform-lambda-x", "mkt-platform-core-y" → "lambda-x", "core-y" (o nome completo fica na trilha e no título)
  const dirs = visible.filter(n => n.kind === 'dir' && !n.outside).map(n => n.label);
  const prefix = commonPrefix(dirs);
  return {
    nodes: visible.map(n => ({
      ...n,
      full: n.label,
      label: n.kind === 'dir' ? `${n.outside ? '↗ ' : ''}${!n.outside && prefix && n.label.startsWith(prefix) ? n.label.slice(prefix.length) : n.label}/  ${n.files}` : n.label,
      size: n.kind === 'dir' ? 34 : 10 + 26 * Math.sqrt(n.rank / maxRank),
      base: n.outside ? '#5D6679' : n.base, color: n.outside ? '#5D6679' : n.color,
    })),
    edges: [...edges.values()].filter(e => ids.has(e.source) && ids.has(e.target)).map(e => ({
      id: e.id, source: e.source, target: e.target, width: Math.min(6, 0.8 + Math.log2(1 + e.weight)),
      color: e.stack ? '#B48CFF' : e.tests ? '#3FBF8A' : '#4A5568',
    })),
  };
}

/** Prefixo que a maioria dos nomes repete ("mkt-platform-" em "mkt-platform-lambda-x"): 2 primeiros trechos, em 3+ e metade dos nomes. */
function commonPrefix(names: string[]): string {
  const count = new Map<string, number>();
  for (const n of names) {
    const m = /^([a-z0-9]+[-_.][a-z0-9]+[-_.])/i.exec(n);
    if (m && n.length > m[1].length) count.set(m[1], (count.get(m[1]) ?? 0) + 1);
  }
  const [best, n] = [...count].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  return n >= 3 && n >= names.length / 2 ? best : '';
}

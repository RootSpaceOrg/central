/**
 * Árvore de divisões da Grade (como tmux / VS Code): cada folha é um painel com uma sessão (ou vazio),
 * cada divisão empilha filhos em linha ('row', lado a lado) ou coluna ('col', um embaixo do outro) com pesos.
 * Funções puras: devolvem uma árvore nova. Self-check: `node scripts/grid-tree.check.mjs`.
 */
export interface GridLeaf { id: string; sessionId: number | null }
export interface GridSplit { id: string; dir: 'row' | 'col'; sizes: number[]; children: GridNode[] }
export type GridNode = GridLeaf | GridSplit;
/** onde soltar um painel arrastado sobre outro: nas bordas divide, no centro troca */
export type DropEdge = 'left' | 'right' | 'top' | 'bottom' | 'center';

let seq = 0;
export const newId = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`;
export const leaf = (sessionId: number | null = null): GridLeaf => ({ id: newId(), sessionId });
export const isSplit = (n: GridNode): n is GridSplit => 'children' in n;

export function leaves(n: GridNode): GridLeaf[] {
  return isSplit(n) ? n.children.flatMap(leaves) : [n];
}

/** Troca um nó (por id) pelo resultado de fn; fn devolvendo null remove o nó. */
function edit(n: GridNode, id: string, fn: (n: GridNode) => GridNode | null): GridNode | null {
  if (n.id === id) return fn(n);
  if (!isSplit(n)) return n;
  const kids: GridNode[] = [];
  const sizes: number[] = [];
  n.children.forEach((c, i) => {
    const r = edit(c, id, fn);
    if (r) { kids.push(r); sizes.push(n.sizes[i]); }
  });
  if (!kids.length) return null;
  if (kids.length === 1) return kids[0];
  return { ...n, children: kids, sizes };
}

/** Junta divisões aninhadas na mesma direção (row dentro de row vira uma row só). */
function flatten(n: GridNode): GridNode {
  if (!isSplit(n)) return n;
  const kids: GridNode[] = [];
  const sizes: number[] = [];
  n.children.map(flatten).forEach((c, i) => {
    if (isSplit(c) && c.dir === n.dir) {
      const total = c.sizes.reduce((a, b) => a + b, 0);
      c.children.forEach((cc, j) => { kids.push(cc); sizes.push(n.sizes[i] * c.sizes[j] / total); });
    } else { kids.push(c); sizes.push(n.sizes[i]); }
  });
  return { ...n, children: kids, sizes };
}

/** Divide o painel: o novo vai à direita/abaixo (ou antes, com before). */
export function split(root: GridNode, leafId: string, dir: 'row' | 'col', added: GridLeaf = leaf(), before = false): GridNode {
  return flatten(edit(root, leafId, n => ({
    id: newId(), dir, sizes: [1, 1], children: before ? [added, n] : [n, added],
  }))!);
}

/** Tira o painel. A árvore nunca fica vazia: sobra um painel vazio. */
export function remove(root: GridNode, leafId: string): GridNode {
  return edit(root, leafId, () => null) ?? leaf();
}

export function assign(root: GridNode, leafId: string, sessionId: number | null): GridNode {
  return edit(root, leafId, n => ({ ...n, sessionId }))!;
}

export function resize(root: GridNode, splitId: string, sizes: number[]): GridNode {
  return edit(root, splitId, n => ({ ...n, sizes }))!;
}

/** Arrasta o painel `from` para cima de `to`: no centro troca as sessões; nas bordas tira e encaixa ao lado. */
export function move(root: GridNode, fromId: string, toId: string, edge: DropEdge): GridNode {
  if (fromId === toId) return root;
  const all = leaves(root);
  const from = all.find(l => l.id === fromId);
  const to = all.find(l => l.id === toId);
  if (!from || !to) return root;
  if (edge === 'center') return assign(assign(root, fromId, to.sessionId), toId, from.sessionId);
  const dir = edge === 'left' || edge === 'right' ? 'row' : 'col';
  return split(remove(root, fromId), toId, dir, leaf(from.sessionId), edge === 'left' || edge === 'top');
}

/** Sessões que sumiram do banco viram painel vazio. */
export function prune(root: GridNode, exists: (id: number) => boolean): GridNode {
  return leaves(root).filter(l => l.sessionId !== null && !exists(l.sessionId)).reduce((r, l) => assign(r, l.id, null), root);
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Retângulo de cada painel em frações da área (0..1): para o minimapa e para achar o maior painel. */
export function rects(n: GridNode, r: Rect = { x: 0, y: 0, w: 1, h: 1 }, out = new Map<string, Rect>()): Map<string, Rect> {
  if (!isSplit(n)) return out.set(n.id, r);
  const total = n.sizes.reduce((a, b) => a + b, 0);
  let at = 0;
  n.children.forEach((c, i) => {
    const f = n.sizes[i] / total;
    rects(c, n.dir === 'row' ? { x: r.x + at * r.w, y: r.y, w: f * r.w, h: r.h } : { x: r.x, y: r.y + at * r.h, w: r.w, h: f * r.h }, out);
    at += f;
  });
  return out;
}

/**
 * Põe várias sessões na grade: primeiro nos painéis vazios, depois dividindo o maior painel pelo lado mais comprido
 * (aspect = largura/altura da área, para "mais comprido" ser o que a tela mostra).
 */
export function addSessions(root: GridNode, ids: number[], aspect = 16 / 9): GridNode {
  for (const id of ids) {
    const empty = leaves(root).find(l => l.sessionId === null);
    if (empty) { root = assign(root, empty.id, id); continue; }
    const all = rects(root);
    // empate: o último painel (a ordem de leitura fica a ordem em que você escolheu)
    const [bigId, big] = [...all].reduce((m, x) => (x[1].w * x[1].h >= m[1].w * m[1].h - 1e-9 ? x : m));
    root = split(root, bigId, big.w * aspect >= big.h ? 'row' : 'col', leaf(id));
  }
  return root;
}

/** Modelos para começar uma grade nova. */
export const TEMPLATES: { id: string; label: string; make: () => GridNode }[] = [
  { id: 'one', label: 'Um painel', make: () => leaf() },
  { id: 'two', label: 'Duas colunas', make: () => ({ id: newId(), dir: 'row', sizes: [1, 1], children: [leaf(), leaf()] }) },
  { id: 'main', label: 'Principal + 2', make: () => ({ id: newId(), dir: 'row', sizes: [3, 2], children: [
    leaf(), { id: newId(), dir: 'col', sizes: [1, 1], children: [leaf(), leaf()] }] }) },
  { id: 'four', label: '2 × 2', make: () => ({ id: newId(), dir: 'col', sizes: [1, 1], children: [
    { id: newId(), dir: 'row', sizes: [1, 1], children: [leaf(), leaf()] },
    { id: newId(), dir: 'row', sizes: [1, 1], children: [leaf(), leaf()] }] }) },
  { id: 'three', label: 'Três colunas', make: () => ({ id: newId(), dir: 'row', sizes: [1, 1, 1], children: [leaf(), leaf(), leaf()] }) },
];

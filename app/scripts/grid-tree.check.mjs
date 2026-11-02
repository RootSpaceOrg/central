// Self-check da árvore da Grade: `node scripts/grid-tree.check.mjs`
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'grid-'));
const out = join(dir, 'grid-tree.mjs');
await build({ entryPoints: [new URL('../src/app/modules/grid/services/grids/grid-tree.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')], outfile: out, format: 'esm', logLevel: 'error' });
const g = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const ids = n => g.leaves(n).map(l => l.sessionId);

let root = g.leaf(1);
const a = root.id;
root = g.split(root, a, 'row', g.leaf(2));
eq(ids(root), [1, 2], 'divide à direita');
const b = g.leaves(root)[1].id;
root = g.split(root, b, 'row', g.leaf(3));
eq(root.children.length, 3, 'row dentro de row vira uma row só');
eq(root.sizes, [1, 0.5, 0.5], 'metade do espaço para o novo');
root = g.split(root, b, 'col', g.leaf(4));
eq(ids(root), [1, 2, 4, 3], 'divide para baixo');

root = g.move(root, a, g.leaves(root).find(l => l.sessionId === 3).id, 'center');
eq(ids(root), [3, 2, 4, 1], 'centro troca');
const one = g.leaves(root).find(l => l.sessionId === 1).id;
root = g.move(root, one, g.leaves(root).find(l => l.sessionId === 3).id, 'left');
eq(ids(root), [1, 3, 2, 4], 'borda esquerda encaixa antes');

for (const l of g.leaves(root)) root = g.remove(root, l.id);
eq(ids(root), [null], 'nunca fica vazia');

root = g.prune(g.TEMPLATES[1].make(), () => false);
eq(ids(root), [null, null], 'modelo de duas colunas');
eq(ids(g.prune({ id: 'x', dir: 'row', sizes: [1, 1], children: [g.leaf(7), g.leaf(8)] }, id => id === 8)), [null, 8], 'sessão apagada vira vazio');
// encaixe automático: vazio primeiro, depois o maior painel pelo lado comprido
let auto = g.addSessions(g.leaf(), [1, 2, 3], 2);
eq(ids(auto), [1, 2, 3], 'três sessões');
eq(auto.dir, 'row', 'tela larga divide lado a lado primeiro');
const r = g.rects(auto);
eq(Math.round([...r.values()].reduce((a, x) => a + x.w * x.h, 0) * 1000), 1000, 'retângulos cobrem a área');
eq(ids(g.addSessions(g.TEMPLATES[1].make(), [5], 2)), [5, null], 'ocupa o painel vazio');
console.log('ok');

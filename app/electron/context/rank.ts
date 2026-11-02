/** Ranking do grafo de código: PageRank (personalizado pelas sementes da tarefa) e o mapa com orçamento de tokens. */

/**
 * PageRank personalizado por iteração de potência. edges: [origem, destino, peso]; seeds: nó → peso.
 * Sem sementes vira o PageRank comum.
 */
// ponytail: power iteration O(iters·E) em memória; ok até ~1M arestas. Para mais, CSR em Float64Array.
export function ppr(n: number, edges: [number, number, number][], seeds: Map<number, number>, alpha = 0.85, iters = 50): Float64Array {
  const out = new Float64Array(n);
  for (const [s, , w] of edges) out[s] += w;
  const p = new Float64Array(n);
  const sum = [...seeds.values()].reduce((a, b) => a + b, 0);
  if (sum > 0) for (const [k, v] of seeds) p[k] = v / sum;
  else p.fill(1 / n);
  let r = Float64Array.from(p);
  for (let it = 0; it < iters; it++) {
    const next = new Float64Array(n);
    let dangling = 0, diff = 0;
    for (let i = 0; i < n; i++) if (out[i] === 0) dangling += r[i];
    for (const [s, d, w] of edges) next[d] += alpha * r[s] * w / out[s];
    for (let i = 0; i < n; i++) { next[i] += (1 - alpha + alpha * dangling) * p[i]; diff += Math.abs(next[i] - r[i]); }
    r = next;
    if (diff < 1e-8) break;
  }
  return r;
}

/** Tokens estimados de um texto de código (sem tokenizer: ~3,5 caracteres por token). */
export const tokens = (s: string) => Math.ceil(s.length / 3.5);

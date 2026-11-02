import { Component, ElementRef, OnDestroy, effect, input, output, untracked, viewChild } from '@angular/core';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import Sigma from 'sigma';

import { GraphDto } from '../../../../../../shared/contract';

export type ColorBy = 'repo' | 'community';
export type Layer = 'code' | 'memory' | 'agent';

const PALETTE = ['#7FA2FF', '#3FBF8A', '#E0B44C', '#B48CFF', '#4CC9F0', '#F07167', '#62D4A3', '#EBC670', '#9DB8FF', '#F58C84'];
const STACK = new Set(['http_calls', 'routes_to', 'deploys']);
const GROUP_MAX = 120;
/** "app/apps/kultivai/src/app/shared" → "…/app/shared/" (o caminho completo fica no painel) */
const shortDir = (path: string, repo: string) => {
  const parts = path.split('/').filter(Boolean);
  return !parts.length ? `${repo}/` : parts.length <= 2 ? `${parts.join('/')}/` : `…/${parts.slice(-2).join('/')}/`;
};

/** Posição inicial determinística (o mesmo projeto abre com o mesmo desenho). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/**
 * Grafo do código (sigma.js, WebGL). Nível de detalhe: com profundidade > 0 os arquivos se juntam por pasta.
 * Camadas: código (cor por repositório ou comunidade), memória (fatos) e agentes (o que tocaram).
 */
@Component({
  selector: 'app-graph-canvas',
  // quem usa posiciona (absolute inset-0); o div interno se apoia nele
  host: { class: 'block' },
  template: `<div #box class="absolute inset-0"></div>`,
})
export class GraphCanvas implements OnDestroy {
  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  readonly data = input.required<GraphDto>();
  /** 0 = arquivos; 1+ = pastas até essa profundidade */
  readonly depth = input(0);
  readonly colorBy = input<ColorBy>('repo');
  readonly layer = input<Layer>('code');
  readonly selected = input<string | null>(null);
  readonly picked = output<string | null>();

  private sigma: Sigma | null = null;
  private graph: Graph | null = null;
  private focus = new Set<string>();
  /** grupo (pasta) → arquivos dentro, para a tela listar */
  readonly members = new Map<string, string[]>();

  /** o sigma precisa de uma área com tamanho: monta quando a aba aparece e acompanha o redimensionamento */
  private readonly observer = new ResizeObserver(([e]) => {
    if (!e.contentRect.height) return;
    if (!this.sigma && this.graph) this.render(), this.highlight(this.selected());
    else { this.sigma?.resize(); this.sigma?.refresh(); }
  });

  constructor() {
    effect(() => this.observer.observe(this.box().nativeElement));
    effect(() => {
      const data = this.data(), depth = this.depth(), colorBy = this.colorBy();
      untracked(() => this.build(data, depth, colorBy));
    });
    effect(() => {
      const sel = this.selected();
      this.layer();
      untracked(() => this.highlight(sel));
    });
  }

  /** quantos arquivos há sob cada pasta (para o agrupamento adaptativo) */
  private counts = new Map<string, number>();

  /**
   * Grupo de um nó no nível de detalhe atual. Pastas adaptativas: começa na profundidade escolhida e desce enquanto a pasta
   * tiver mais de GROUP_MAX arquivos (um monorepo não vira um borrão só). Rotas se juntam pelo primeiro trecho do caminho.
   */
  groupOf(key: string, depth = this.depth()): string {
    if (!depth) return key;
    const rest = key.slice(key.indexOf('/') + 1);
    if (rest.startsWith('route:')) {
      const seg = rest.split(' ')[1]?.split('/').filter(Boolean)[0] ?? '';
      return `dir:rotas:/${seg}`;
    }
    const [repo, path] = rest.split(/:(.+)/);
    const dirs = path.split('/').slice(0, -1);
    for (let k = Math.min(depth, dirs.length); k <= dirs.length; k++) {
      const prefix = `dir:${repo}:${dirs.slice(0, k).join('/')}`;
      if ((this.counts.get(prefix) ?? 0) <= GROUP_MAX || k === dirs.length) return prefix;
    }
    return `dir:${repo}:${dirs.join('/')}`;
  }

  private build(data: GraphDto, depth: number, colorBy: ColorBy): void {
    const g = new Graph({ type: 'directed', allowSelfLoops: false });
    this.members.clear();
    this.counts.clear();
    for (const n of data.nodes) {
      if (n.kind !== 'file') continue;
      const dirs = n.path.split('/').slice(0, -1);
      for (let k = 0; k <= dirs.length; k++) {
        const prefix = `dir:${n.repo}:${dirs.slice(0, k).join('/')}`;
        this.counts.set(prefix, (this.counts.get(prefix) ?? 0) + 1);
      }
    }
    const repos = [...new Set(data.nodes.map(n => n.repo).filter(Boolean))].sort();
    const color = (repo: string) => (repo ? PALETTE[repos.indexOf(repo) % PALETTE.length] : '#C6A6FF');
    const maxRank = Math.max(1e-9, ...data.nodes.map(n => n.rank));
    for (const n of data.nodes) {
      const k = this.groupOf(n.key, depth);
      this.members.set(k, [...(this.members.get(k) ?? []), n.key]);
      const r = Math.sqrt(n.rank / maxRank);
      if (!g.hasNode(k)) {
        const isGroup = k !== n.key;
        const ri = repos.indexOf(n.repo);
        // repositórios em volta de um círculo; dentro, posição pelo hash
        const a = (ri / Math.max(1, repos.length)) * Math.PI * 2;
        g.addNode(k, {
          label: isGroup ? (k.startsWith('dir:rotas:') ? `rotas ${k.slice('dir:rotas:'.length) || '/'}` : shortDir(k.split(':').slice(2).join(':'), n.repo)) : n.label,
          x: Math.cos(a) * 10 + (hash(k) - 0.5) * 8, y: Math.sin(a) * 10 + (hash(`${k}y`) - 0.5) * 8,
          size: 0, rank: 0, color: n.kind === 'route' ? '#C6A6FF' : color(n.repo), repo: n.repo, kind: isGroup ? 'dir' : n.kind,
          facts: 0, touches: 0, files: 0, path: isGroup ? k : n.path, key: k,
        });
      }
      g.updateNodeAttributes(k, a => ({ ...a, rank: a['rank'] + r, facts: a['facts'] + n.facts, touches: a['touches'] + n.touches, files: a['files'] + 1 }));
    }
    g.forEachNode((k, a) => {
      g.setNodeAttribute(k, 'size', a['kind'] === 'route' ? 5 : 2.5 + Math.min(18, (a['kind'] === 'dir' ? 3 : 10) * Math.sqrt(a['rank'] + 0.02) + (a['kind'] === 'dir' ? Math.log2(1 + a['files']) * 2 : 0)));
      if (a['kind'] === 'dir') g.setNodeAttribute(k, 'label', `${a['label']} (${a['files']})`);
      if (k.startsWith('dir:rotas:')) g.setNodeAttribute(k, 'color', '#C6A6FF');
    });
    for (const e of data.edges) {
      const s = this.groupOf(e.source, depth), t = this.groupOf(e.target, depth);
      if (s === t || !g.hasNode(s) || !g.hasNode(t)) continue;
      const stack = e.kinds.some(x => STACK.has(x));
      const tests = e.kinds.includes('tests');
      if (g.hasEdge(s, t)) g.updateEdgeAttribute(s, t, 'weight', w => (w ?? 0) + e.weight);
      else g.addEdge(s, t, { weight: e.weight, kind: stack ? 'stack' : tests ? 'tests' : 'code', src: s, dst: t });
    }
    if (colorBy === 'community' && g.order > 1 && g.size > 0) {
      const comm = louvain(g, { getEdgeWeight: 'weight' });
      g.forEachNode((k, a) => { if (a['kind'] !== 'route') g.setNodeAttribute(k, 'color', PALETTE[comm[k] % PALETTE.length]); });
    }
    if (g.order > 1) {
      forceAtlas2.assign(g, {
        iterations: g.order > 1500 ? 80 : 160,
        settings: { ...forceAtlas2.inferSettings(g), barnesHutOptimize: g.order > 400, gravity: 0.6, scalingRatio: 6, edgeWeightInfluence: 0.5 },
        getEdgeWeight: 'weight',
      });
    }
    this.graph = g;
    if (!this.box().nativeElement.clientHeight) { this.sigma?.kill(); this.sigma = null; return; }
    this.render();
    this.highlight(this.selected());
  }

  private render(): void {
    this.sigma?.kill();
    const g = this.graph!;
    const off = (k: string) => this.focus.size > 0 && !this.focus.has(k);
    this.sigma = new Sigma(g, this.box().nativeElement, {
      settings: { labelRenderedSizeThreshold: 7, labelDensity: 0.8, hideEdgesOnMove: g.size > 4000, stagePadding: 40, allowInvalidContainer: true },
      styles: {
        nodes: {
          size: { attribute: 'size' },
          label: { attribute: 'label' },
          color: ((a: any, st: any) => {
            if (st?.isHovered) return '#FFFFFF';
            if (off(a.key)) return '#232A36';
            const layer = this.layer();
            if (layer === 'memory') return a.facts ? '#E0B44C' : '#2A3242';
            if (layer === 'agent') return a.touches ? (a.touches > 5 ? '#F07167' : a.touches > 1 ? '#F58C84' : '#EBC670') : '#2A3242';
            return a.color;
          }) as never,
          labelColor: ((a: any) => (off(a.key) ? '#4A5366' : '#E6E9EF')) as never,
          labelVisibility: ((a: any, st: any) => (st?.isHovered || (this.focus.size && this.focus.has(a.key)) ? 'visible' : 'auto')) as never,
        },
        edges: {
          size: ((a: any) => Math.min(4, 0.6 + Math.log2(1 + (a.weight ?? 1)) * 0.5)) as never,
          color: ((a: any) => {
            if (this.focus.size && !(this.selectedKey === a.src || this.selectedKey === a.dst)) return '#1E2430';
            return a.kind === 'stack' ? '#B48CFF' : a.kind === 'tests' ? '#3FBF8A' : this.focus.size ? '#7FA2FF' : '#3B4559';
          }) as never,
          head: 'arrow',
        },
      },
    } as never);
    this.sigma.on('clickNode', ({ node }: { node: string }) => this.picked.emit(node));
    this.sigma.on('clickStage', () => this.picked.emit(null));
  }

  private selectedKey: string | null = null;

  /** Seleção: o nó e os vizinhos acesos, o resto apagado; a câmera vai até ele. */
  private highlight(sel: string | null): void {
    const g = this.graph, s = this.sigma;
    if (!g || !s) return;
    const k = sel ? (g.hasNode(sel) ? sel : g.hasNode(this.groupOf(sel)) ? this.groupOf(sel) : null) : null;
    this.selectedKey = k;
    this.focus = k ? new Set([k, ...g.neighbors(k)]) : new Set();
    s.refresh();
    if (k) {
      const d = s.getNodeDisplayData(k);
      if (d) s.getCamera().animate({ x: d.x, y: d.y, ratio: Math.min(s.getCamera().ratio, 0.6) }, { duration: 450 });
    }
  }

  zoom(f: number): void { const c = this.sigma?.getCamera(); if (c) c.animate({ ratio: c.ratio / f }, { duration: 250 }); }
  reset(): void { this.sigma?.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }, { duration: 350 }); }

  ngOnDestroy(): void { this.observer.disconnect(); this.sigma?.kill(); }
}

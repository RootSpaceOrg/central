import { Component, ElementRef, OnDestroy, computed, effect, input, output, untracked, viewChild } from '@angular/core';
import cytoscape, { Core, ElementDefinition } from 'cytoscape';
import fcose from 'cytoscape-fcose';

import { GraphDto } from '../../../../../../shared/contract';
import { Scope, View, buildView } from './code-view';

export { placeOf } from './code-view';
export type { Scope } from './code-view';

cytoscape.use(fcose);

export type Layer = 'code' | 'memory' | 'agent';


/**
 * Mapa do código (Cytoscape): navegação por pastas. Cada nível mostra só o conteúdo de uma pasta: subpastas como caixas
 * (com quantos arquivos têm) e arquivos como nós; as ligações entre eles são as do código somadas. Clicar numa pasta entra
 * nela; clicar num arquivo acende o que ele usa e o que usa ele.
 */
@Component({
  selector: 'app-code-map',
  // quem usa posiciona (absolute inset-0); o div interno se apoia nele
  host: { class: 'block' },
  template: `<div #box class="h-full w-full"></div>`,
})
export class CodeMap implements OnDestroy {
  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  readonly data = input.required<GraphDto>();
  readonly scope = input<Scope>([]);
  readonly layer = input<Layer>('code');
  readonly selected = input<string | null>(null);
  /** arquivo/rota clicado (ou null) */
  readonly picked = output<string | null>();
  /** pasta clicada: entrar nela */
  readonly enter = output<Scope>();

  private cy: Core | null = null;
  /** o layout precisa da área com tamanho: monta quando a aba aparece e reenquadra quando ela muda */
  private pending: View | null = null;
  private readonly observer = new ResizeObserver(() => {
    if (!this.box().nativeElement.clientHeight) return;
    if (this.pending) { const v = this.pending; this.pending = null; this.render(v); return; }
    this.cy?.resize();
  });

  /** visível no nível atual: chave (arquivo/rota ou "dir:..."), com o que entra em cada caixa */
  private readonly view = computed(() => buildView(this.data(), this.scope()));

  constructor() {
    effect(() => this.observer.observe(this.box().nativeElement));
    effect(() => { const v = this.view(); untracked(() => this.render(v)); });
    effect(() => { const sel = this.selected(); this.layer(); untracked(() => this.paint(sel)); });
  }

  private render(v: View): void {
    this.cy?.destroy();
    this.cy = null;
    const el = this.box().nativeElement;
    if (!el.clientHeight) { this.pending = v; return; }
    const elements: ElementDefinition[] = [
      ...v.nodes.map(n => ({ data: n })),
      ...v.edges.map(e => ({ data: e })),
    ];
    this.cy = cytoscape({
      container: el,
      elements,
      minZoom: 0.15,
      maxZoom: 3,
      wheelSensitivity: 0.25,
      style: [
        { selector: 'node', style: {
          'background-color': 'data(color)', 'label': 'data(label)', 'color': '#E6E9EF', 'font-family': 'Inter Variable, system-ui, sans-serif',
          'font-size': 11, 'text-valign': 'bottom', 'text-margin-y': 5, 'width': 'data(size)', 'height': 'data(size)',
          'text-outline-color': '#0f131a', 'text-outline-width': 2, 'min-zoomed-font-size': 7, 'transition-property': 'opacity, background-color', 'transition-duration': 200,
        } },
        { selector: 'node[kind = "dir"]', style: {
          'shape': 'round-rectangle', 'width': 'label', 'height': 34, 'padding': '12px', 'text-valign': 'center', 'text-margin-y': 0, 'font-size': 12.5,
          'font-weight': 600, 'background-opacity': 0.22, 'border-width': 1.5, 'border-color': 'data(color)', 'color': '#F2F4F8', 'text-outline-width': 0,
          'min-zoomed-font-size': 3,
        } },
        { selector: 'node[kind = "route"]', style: { 'shape': 'diamond' } },
        { selector: 'node[?facts]', style: { 'border-width': 2, 'border-color': '#E0B44C' } },
        { selector: 'edge', style: {
          'width': 'data(width)', 'line-color': 'data(color)', 'target-arrow-color': 'data(color)', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.7,
          'curve-style': 'bezier', 'opacity': 0.55, 'transition-property': 'opacity', 'transition-duration': 200,
        } },
        { selector: '.faded', style: { 'opacity': 0.12 } },
        { selector: 'edge.lit', style: { 'opacity': 0.95, 'line-color': '#9DB8FF', 'target-arrow-color': '#9DB8FF' } },
        { selector: 'node.focus', style: { 'border-width': 3, 'border-color': '#FFFFFF' } },
      ],
      // só pastas (raiz, níveis de organização): grade por tamanho, lê como um painel. Com arquivos: força, rótulo conta no tamanho
      layout: (v.nodes.every(n => n.kind === 'dir')
        // colunas pela proporção da área (cartão ~4x mais largo que alto): menos colunas, rótulos legíveis
        ? { name: 'grid', avoidOverlap: true, avoidOverlapPadding: 10, padding: 56, cols: Math.max(1, Math.min(v.nodes.length,
            Math.round(Math.sqrt(v.nodes.length * (el.clientWidth / el.clientHeight) / 4)))), sort: (a: any, b: any) => b.data('files') - a.data('files') }
        : { name: 'fcose', animate: false, randomize: true, quality: 'proof', nodeDimensionsIncludeLabels: true, nodeRepulsion: () => 40000,
            idealEdgeLength: () => 170, nodeSeparation: 120, packComponents: true, tile: true, tilingPaddingVertical: 24, tilingPaddingHorizontal: 24,
            padding: 40 }) as never,
    });
    this.cy.on('tap', 'node', e => {
      const d = e.target.data();
      if (d.kind === 'dir') this.enter.emit(d.scope);
      else this.picked.emit(d.id);
    });
    this.cy.on('tap', e => { if (e.target === this.cy) this.picked.emit(null); });
    this.paint(this.selected());
  }

  /** Camada (cor) e foco: o selecionado e os vizinhos acesos, o resto esmaecido. */
  private paint(sel: string | null): void {
    const cy = this.cy;
    if (!cy) return;
    const layer = this.layer();
    cy.batch(() => {
      cy.nodes().forEach(n => {
        const d = n.data();
        n.data('color', layer === 'memory' ? (d.facts ? '#E0B44C' : '#2A3242')
          : layer === 'agent' ? (d.touches ? (d.touches > 5 ? '#F07167' : d.touches > 1 ? '#F58C84' : '#EBC670') : '#2A3242')
          : d.base);
      });
      cy.elements().removeClass('faded lit focus');
      const node = sel ? cy.getElementById(sel) : null;
      if (node?.nonempty()) {
        const hood = node.closedNeighborhood();
        cy.elements().not(hood).addClass('faded');
        node.addClass('focus');
        node.connectedEdges().addClass('lit');
        cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 1.1) } as never, { duration: 350 });
      }
    });
  }

  zoom(f: number): void { const cy = this.cy; if (cy) cy.animate({ zoom: { level: cy.zoom() * f, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } } } as never, { duration: 200 }); }
  fit(): void { this.cy?.animate({ fit: { eles: this.cy.elements(), padding: 40 } } as never, { duration: 300 }); }

  ngOnDestroy(): void { this.observer.disconnect(); this.cy?.destroy(); }
}

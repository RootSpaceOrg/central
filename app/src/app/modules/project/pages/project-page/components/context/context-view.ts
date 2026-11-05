import { Component, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';

import { GraphDto, NodeDetailDto } from '../../../../../../shared/contract';
import { SessionsService } from '../../../../../../shared/services/sessions/sessions.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../../../shared/ui/icon';
import { Select, SelectOption } from '../../../../../../shared/ui/select';
import { CodeHit, ContextService, FACT_LABEL, Fact, FactKind } from '../../../../services/context/context.service';
import { CodeMap, Layer, Scope, placeOf } from './code-map';

import { AskService } from '../../../../../../shared/services/ask/ask.service';
type Pane = 'grafo' | 'memoria' | 'prompt';
const EDGE_LEGEND = [
  { color: '#3B4559', label: 'importa / chama / injeta' },
  { color: '#B48CFF', label: 'front → rota → lambda → handler' },
  { color: '#3FBF8A', label: 'teste → código' },
];

/**
 * Aba Contexto do projeto: o índice de código como grafo (busca, foco nos vizinhos, camadas de memória e de agentes),
 * a memória do projeto e a prévia exata do que os agentes recebem no prompt.
 */
@Component({
  selector: 'app-context-view',
  imports: [Icon, AgoPipe, CodeMap, Select],
  templateUrl: './context-view.html',
  host: { class: 'grid h-full min-h-0 grid-cols-[290px_minmax(0,1fr)]' },
})
export class ContextView {
  private readonly dialog = inject(AskService);
  protected readonly ctx = inject(ContextService);
  private readonly sessions = inject(SessionsService);
  private readonly canvas = viewChild(CodeMap);

  readonly slug = input.required<string>();
  /** abrir um arquivo no editor (a página leva para a aba de código) */
  readonly openFile = output<string>();

  protected readonly pane = signal<Pane>('grafo');
  protected readonly data = signal<GraphDto | null>(null);
  /** pasta aberta no mapa ([] = raiz do projeto) */
  protected readonly scope = signal<Scope>([]);
  protected readonly layer = signal<Layer>('code');
  protected readonly selected = signal<string | null>(null);
  protected readonly detail = signal<NodeDetailDto | null>(null);
  protected readonly query = signal('');
  protected readonly hits = signal<CodeHit[]>([]);
  protected readonly facts = signal<Fact[]>([]);
  protected readonly showRetired = signal(false);
  protected readonly focusText = signal('');
  protected readonly budget = signal(1500);
  protected readonly block = signal('');
  protected readonly noteText = signal('');
  protected readonly noteKind = signal<FactKind>('convention');
  protected readonly error = signal<string | null>(null);

  protected readonly kinds: SelectOption[] = (Object.keys(FACT_LABEL) as FactKind[]).map(k => ({ value: k, label: FACT_LABEL[k] }));
  protected readonly budgets: SelectOption[] = [1000, 1500, 2000, 4000, 8000].map(b => ({ value: String(b), label: `${b} tokens` }));
  protected readonly factLabel = FACT_LABEL;
  protected readonly legend = EDGE_LEGEND;
  protected readonly status = computed(() => this.ctx.status()[this.slug()] ?? null);
  protected readonly repos = computed(() => {
    const d = this.data();
    if (!d) return [];
    const names = [...new Set(d.nodes.map(n => n.repo).filter(Boolean))].sort();
    const palette = ['#7FA2FF', '#3FBF8A', '#E0B44C', '#B48CFF', '#4CC9F0', '#F07167', '#62D4A3', '#EBC670', '#9DB8FF', '#F58C84'];
    return names.map((n, i) => ({ name: n, color: palette[i % palette.length], files: d.nodes.filter(x => x.repo === n).length }));
  });
  protected readonly visibleFacts = computed(() => this.facts().filter(f => this.showRetired() || !f.retired));
  protected readonly blockTokens = computed(() => Math.ceil(this.block().length / 3.5));
  /** trilha de navegação: raiz, repo, pastas */
  protected readonly crumbs = computed(() => this.scope().map((name, i) => ({ name, scope: this.scope().slice(0, i + 1) })));
  /** o que tem na pasta atual (para a lista textual equivalente ao mapa) */
  protected readonly here = computed(() => {
    const d = this.data();
    const s = this.scope();
    if (!d) return { files: 0, folders: 0 };
    const inside = d.nodes.filter(n => s.every((x, i) => placeOf(n)[i] === x));
    return { files: inside.length, folders: new Set(inside.map(n => placeOf(n)[s.length]).filter(Boolean)).size };
  });

  constructor() {
    // recarrega quando muda de projeto ou o índice/memória avisa que mudou
    effect(() => {
      const slug = this.slug();
      this.ctx.version()[slug];
      untracked(() => this.load(slug));
    });
    effect(() => {
      const sel = this.selected();
      untracked(() => {
        if (!sel) { this.detail.set(null); return; }
        this.ctx.node(sel).then(d => { if (this.selected() === sel) this.detail.set(d); });
      });
    });
    effect(() => {
      const q = this.query().trim();
      const slug = this.slug();
      untracked(() => {
        if (q.length < 2) { this.hits.set([]); return; }
        this.ctx.search(slug, q).then(h => { if (this.query().trim() === q) this.hits.set(h); });
      });
    });
    effect(() => {
      if (this.pane() !== 'prompt') return;
      const slug = this.slug(), focus = this.focusText(), budget = this.budget();
      untracked(() => this.ctx.block(slug, focus, budget).then(b => this.block.set(b)));
    });
  }

  private loadedSlug: string | null = null;

  private async load(slug: string): Promise<void> {
    const data = await this.ctx.graph(slug);
    // projeto grande abre agrupado por pasta (nunca a "bola de pelos" inteira); o detalhe aumenta sob demanda
    if (this.loadedSlug !== slug) {
      this.loadedSlug = slug;
      this.scope.set([]);
      this.selected.set(null);
    }
    this.data.set(data);
    this.facts.set(await this.ctx.facts(slug));
  }

  protected pick(key: string | null): void { this.selected.set(key); }

  /** Entrar numa pasta do mapa. */
  protected open_(scope: Scope): void { this.selected.set(null); this.scope.set(scope); }

  /** Seleciona um arquivo/rota de qualquer lugar: o mapa vai até a pasta dele. */
  protected select(key: string): void {
    const fileKey = key.split('#')[0];
    const n = this.data()?.nodes.find(x => x.key === fileKey);
    if (n) this.scope.set(placeOf(n));
    this.pane.set('grafo');
    this.selected.set(n ? n.key : fileKey);
  }

  /** Resultado da busca: símbolo → seleciona o arquivo dele. */
  protected goHit(h: CodeHit): void { this.select(h.file_key); }

  protected reindex(force = false): void { this.ctx.reindex(this.slug(), force); }

  protected short(key: string): string { return key.replace(/^[^/]+\//, ''); }

  protected open(d: NodeDetailDto): void {
    if (d.file) this.openFile.emit(d.file);
  }

  /** Abre uma conversa com o Claude no projeto já perguntando sobre este nó (ele usa o índice da Central). */
  protected async ask(d: NodeDetailDto): Promise<void> {
    const s = await this.sessions.open(this.slug(), 'chat');
    if (!s) return;
    this.sessions.chatOf(s).send(`Explique ${this.short(d.key)}: para que serve, quem usa e o que ele usa. Use code_symbol e code_neighbors da Central antes de abrir arquivos.`);
  }

  protected async remember(links: string[]): Promise<void> {
    const text = this.noteText().trim();
    if (!text) return;
    this.error.set(null);
    try {
      await this.ctx.remember(this.slug(), this.noteKind(), text, links);
      this.noteText.set('');
      this.facts.set(await this.ctx.facts(this.slug()));
      const sel = this.selected();
      if (sel) this.detail.set(await this.ctx.node(sel));
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  protected async togglePin(f: Fact): Promise<void> {
    await this.ctx.updateFact(f.id, { pinned: !f.pinned });
    this.facts.set(await this.ctx.facts(this.slug()));
  }

  protected async retire(f: Fact): Promise<void> {
    const reason = await this.dialog.text('Retirar este fato?', '', { message: 'Por que deixou de valer? (opcional)', confirmLabel: 'Continuar' });
    if (reason === null) return;
    const replacement = await this.dialog.text('Fato que substitui', f.text, { message: 'Deixe como está ou vazio se não houver.', multiline: true, confirmLabel: 'Retirar' });
    if (replacement === null) return;
    await this.ctx.retire(f.id, reason, replacement?.trim() && replacement.trim() !== f.text ? replacement.trim() : null);
    this.facts.set(await this.ctx.facts(this.slug()));
  }

  protected async edit(f: Fact): Promise<void> {
    const text = await this.dialog.text('Fato', f.text, { multiline: true });
    if (!text?.trim() || text.trim() === f.text) return;
    await this.ctx.updateFact(f.id, { text });
    this.facts.set(await this.ctx.facts(this.slug()));
  }

  protected async remove(f: Fact): Promise<void> {
    if (!(await this.dialog.confirm('Apagar o fato de vez?', { message: 'Retirar mantém o histórico; apagar não.', confirmLabel: 'Apagar', danger: true }))) return;
    await this.ctx.deleteFact(f.id);
    this.facts.set(await this.ctx.facts(this.slug()));
  }

  protected async importMemory(): Promise<void> {
    const n = await this.ctx.importMemory(this.slug());
    this.facts.set(await this.ctx.facts(this.slug()));
    this.error.set(n ? null : 'Nenhuma memória nova do Claude Code nas pastas deste projeto.');
  }

  protected zoom(f: number): void { this.canvas()?.zoom(f); }
  protected resetView(): void { this.canvas()?.fit(); }
}

import { Component, ElementRef, OnDestroy, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';

import { Icon } from '../../../../../../shared/ui/icon';
import { EditorService } from '../../../../services/editor/editor.service';
import { FileIconsService } from '../../../../services/file-icons/file-icons';
import { Monaco, loadMonaco } from '../../../../services/monaco/monaco-loader';

/** Abas + Monaco. Um editor por tela; os modelos (conteúdo) ficam no EditorService. */
@Component({
  selector: 'app-editor',
  imports: [Icon],
  host: { class: 'flex min-h-0 flex-col' },
  template: `
    <div class="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-edge bg-panel" role="tablist" aria-label="Arquivos abertos">
      @for (t of tabs(); track t.path) {
        <div class="group flex items-center gap-2 border-r border-edge pl-3 pr-1.5 text-[13px]"
             [class]="t.path === active() ? 'bg-night text-text' : 'text-mute hover:text-text'">
          <button type="button" role="tab" [attr.aria-selected]="t.path === active()" (click)="select(t.path)" [title]="t.path"
                  class="flex items-center gap-1.5 whitespace-nowrap">
            <img [src]="icons.src(t.name, false)" alt="" width="15" height="15" draggable="false">{{ t.name }}</button>
          <button type="button" (click)="editor.close(slug(), t.path)" [attr.aria-label]="'Fechar ' + t.name"
                  class="grid size-5 place-items-center rounded hover:bg-raise">
            @if (t.dirty) { <span class="size-2 rounded-full bg-text group-hover:hidden"></span>
                            <app-icon name="close" [size]="12" class="hidden group-hover:inline-flex" /> }
            @else { <app-icon name="close" [size]="12" class="opacity-0 group-hover:opacity-100" /> }
          </button>
        </div>
      }
    </div>
    @if (editor.error()) { <p role="alert" class="bg-no/10 px-4 py-2 text-[13px] text-no">{{ editor.error() }}</p> }
    <div class="relative min-h-0 flex-1">
      <div #host class="absolute inset-0" [class.invisible]="!showEditor()"></div>
      @if (!active()) {
        <div class="absolute inset-0 grid place-items-center text-center text-mute">
          <div>
            <p class="font-display text-lg text-text">Nenhum arquivo aberto</p>
            <p class="mt-1">Escolha um arquivo na árvore, ou abra o Claude Code no terminal.</p>
            <button type="button" class="btn btn-sm mt-4" (click)="askClaude.emit()"><app-icon name="spark" [size]="14" />Abrir Claude Code</button>
          </div>
        </div>
      } @else if (unavailable(); as reason) {
        <div class="absolute inset-0 grid place-items-center text-mute">{{ reason }}</div>
      }
    </div>`,
})
export class Editor implements OnDestroy {
  protected readonly editor = inject(EditorService);
  protected readonly icons = inject(FileIconsService);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  readonly slug = input.required<string>();
  readonly askClaude = output<void>();

  protected readonly tabs = computed(() => this.editor.tabsOf(this.slug()));
  protected readonly active = computed(() => this.editor.activeOf(this.slug()));
  protected readonly unavailable = computed(() => this.tabs().find(t => t.path === this.active())?.unavailable ?? null);
  protected readonly showEditor = computed(() => !!this.active() && !this.unavailable());
  private readonly ready = signal(false);
  private instance: any = null;

  constructor() {
    loadMonaco().then((monaco: Monaco) => {
      this.instance = monaco.editor.create(this.host().nativeElement, {
        theme: 'central-night', automaticLayout: true, model: null,
        fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace', fontSize: 13, lineHeight: 21, fontLigatures: true,
        minimap: { enabled: true, renderCharacters: false, scale: 1 }, smoothScrolling: true, padding: { top: 12 },
        scrollBeyondLastLine: false, renderLineHighlight: 'line', cursorSmoothCaretAnimation: 'on', tabSize: 2,
      });
      this.instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        const path = this.active();
        if (path) this.editor.save(this.slug(), path);
      });
      this.ready.set(true);
    });

    effect(() => {
      if (!this.ready()) return;
      const path = this.active();
      const model = path ? this.editor.model(path) : null;
      if (this.instance.getModel() !== model) this.instance.setModel(model);
    });
  }

  protected select(path: string): void {
    this.editor.active.update(a => ({ ...a, [this.slug()]: path }));
  }

  ngOnDestroy(): void {
    this.instance?.setModel(null);
    this.instance?.dispose();
  }
}

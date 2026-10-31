import { Component, inject, input, signal, viewChild } from '@angular/core';

import { EditorService } from '../../../../services/editor/editor.service';
import { Editor } from '../editor/editor';
import { Explorer } from '../explorer/explorer';
import { TerminalPanel } from '../terminal-panel/terminal-panel';

/** Árvore | editor, com o painel de terminais embaixo (altura ajustável arrastando a borda). */
@Component({
  selector: 'app-code-workspace',
  imports: [Explorer, Editor, TerminalPanel],
  host: { class: 'grid h-full min-h-0 grid-cols-[264px_1fr]' },
  template: `
    <app-explorer class="border-r border-edge bg-panel" [root]="folder()" (opened)="editor.open(slug(), $event)" />
    <div class="flex min-h-0 min-w-0 flex-col">
      <app-editor class="min-h-0 flex-1" [slug]="slug()" (askClaude)="panel.open('claude')" />
      <div class="h-1.5 shrink-0 cursor-row-resize border-t border-edge hover:bg-frost/40" role="separator" aria-orientation="horizontal"
           aria-label="Redimensionar terminal" (pointerdown)="startResize($event)"></div>
      <app-terminal-panel #panel class="shrink-0" [style.height.px]="terminalHeight()" [slug]="slug()" [cwd]="folder()" />
    </div>`,
})
export class CodeWorkspace {
  protected readonly editor = inject(EditorService);
  private readonly panel = viewChild.required<TerminalPanel>('panel');

  readonly slug = input.required<string>();
  readonly folder = input.required<string>();

  protected readonly terminalHeight = signal(300);

  protected startResize(e: PointerEvent): void {
    const startY = e.clientY, startH = this.terminalHeight();
    const el = e.target as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => this.terminalHeight.set(Math.min(Math.max(startH + startY - ev.clientY, 120), window.innerHeight - 260));
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); this.panel().refit(); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }
}

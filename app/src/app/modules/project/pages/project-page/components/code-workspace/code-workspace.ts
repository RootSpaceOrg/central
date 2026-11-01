import { Component, inject, input, output } from '@angular/core';

import { EditorService } from '../../../../services/editor/editor.service';
import { Editor } from '../editor/editor';
import { Explorer } from '../explorer/explorer';

/** Árvore | editor. Terminais e conversas ficam nas outras abas da sessão. */
@Component({
  selector: 'app-code-workspace',
  imports: [Explorer, Editor],
  host: { class: 'grid h-full min-h-0 grid-cols-[264px_1fr]' },
  template: `
    <app-explorer class="border-r border-edge bg-panel" [root]="folder()" (opened)="editor.open(slug(), $event)" />
    <app-editor class="min-h-0 min-w-0" [slug]="slug()" (askClaude)="askClaude.emit()" />`,
})
export class CodeWorkspace {
  protected readonly editor = inject(EditorService);

  readonly slug = input.required<string>();
  readonly folder = input.required<string>();
  readonly askClaude = output<void>();
}

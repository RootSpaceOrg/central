import { Component, computed, effect, inject, input, output, signal } from '@angular/core';

import { FsEntryDto } from '../../../../../../shared/contract';
import { errorMessage } from '../../../../../../shared/services/ipc/ipc.service';
import { Icon } from '../../../../../../shared/ui/icon';
import { FileIconsService } from '../../../../services/file-icons/file-icons';
import { FilesApiService } from '../../../../services/files/files-api.service';

interface Row { entry: FsEntryDto; depth: number; open: boolean }

/** Árvore de arquivos da pasta do projeto, carregada sob demanda. */
@Component({
  selector: 'app-explorer',
  imports: [Icon],
  host: { class: 'flex min-h-0 flex-col' },
  template: `
    <div class="flex items-center justify-between px-4 pt-3 pb-2">
      <h3 class="text-[12px] font-semibold text-faint">Arquivos</h3>
      <button type="button" class="btn btn-ghost !p-1" (click)="reload()" title="Recarregar" aria-label="Recarregar arquivos">
        <app-icon name="sync" [size]="14" />
      </button>
    </div>
    <ul class="min-h-0 flex-1 overflow-auto pb-4 text-[13px]" role="tree" aria-label="Arquivos do projeto">
      @for (r of rows(); track r.entry.path) {
        <li role="treeitem" [attr.aria-expanded]="r.entry.dir ? r.open : null">
          <button type="button" (click)="activate(r)" [title]="r.entry.path"
                  class="flex w-full items-center gap-1.5 whitespace-nowrap py-[3px] pr-3 text-left hover:bg-raise/70"
                  [class.bg-raise]="r.entry.path === selected()" [style.padding-left.px]="10 + r.depth * 14">
            @if (r.entry.dir) {
              <app-icon name="chevron" [size]="16" class="text-faint transition-transform" [class.rotate-90]="r.open" />
            } @else {
              <span class="w-4"></span>
            }
            <img [src]="icons.src(r.entry.name, r.entry.dir, r.open)" alt="" width="16" height="16" class="shrink-0" draggable="false">
            <span class="truncate" [class.text-mute]="r.entry.name.startsWith('.')">{{ r.entry.name }}</span>
          </button>
        </li>
      } @empty {
        <li class="px-4 py-3 text-mute">{{ error() ?? 'Pasta vazia.' }}</li>
      }
    </ul>`,
})
export class Explorer {
  private readonly files = inject(FilesApiService);
  protected readonly icons = inject(FileIconsService);

  readonly root = input.required<string>();
  readonly opened = output<string>();

  protected readonly children = signal<Record<string, FsEntryDto[]>>({});
  protected readonly expanded = signal<Set<string>>(new Set());
  protected readonly selected = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly rows = computed(() => {
    const out: Row[] = [];
    const walk = (dir: string, depth: number) => {
      for (const entry of this.children()[dir] ?? []) {
        const open = this.expanded().has(entry.path);
        out.push({ entry, depth, open });
        if (entry.dir && open) walk(entry.path, depth + 1);
      }
    };
    walk(this.root(), 0);
    return out;
  });

  constructor() {
    effect(() => {
      const root = this.root();
      this.children.set({});
      this.expanded.set(new Set());
      this.load(root);
    });
  }

  protected reload(): void {
    const dirs = [this.root(), ...this.expanded()];
    this.children.set({});
    for (const d of dirs) this.load(d);
  }

  protected activate(r: Row): void {
    this.selected.set(r.entry.path);
    if (!r.entry.dir) return this.opened.emit(r.entry.path);
    const next = new Set(this.expanded());
    if (next.has(r.entry.path)) next.delete(r.entry.path);
    else { next.add(r.entry.path); if (!this.children()[r.entry.path]) this.load(r.entry.path); }
    this.expanded.set(next);
  }

  private load(dir: string): void {
    this.files.list(dir)
      .then(list => { this.children.update(c => ({ ...c, [dir]: list })); this.error.set(null); })
      .catch(e => this.error.set(errorMessage(e)));
  }
}

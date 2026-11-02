import { Component, ElementRef, computed, input, model, signal, viewChild } from '@angular/core';

import { Icon } from './icon';
import { AvatarSource, ProjectAvatar } from './project-avatar';

export interface SelectOption {
  value: string;
  label: string;
  hint?: string | null;
  avatar?: AvatarSource | null;
}

let uid = 0;

/** Lista de seleção com ícone (projetos, agentes). Abre por cima de tudo, inclusive dentro de diálogos. */
@Component({
  selector: 'app-entity-select',
  imports: [Icon, ProjectAvatar],
  host: { class: 'block', '(document:mousedown)': 'outside($event)' },
  template: `
    <button #btn type="button" role="combobox" [attr.aria-expanded]="open()" [attr.aria-controls]="listId" [attr.aria-label]="label()"
            (click)="toggle()" (keydown)="key($event)" [disabled]="disabled()"
            class="flex w-full items-center gap-2.5 rounded-[10px] border border-edge bg-night text-left transition-colors hover:border-faint focus:border-frost focus:outline-none disabled:opacity-50"
            [class]="compact() ? 'px-2.5 py-1.5 text-[13px]' : 'px-3 py-2'">
      @if (selected(); as s) {
        @if (s.avatar) { <app-project-avatar [project]="s.avatar" [size]="compact() ? 18 : 22" /> }
        <span class="min-w-0 flex-1 truncate">{{ s.label }}</span>
      } @else {
        <span class="min-w-0 flex-1 truncate text-faint">{{ placeholder() }}</span>
      }
      <app-icon name="chevron" [size]="15" class="rotate-90 text-faint transition-transform" [class.-rotate-90]="open()" />
    </button>

    @if (open()) {
      <div #pop class="fixed z-[60] overflow-hidden rounded-xl border border-edge bg-raise shadow-[0_18px_50px_-12px_rgb(0_0_0/0.8)]"
           [style.left.px]="pos().left" [style.top.px]="pos().top" [style.width.px]="pos().width">
        @if (all().length > 8) {
          <input #search class="w-full border-b border-edge bg-transparent px-3 py-2 text-[13.5px] outline-none placeholder:text-faint"
                 placeholder="Buscar…" [value]="query()" (input)="query.set($any($event.target).value); active.set(0)" (keydown)="key($event)">
        }
        <ul [id]="listId" role="listbox" class="max-h-72 overflow-y-auto p-1">
          @for (o of filtered(); track o.value; let i = $index) {
            <li role="option" [attr.aria-selected]="o.value === value()" (mousedown)="$event.preventDefault()" (click)="pick(o)" (mouseenter)="active.set(i)"
                class="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2"
                [class.bg-edge]="i === active()">
              @if (o.avatar) { <app-project-avatar [project]="o.avatar" [size]="22" /> }
              @else { <span class="grid size-[22px] place-items-center rounded-md border border-dashed border-edge text-faint"><app-icon name="close" [size]="12" /></span> }
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[13.5px]">{{ o.label }}</span>
                @if (o.hint) { <span class="block truncate text-[12px] text-faint">{{ o.hint }}</span> }
              </span>
              @if (o.value === value()) { <app-icon name="check" [size]="15" class="text-frost" /> }
            </li>
          } @empty {
            <li class="px-3 py-3 text-[13px] text-mute">Nada encontrado.</li>
          }
        </ul>
      </div>
    }`,
})
export class EntitySelect {
  readonly options = input.required<SelectOption[]>();
  readonly value = model<string>('');
  /** opção "nenhum" no topo (valor '') */
  readonly noneLabel = input<string | null>(null);
  readonly placeholder = input('Escolher…');
  readonly label = input('Selecionar');
  readonly compact = input(false);
  readonly disabled = input(false);

  private readonly btn = viewChild.required<ElementRef<HTMLButtonElement>>('btn');
  private readonly pop = viewChild<ElementRef<HTMLElement>>('pop');
  private readonly searchEl = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly listId = `entity-select-${++uid}`;
  protected readonly open = signal(false);
  protected readonly active = signal(0);
  protected readonly query = signal('');
  protected readonly pos = signal({ left: 0, top: 0, width: 0 });

  protected readonly all = computed<SelectOption[]>(() =>
    this.noneLabel() ? [{ value: '', label: this.noneLabel()!, avatar: null }, ...this.options()] : this.options());
  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q ? this.all().filter(o => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q)) : this.all();
  });
  protected readonly selected = computed(() => this.all().find(o => o.value === this.value()) ?? null);

  protected toggle(): void {
    if (this.open()) return this.close();
    const r = this.btn().nativeElement.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const height = Math.min(320, this.all().length * 40 + 50);
    this.pos.set({ left: r.left, width: Math.max(r.width, 240), top: below > height + 12 ? r.bottom + 4 : Math.max(8, r.top - height - 4) });
    this.query.set('');
    this.active.set(Math.max(this.all().findIndex(o => o.value === this.value()), 0));
    this.open.set(true);
    queueMicrotask(() => this.searchEl()?.nativeElement.focus());
  }

  protected pick(o: SelectOption): void {
    this.value.set(o.value);
    this.close();
    this.btn().nativeElement.focus();
  }

  protected key(e: KeyboardEvent): void {
    const n = this.filtered().length;
    if (!this.open()) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key) && e.target === this.btn().nativeElement) { e.preventDefault(); this.toggle(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); this.active.set((this.active() + 1) % Math.max(n, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.active.set((this.active() - 1 + n) % Math.max(n, 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = this.filtered()[this.active()]; if (o) this.pick(o); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); this.btn().nativeElement.focus(); }
    else if (e.key === 'Tab') this.close();
  }

  protected outside(e: MouseEvent): void {
    if (!this.open()) return;
    const t = e.target as Node;
    if (!this.btn().nativeElement.contains(t) && !this.pop()?.nativeElement.contains(t)) this.close();
  }

  private close(): void { this.open.set(false); }
}

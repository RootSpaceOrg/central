import { Component, ElementRef, computed, input, model, output, signal, viewChild } from '@angular/core';

import { Icon, IconName } from './icon';
import { AvatarSource, ProjectAvatar } from './project-avatar';

export interface SelectOption {
  value: string;
  label: string;
  hint?: string | null;
  /** foto/ícone de projeto ou agente */
  avatar?: AvatarSource | null;
  /** ícone simples, quando não há avatar */
  icon?: IconName;
  /** opções com o mesmo grupo ficam juntas, sob um título */
  group?: string;
}

let uid = 0;

/**
 * Select da Central (no lugar do nativo): busca por texto, grupos, ícones e teclado. Abre por cima de tudo, inclusive
 * dentro de diálogos. Com action, escolher dispara (picked) e o botão volta ao placeholder (ex.: "+ Adicionar…").
 */
@Component({
  selector: 'app-select',
  imports: [Icon, ProjectAvatar],
  host: { class: 'block', '(document:mousedown)': 'outside($event)' },
  template: `
    <button #btn type="button" role="combobox" [attr.aria-expanded]="open()" [attr.aria-controls]="listId" [attr.aria-label]="label()"
            (click)="toggle()" (keydown)="key($event)" [disabled]="disabled()"
            class="flex w-full items-center gap-2.5 rounded-[10px] border border-edge bg-night text-left transition-colors hover:border-faint focus:border-frost focus:outline-none disabled:opacity-50"
            [class]="compact() ? 'px-2.5 py-1.5 text-[13px]' : 'px-3 py-2'">
      @if (selected(); as s) {
        @if (s.avatar) { <app-project-avatar [project]="s.avatar" [size]="compact() ? 18 : 22" /> }
        @else if (s.icon) { <app-icon [name]="s.icon" [size]="15" class="text-mute" /> }
        <span class="min-w-0 flex-1 truncate">{{ s.label }}</span>
      } @else {
        @if (action()) { <app-icon name="plus" [size]="14" class="text-faint" /> }
        <span class="min-w-0 flex-1 truncate text-faint">{{ placeholder() }}</span>
      }
      <app-icon name="chevron" [size]="15" class="rotate-90 text-faint transition-transform" [class.-rotate-90]="open()" />
    </button>

    @if (open()) {
      <div #pop class="fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-edge bg-raise shadow-[0_18px_50px_-12px_rgb(0_0_0/0.8)]"
           [style.left.px]="pos().left" [style.top.px]="pos().top" [style.width.px]="pos().width">
        @if (searchable()) {
          <div class="flex items-center gap-2 border-b border-edge px-3">
            <app-icon name="search" [size]="14" class="text-faint" />
            <input #search class="w-full bg-transparent py-2.5 text-[13.5px] outline-none placeholder:text-faint" [placeholder]="searchPlaceholder()" aria-label="Filtrar"
                   [value]="query()" (input)="query.set($any($event.target).value); active.set(0)" (keydown)="key($event)">
          </div>
        }
        <ul [id]="listId" role="listbox" class="max-h-80 overflow-y-auto p-1">
          @for (o of filtered(); track o.value; let i = $index) {
            @if (o.group && o.group !== filtered()[i - 1]?.group) {
              <li role="presentation" class="px-2.5 pt-2.5 pb-1 text-[11.5px] font-semibold uppercase tracking-wide text-faint">{{ o.group }}</li>
            }
            <li role="option" [attr.aria-selected]="o.value === value()" (mousedown)="$event.preventDefault()" (click)="pick(o)" (mouseenter)="active.set(i)"
                class="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2" [class.bg-edge]="i === active()">
              @if (o.avatar) { <app-project-avatar [project]="o.avatar" [size]="22" /> }
              @else if (o.icon) { <span class="grid size-[22px] shrink-0 place-items-center rounded-md bg-night text-mute"><app-icon [name]="o.icon" [size]="13" /></span> }
              @else if (o.value === '' && noneLabel()) { <span class="grid size-[22px] place-items-center rounded-md border border-dashed border-edge text-faint"><app-icon name="close" [size]="12" /></span> }
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[13.5px]">{{ o.label }}</span>
                @if (o.hint) { <span class="block truncate text-[12px] text-faint">{{ o.hint }}</span> }
              </span>
              @if (!action() && o.value === value()) { <app-icon name="check" [size]="15" class="text-frost" /> }
            </li>
          } @empty {
            <li class="px-3 py-3 text-[13px] text-mute">{{ all().length ? 'Nada encontrado.' : emptyLabel() }}</li>
          }
        </ul>
      </div>
    }`,
})
export class Select {
  readonly options = input.required<SelectOption[]>();
  readonly value = model<string>('');
  /** opção "nenhum" no topo (valor '') */
  readonly noneLabel = input<string | null>(null);
  readonly placeholder = input('Escolher…');
  readonly label = input('Selecionar');
  readonly compact = input(false);
  readonly disabled = input(false);
  /** busca: auto = só com mais de 8 opções */
  readonly search = input<'auto' | 'always' | 'never'>('auto');
  readonly searchPlaceholder = input('Filtrar…');
  readonly emptyLabel = input('Nenhuma opção.');
  /** modo ação: escolher emite (picked) e não guarda a escolha */
  readonly action = input(false);
  /** largura mínima da lista (px) */
  readonly minWidth = input(240);
  readonly picked = output<string>();
  /** abriu (bom para carregar opções sob demanda) */
  readonly opened = output<void>();

  private readonly btn = viewChild.required<ElementRef<HTMLButtonElement>>('btn');
  private readonly pop = viewChild<ElementRef<HTMLElement>>('pop');
  private readonly searchEl = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly listId = `select-${++uid}`;
  protected readonly open = signal(false);
  protected readonly active = signal(0);
  protected readonly query = signal('');
  protected readonly pos = signal({ left: 0, top: 0, width: 0 });

  protected readonly all = computed<SelectOption[]>(() =>
    this.noneLabel() ? [{ value: '', label: this.noneLabel()! }, ...this.options()] : this.options());
  protected readonly searchable = computed(() => this.search() === 'always' || (this.search() === 'auto' && this.all().length > 8));
  /** filtra por texto (sem acento) e mantém os grupos juntos na ordem em que aparecem */
  protected readonly filtered = computed(() => {
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const q = norm(this.query().trim());
    const list = q ? this.all().filter(o => norm(`${o.label} ${o.hint ?? ''} ${o.group ?? ''}`).includes(q)) : this.all();
    const order = [...new Set(list.map(o => o.group ?? ''))];
    return order.flatMap(g => list.filter(o => (o.group ?? '') === g));
  });
  protected readonly selected = computed(() => (this.action() ? null : this.all().find(o => o.value === this.value()) ?? null));

  protected toggle(): void {
    if (this.open()) return this.close();
    const r = this.btn().nativeElement.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const height = Math.min(360, this.all().length * 44 + 60);
    this.pos.set({ left: r.left, width: Math.max(r.width, this.minWidth()), top: below > height + 12 ? r.bottom + 4 : Math.max(8, r.top - height - 4) });
    this.query.set('');
    this.active.set(Math.max(this.filtered().findIndex(o => o.value === this.value()), 0));
    this.open.set(true);
    this.opened.emit();
    queueMicrotask(() => this.searchEl()?.nativeElement.focus());
  }

  protected pick(o: SelectOption): void {
    if (this.action()) this.picked.emit(o.value);
    else { this.value.set(o.value); this.picked.emit(o.value); }
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

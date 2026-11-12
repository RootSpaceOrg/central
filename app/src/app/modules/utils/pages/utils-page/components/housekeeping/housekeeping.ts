import { Component, DestroyRef, computed, inject, signal } from '@angular/core';

import { HousekeepingItem } from '../../../../../../shared/contract';
import { AskService } from '../../../../../../shared/services/ask/ask.service';
import { Check } from '../../../../../../shared/ui/check';
import { Icon, IconName } from '../../../../../../shared/ui/icon';
import { HousekeepingApiService } from '../../../../services/housekeeping/housekeeping-api.service';

type Kind = HousekeepingItem['kind'];
const KINDS: { kind: Kind; label: string; hint: string; icon: IconName }[] = [
  { kind: 'video', label: 'Vídeos de entregas revisadas', hint: 'A gravação de "como testar" de entregas que você já aprovou, descartou ou que não têm mais entrega.', icon: 'play' },
  { kind: 'worktree', label: 'Cópias de trabalho paradas', hint: 'Worktrees (o repositório inteiro, com node_modules) de execuções que acabaram e cuja entrega já foi revisada. Com mudança por salvar não aparecem.', icon: 'layers' },
  { kind: 'branch', label: 'Branches locais mergeadas', hint: 'Não ocupam espaço (são só nomes no git): limpar é organização. Só locais (o GitHub não é tocado). Mergeadas em develop/main, ou de tarefa feita (o merge squash não aparece no git). main, develop e a atual nunca.', icon: 'pullRequest' },
  { kind: 'temp', label: 'Arquivos descartáveis', hint: 'Pastas .central-tmp, onde os agentes guardam scripts de teste, prints e saídas que não vão para o repositório.', icon: 'delete' },
];

const mb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(0)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Limpeza do que os agentes deixam para trás: levanta (com o motivo de cada item), você marca e limpa. Nada é apagado
 * sem marcar; o remoto, main e develop nunca são tocados.
 */
@Component({
  selector: 'app-housekeeping',
  imports: [Check, Icon],
  host: { class: 'block max-w-[1100px]' },
  template: `
    <div class="flex flex-wrap items-center gap-3">
      <p class="flex-1 text-[13.5px] text-mute">O que os agentes deixaram para trás e já não serve. Marque o que quer apagar; o que ainda espera revisão fica de fora.</p>
      <button type="button" class="btn btn-sm" [disabled]="scanning() || cleaning()" (click)="scan()">
        <app-icon name="sync" [size]="14" [class.animate-spin]="scanning()" />{{ scanning() ? 'Procurando…' : 'Procurar de novo' }}</button>
    </div>

    @if (result(); as r) {
      <p role="status" class="mt-4 rounded-xl border px-4 py-3 text-[13px]" [class]="r.failed.length ? 'border-later/40 bg-later/5' : 'border-yes/40 bg-yes/5 text-yes'">
        {{ r.done }} {{ r.done === 1 ? 'item limpo' : 'itens limpos' }}@if (r.freed) { · {{ r.freed }} liberados }.
        @for (f of r.failed.slice(0, 5); track f.label) { <span class="mt-1 block text-later">{{ f.label }}: {{ f.why }}</span> }
      </p>
    }

    @if (scanning() && !items().length) {
      <p class="mt-10 flex items-center justify-center gap-2 text-[13.5px] text-mute"><span class="pulse size-2 rounded-full bg-frost"></span>Olhando vídeos, worktrees e branches de todos os repositórios…</p>
    } @else {
      <div class="mt-5 space-y-4">
        @for (k of kinds; track k.kind) {
          @let list = byKind()[k.kind] ?? [];
          @let n = pickedOf(k.kind);
          <section class="overflow-hidden rounded-2xl border border-edge bg-panel" [attr.aria-label]="k.label">
            <header class="flex items-center gap-3 px-4 py-3">
              <app-check [checked]="!!list.length && n === list.length" [indeterminate]="n > 0 && n < list.length" [disabled]="!list.length" (changed)="toggleKind(k.kind, $event)" [label]="'Marcar todos: ' + k.label" />
              <app-icon [name]="k.icon" [size]="16" class="text-faint" />
              <div class="min-w-0 flex-1">
                <p class="font-semibold">{{ k.label }} <span class="font-normal text-faint">· {{ list.length || 'nada' }}@if (sizeOf(list); as s) { · {{ s }} }@if (k.kind === 'worktree' && measuring().size) { <span class="pulse"> · medindo {{ list.length - measuring().size }}/{{ list.length }}…</span> }</span></p>
                <p class="text-[12px] leading-snug text-faint">{{ k.hint }}</p>
              </div>
              @if (list.length) {
                <button type="button" class="text-[12.5px] text-mute hover:text-text" (click)="toggleOpen(k.kind)">{{ open().has(k.kind) ? 'esconder' : 'ver ' + list.length }}</button>
              }
            </header>
            @if (open().has(k.kind)) {
              <ul class="max-h-[340px] overflow-y-auto border-t border-edge/70">
                @for (it of list; track it.id) {
                  <li>
                    <label class="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-raise/40">
                      <app-check [checked]="picked().has(it.id)" (changed)="toggle(it.id)" [label]="it.label" />
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-[13px]" [title]="it.id">{{ it.label }}</span>
                        <span class="block text-[11.5px] text-faint">{{ it.why }}</span>
                      </span>
                      @if (it.size) { <span class="shrink-0 text-[12px] tabular-nums text-mute">{{ mb(it.size) }}</span> }
                      @else if (measuring().has(it.id)) { <span class="shrink-0 text-[12px] text-faint">medindo…</span> }
                    </label>
                  </li>
                }
              </ul>
            }
          </section>
        }
      </div>

      @if (picked().size) {
        <div class="sticky bottom-0 mt-5 flex items-center gap-3 rounded-2xl border border-edge bg-raise px-4 py-3 shadow-[0_-12px_30px_-18px_rgb(0_0_0/0.8)]">
          <p class="flex-1 text-[13.5px]"><b>{{ picked().size }}</b> {{ picked().size === 1 ? 'marcado' : 'marcados' }}@if (pickedSize(); as s) { · {{ s }} liberados }@if (measuring().size) { <span class="text-faint"> (ainda medindo)</span> }</p>
          <button type="button" class="btn btn-sm btn-ghost" [disabled]="cleaning()" (click)="picked.set(empty())">Desmarcar</button>
          <button type="button" class="btn btn-sm !border-no !bg-no !text-night" [disabled]="cleaning()" (click)="clean()">
            <app-icon name="delete" [size]="14" />{{ cleaning() ? 'Limpando…' : 'Limpar ' + picked().size }}</button>
        </div>
      }
    }`,
})
export class Housekeeping {
  private readonly api = inject(HousekeepingApiService);
  private readonly ask = inject(AskService);
  protected readonly kinds = KINDS;
  protected readonly mb = mb;
  protected readonly items = signal<HousekeepingItem[]>([]);
  protected readonly scanning = signal(false);
  protected readonly cleaning = signal(false);
  protected readonly empty = () => new Set<string>();
  protected readonly picked = signal(new Set<string>());
  protected readonly open = signal(new Set<Kind>());
  protected readonly result = signal<{ done: number; freed: string | null; failed: { label: string; why: string }[] } | null>(null);

  protected readonly byKind = computed(() => {
    const m: Partial<Record<Kind, HousekeepingItem[]>> = {};
    for (const it of this.items()) (m[it.kind] ??= []).push(it);
    return m;
  });
  protected readonly pickedSize = computed(() => this.sizeOf(this.items().filter(i => this.picked().has(i.id))));

  /** cópias de trabalho ainda sendo medidas */
  protected readonly measuring = signal(new Set<string>());

  constructor() {
    const off = this.api.onSize(({ id, size }) => {
      this.items.update(list => list.map(i => (i.id === id ? { ...i, size } : i)));
      this.measuring.update(s => { const n = new Set(s); n.delete(id); return n; });
    });
    inject(DestroyRef).onDestroy(off);
    this.scan();
  }

  protected async scan(): Promise<void> {
    this.scanning.set(true);
    try {
      const items = await this.api.scan();
      this.items.set(items);
      this.picked.set(new Set());
      // o tamanho das cópias de trabalho (repositório inteiro, node_modules) vem depois, uma a uma
      const ids = items.filter(i => i.kind === 'worktree').map(i => i.id);
      this.measuring.set(new Set(ids));
      if (ids.length) this.api.measure(ids);
    }
    finally { this.scanning.set(false); }
  }

  protected sizeOf(list: HousekeepingItem[]): string | null {
    const n = list.reduce((a, i) => a + (i.size ?? 0), 0);
    return n ? mb(n) : null;
  }
  protected pickedOf(k: Kind): number { return (this.byKind()[k] ?? []).filter(i => this.picked().has(i.id)).length; }
  protected toggle(id: string): void { this.picked.update(s => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; }); }
  protected toggleKind(k: Kind, on: boolean): void {
    this.picked.update(s => { const n = new Set(s); for (const i of this.byKind()[k] ?? []) on ? n.add(i.id) : n.delete(i.id); return n; });
  }
  protected toggleOpen(k: Kind): void { this.open.update(s => { const n = new Set(s); if (!n.delete(k)) n.add(k); return n; }); }

  protected async clean(): Promise<void> {
    const list = this.items().filter(i => this.picked().has(i.id));
    const size = this.sizeOf(list);
    if (!(await this.ask.confirm(`Apagar ${list.length} ${list.length === 1 ? 'item' : 'itens'}${size ? ` (${size})` : ''}? Não dá para desfazer. Branches são só as locais; o GitHub não é tocado.`, { confirmLabel: 'Limpar' }))) return;
    this.cleaning.set(true);
    try {
      const r = await this.api.clean(list);
      const failed = new Set(r.failed.map(f => f.label));
      this.result.set({ ...r, freed: this.sizeOf(list.filter(i => !failed.has(i.label))) });
      await this.scan();
    } finally { this.cleaning.set(false); }
  }
}

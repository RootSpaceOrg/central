import { Component, computed, inject, input, signal } from '@angular/core';

import { Agent } from '../../../../shared/services/agents/agents.service';
import { MEMORY_KINDS, Memory, MemoriesService, MemoryKind } from '../../../../shared/services/memories/memories.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';

import { AskService } from '../../../../shared/services/ask/ask.service';
export type MemoryView = 'dele' | 'todos' | 'esquecidas';

/**
 * Memória do agente: o que ele lembra entre conversas (dele), o que todos os agentes lembram (de todos) e o que foi
 * esquecido (com o motivo). Entra sozinha no prompt; aqui você corrige, fixa, move de escopo ou apaga.
 */
@Component({
  selector: 'app-memory-panel',
  imports: [Icon, AgoPipe],
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    @let a = agent();
    <div class="mx-auto max-w-3xl px-8 pt-6 pb-16">
      <p class="text-[13.5px] text-mute">
        @switch (view()) {
          @case ('dele') { O que <b class="text-text">{{ a.name }}</b> lembra entre conversas. Entra sozinho no prompt dele; ele mesmo guarda com <code>remember</code> quando você conta algo que vale lembrar. }
          @case ('todos') { O que <b class="text-text">todos os agentes</b> sabem: sobre você, clientes e decisões que cruzam projetos. Entra no prompt de todo agente, sessão e execução. }
          @default { O que foi esquecido (sai do prompt), com o motivo. Apague de vez se não fizer sentido manter o registro. }
        }
      </p>

      @if (view() !== 'esquecidas') {
        <form class="mt-4 rounded-2xl border border-edge bg-panel p-3" (submit)="add($event)">
          <textarea class="field h-16 w-full resize-none text-[13.5px]" [placeholder]="view() === 'todos' ? 'Ex.: Prefiro respostas curtas e em português.' : 'Ex.: Nos posts, sempre fechar com uma pergunta.'"
                    aria-label="Nova memória" [value]="text()" (input)="text.set($any($event.target).value)" (keydown.control.enter)="add($event)"></textarea>
          <div class="mt-2 flex items-center gap-2">
            <select class="field !w-auto !py-1 text-[12.5px]" aria-label="Tipo" [value]="kind()" (change)="kind.set($any($event.target).value)">
              @for (k of kinds; track k.id) { <option [value]="k.id" [selected]="kind() === k.id">{{ k.label }}</option> }
            </select>
            <span class="flex-1 truncate text-[11.5px] text-faint">{{ kindHint() }}</span>
            <button type="submit" class="btn btn-sm btn-primary" [disabled]="!text().trim()">Lembrar</button>
          </div>
          @if (error()) { <p role="alert" class="mt-2 text-[12.5px] text-no">{{ error() }}</p> }
        </form>
      }

      <ul class="mt-4 space-y-2">
        @for (m of list(); track m.id) {
          <li class="group rounded-2xl border border-edge bg-panel px-4 py-3" [class.opacity-70]="m.retired">
            <div class="flex items-start gap-3">
              <span class="mt-0.5 shrink-0 rounded-full bg-raise px-2 py-0.5 text-[11px] font-semibold text-mute">{{ kindLabel(m.kind) }}</span>
              @if (editing() === m.id) {
                <textarea class="field h-16 min-w-0 flex-1 resize-none text-[13.5px]" [value]="m.text" aria-label="Editar memória"
                          (keydown.enter)="save(m, $any($event.target).value); $event.preventDefault()" (keydown.escape)="editing.set(null)"
                          (blur)="save(m, $any($event.target).value)" autofocus></textarea>
              } @else {
                <p class="min-w-0 flex-1 text-[14px] leading-snug" [class.line-through]="m.retired" (dblclick)="!m.retired && editing.set(m.id)">{{ m.text }}</p>
              }
              @if (!m.retired) {
                <span class="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button type="button" class="rounded p-1 text-faint hover:text-text" (click)="memories.update(m.id, { pinned: !m.pinned })"
                          [title]="m.pinned ? 'Desafixar' : 'Fixar (entra sempre no prompt)'" [attr.aria-label]="m.pinned ? 'Desafixar' : 'Fixar'">
                    <app-icon name="flag" [size]="13" [class.text-later]="m.pinned" /></button>
                  <button type="button" class="rounded p-1 text-faint hover:text-text" (click)="editing.set(m.id)" title="Editar" aria-label="Editar"><app-icon name="edit" [size]="13" /></button>
                  <button type="button" class="rounded p-1 text-faint hover:text-text" (click)="move(m)"
                          [title]="m.agentId ? 'Passar para todos os agentes' : 'Passar só para ' + a.name" aria-label="Mudar quem lembra"><app-icon name="arrowRight" [size]="13" /></button>
                  <button type="button" class="rounded p-1 text-faint hover:text-no" (click)="forget(m)" title="Esquecer" aria-label="Esquecer"><app-icon name="close" [size]="13" /></button>
                </span>
              } @else {
                <button type="button" class="shrink-0 text-[12px] text-faint hover:text-no" (click)="memories.remove(m.id)">Apagar de vez</button>
              }
            </div>
            <p class="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-faint">
              @if (m.pinned) { <span class="text-later">fixada</span> · }
              @if (m.author === 'gustavo') { você } @else { <span class="text-frost">✦ {{ m.agentId ? a.name : 'um agente' }}</span> }
              · {{ m.createdAt | ago }}
              @if (view() === 'esquecidas') { · {{ m.agentId ? 'dele' : 'de todos' }} }
              @if (m.retiredReason) { · esquecida: {{ m.retiredReason }} }
            </p>
          </li>
        } @empty {
          <li class="rounded-2xl border border-dashed border-edge px-5 py-6 text-center text-[13px] text-mute">
            @switch (view()) {
              @case ('dele') { {{ a.name }} ainda não guardou nada. Conte algo que ele deveria lembrar, ou escreva aqui. }
              @case ('todos') { Nada compartilhado ainda. O que vale para qualquer agente (você, clientes, decisões) entra aqui. }
              @default { Nada esquecido. }
            }
          </li>
        }
      </ul>
      @if (memories.error()) { <p role="alert" class="mt-3 text-[12.5px] text-no">{{ memories.error() }}</p> }
    </div>
  `,
})
export class MemoryPanel {
  private readonly ask = inject(AskService);
  protected readonly memories = inject(MemoriesService);

  readonly agent = input.required<Agent>();
  readonly view = input<MemoryView>('dele');

  protected readonly kinds = MEMORY_KINDS;
  protected readonly text = signal('');
  protected readonly kind = signal<MemoryKind>('preferencia');
  protected readonly editing = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly kindHint = computed(() => MEMORY_KINDS.find(k => k.id === this.kind())?.hint ?? '');

  protected readonly list = computed<Memory[]>(() => {
    const id = this.agent().id;
    const v = this.view();
    return v === 'dele' ? this.memories.of(id) : v === 'todos' ? this.memories.of(null) : this.memories.retiredFor(id);
  });

  protected kindLabel(k: MemoryKind): string { return MEMORY_KINDS.find(x => x.id === k)?.label ?? k; }

  protected async add(e: Event): Promise<void> {
    e.preventDefault();
    const text = this.text().trim();
    if (!text) return;
    try {
      await this.memories.create(this.view() === 'todos' ? null : this.agent().id, this.kind(), text);
      this.text.set('');
      this.error.set(null);
    } catch (err) {
      this.error.set((err as Error).message);
    }
  }

  protected save(m: Memory, text: string): void {
    this.editing.set(null);
    if (text.trim() && text.trim() !== m.text) this.memories.update(m.id, { text: text.trim() });
  }

  protected move(m: Memory): void { this.memories.update(m.id, { agentId: m.agentId ? null : this.agent().id }); }

  protected async forget(m: Memory): Promise<void> {
    const reason = await this.ask.text('Esquecer esta memória?', 'não vale mais', { message: 'Por quê? Fica registrado.', confirmLabel: 'Esquecer' });
    if (reason !== null) this.memories.forget(m.id, reason);
  }
}

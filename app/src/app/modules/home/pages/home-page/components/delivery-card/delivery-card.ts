import { Component, inject, input, signal } from '@angular/core';

import { ChatService } from '../../../../../../shared/services/chat/chat.service';
import { Delivery, DeliveriesService } from '../../../../../../shared/services/deliveries/deliveries.service';
import { ProjectsService } from '../../../../../../shared/services/projects/projects.service';
import { AgoPipe } from '../../../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../../../shared/ui/icon';

/**
 * Uma entrega para revisar: a nota do agente (o que mudou, por quê, como testar, riscos), o diff e três saídas:
 * aceitar (a tarefa vai para Feito; o merge do PR fica no GitHub), pedir ajuste (o texto volta para o agente, na mesma
 * sessão e pasta) ou descartar.
 */
@Component({
  selector: 'app-delivery-card',
  imports: [Icon, AgoPipe],
  host: { class: 'block' },
  template: `
    @let d = delivery();
    <article class="rounded-2xl border border-edge bg-panel px-5 py-3.5">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span class="grid size-8 shrink-0 place-items-center rounded-xl bg-frost/15 text-frost"><app-icon name="pr" [size]="16" /></span>
        <button type="button" class="min-w-[220px] flex-1 text-left" (click)="open.set(!open())" [attr.aria-expanded]="open()">
          <span class="text-[12.5px] font-semibold" [style.color]="color(d.projectSlug)">{{ d.projectName ?? 'Sem projeto' }}</span>
          <span class="text-[12.5px] text-faint"> · {{ d.agentName ?? 'agente' }} · {{ d.at | ago }}</span>
          <span class="block truncate leading-snug">{{ d.title }}</span>
          <span class="block text-[12.5px] text-mute">
            @if (d.files) { {{ d.files }} {{ d.files === 1 ? 'arquivo' : 'arquivos' }} <span class="text-yes">+{{ d.additions }}</span> <span class="text-later">−{{ d.deletions }}</span> · }
            @if (d.explained) { {{ open() ? 'esconder a nota' : 'ver a nota' }} } @else { sem explicação do agente · ver o resultado }
          </span>
        </button>
        @if (d.prUrl) { <button type="button" class="btn btn-sm btn-ghost" (click)="openPr(d.prUrl)"><app-icon name="external" [size]="14" />PR</button> }
        <button type="button" class="btn btn-sm btn-ghost" (click)="adjusting.set(!adjusting())">Pedir ajuste</button>
        <button type="button" class="btn btn-sm btn-ghost text-mute" (click)="deliveries.discard(d)">Descartar</button>
        <button type="button" class="btn btn-sm !border-yes !bg-yes !text-night" (click)="deliveries.accept(d)" title="Revisado: a tarefa vai para Feito (o merge do PR, se faltar, você faz no GitHub)"><app-icon name="check" [size]="14" />Marcar como feito</button>
      </div>

      @if (open()) {
        <dl class="mt-3 grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 border-t border-edge pt-3 text-[13.5px]">
          <dt class="text-faint">O que mudou</dt><dd class="whitespace-pre-line selectable">{{ d.what }}</dd>
          @if (d.why) { <dt class="text-faint">Por quê</dt><dd class="whitespace-pre-line selectable">{{ d.why }}</dd> }
          @if (d.howToTest) { <dt class="text-faint">Como testar</dt><dd class="whitespace-pre-line selectable">{{ d.howToTest }}</dd> }
          @if (d.risks) { <dt class="text-faint">Riscos</dt><dd class="whitespace-pre-line text-later selectable">{{ d.risks }}</dd> }
          @if (d.diffStat) { <dt class="text-faint">Arquivos</dt><dd><pre class="max-h-48 overflow-auto rounded-lg bg-night p-2 font-mono text-[11.5px] leading-relaxed text-mute selectable">{{ d.diffStat }}</pre></dd> }
        </dl>
      }

      @if (adjusting()) {
        <div class="mt-3 border-t border-edge pt-3">
          <textarea class="field h-20 w-full resize-y text-[13.5px]" placeholder="O que ajustar. Vai para o agente, na mesma sessão e pasta da entrega."
                    aria-label="Ajuste pedido" [value]="note()" (input)="note.set($any($event.target).value)" (keydown.control.enter)="adjust()"></textarea>
          <div class="mt-2 flex items-center justify-end gap-2">
            @if (error()) { <span role="alert" class="mr-auto text-[12.5px] text-no">{{ error() }}</span> }
            <button type="button" class="btn btn-sm btn-ghost" (click)="adjusting.set(false)">Cancelar</button>
            <button type="button" class="btn btn-sm btn-primary" [disabled]="!note().trim() || busy()" (click)="adjust()">Mandar para o agente</button>
          </div>
        </div>
      }
    </article>
  `,
})
export class DeliveryCard {
  protected readonly deliveries = inject(DeliveriesService);
  private readonly projects = inject(ProjectsService);
  private readonly chat = inject(ChatService);

  readonly delivery = input.required<Delivery>();

  protected readonly open = signal(false);
  protected readonly adjusting = signal(false);
  protected readonly note = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected color(slug: string | null): string { return (slug && this.projects.bySlug().get(slug)?.color) || 'var(--color-mute)'; }

  protected openPr(url: string): void { this.projects.openExternal(url); }

  protected async adjust(): Promise<void> {
    const text = this.note().trim();
    if (!text || this.busy()) return;
    this.busy.set(true);
    try {
      const chatId = await this.deliveries.adjust(this.delivery(), text);
      this.chat.openInPanel(chatId);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}

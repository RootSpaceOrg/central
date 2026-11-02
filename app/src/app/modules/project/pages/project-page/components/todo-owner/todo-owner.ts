import { Component, computed, inject, input, signal } from '@angular/core';

import { AgentsService } from '../../../../../../shared/services/agents/agents.service';
import { Project } from '../../../../../../shared/services/projects/projects.model';
import { ProjectsService } from '../../../../../../shared/services/projects/projects.service';
import { Icon } from '../../../../../../shared/ui/icon';

/**
 * Responsável pelo "A fazer" (barra do Backlog): o agente que pega sozinho cada tarefa que você põe em A fazer, com
 * quantas por vez e em que horário. Pôr em A fazer = pedir; sem responsável, nada dispara.
 */
@Component({
  selector: 'app-todo-owner',
  imports: [Icon],
  host: { class: 'flex flex-wrap items-center gap-2 text-[13px]' },
  template: `
    @let p = project();
    <app-icon name="agent" [size]="15" class="text-mute" />
    <label class="text-mute" for="todo-owner">Responsável pelo A fazer</label>
    <select id="todo-owner" class="field !w-auto !py-1 text-[13px]" (change)="setAgent($any($event.target).value)">
      <option value="" [selected]="!p.todoAgentId">ninguém (você dispara)</option>
      @for (a of candidates(); track a.id) { <option [value]="a.id" [selected]="p.todoAgentId === a.id">{{ a.name }}</option> }
    </select>
    @if (p.todoAgentId) {
      <label class="text-mute" for="todo-parallel">até</label>
      <select id="todo-parallel" class="field !w-auto !py-1 text-[13px]" (change)="save({ parallel: +$any($event.target).value })">
        @for (n of [1, 2, 3, 4]; track n) { <option [value]="n" [selected]="p.todoParallel === n">{{ n }}</option> }
      </select>
      <span class="text-mute">por vez, das</span>
      <input class="field !w-24 !py-1 text-center text-[13px]" placeholder="qualquer hora" aria-label="Horário (ex.: 08-22)" [value]="p.todoHours"
             (change)="save({ hours: $any($event.target).value.trim() })" title="Ex.: 08-22, ou 22-06 para a madrugada. Vazio = qualquer hora." />
      <span class="text-faint" title="Tarefa em A fazer vira uma execução dele, ligada à tarefa, com nota de entrega e revisão. Não dispara com a cota da sessão acima de 80%.">ⓘ</span>
    }
    @if (error()) { <span role="alert" class="text-no">{{ error() }}</span> }
  `,
})
export class TodoOwner {
  private readonly projects = inject(ProjectsService);
  private readonly agents = inject(AgentsService);

  readonly project = input.required<Project>();

  protected readonly error = signal<string | null>(null);
  /** agentes do projeto (ou do projeto-pai) primeiro; depois os sem projeto */
  protected readonly candidates = computed(() => {
    const p = this.project();
    const mine = new Set([p.slug, p.parentSlug].filter(Boolean));
    return this.agents.agents().filter(a => !a.builtin && (!a.projectSlug || mine.has(a.projectSlug)))
      .sort((a, b) => Number(!mine.has(a.projectSlug ?? '')) - Number(!mine.has(b.projectSlug ?? '')));
  });

  protected setAgent(value: string): void { this.save({ agentId: value ? Number(value) : null }); }

  protected async save(patch: { agentId?: number | null; parallel?: number; hours?: string }): Promise<void> {
    this.error.set(null);
    try { await this.projects.setTodoOwner(this.project().slug, patch); }
    catch (e) { this.error.set((e as Error).message); }
  }
}

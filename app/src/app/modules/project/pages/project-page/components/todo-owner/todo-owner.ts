import { Component, computed, inject, input, signal } from '@angular/core';

import { AgentsService } from '../../../../../../shared/services/agents/agents.service';
import { Project } from '../../../../../../shared/services/projects/projects.model';
import { ProjectsService } from '../../../../../../shared/services/projects/projects.service';
import { Icon } from '../../../../../../shared/ui/icon';
import { Select, SelectOption } from '../../../../../../shared/ui/select';

/**
 * Responsável pelo "A fazer" (barra do Backlog): o agente que pega sozinho cada tarefa que você põe em A fazer, com
 * quantas por vez e em que horário. Pôr em A fazer = pedir; sem responsável, nada dispara.
 */
@Component({
  selector: 'app-todo-owner',
  imports: [Icon, Select],
  host: { class: 'flex flex-wrap items-center gap-2 text-[13px]' },
  template: `
    @let p = project();
    <app-icon name="agent" [size]="15" class="text-mute" />
    <span class="text-mute">Tech lead (executa o A fazer)</span>
    <app-select class="w-56" [compact]="true" [options]="candidates()" [value]="p.todoAgentId ? '' + p.todoAgentId : ''" (valueChange)="setAgent($event)"
                label="Tech lead" />
    @if (p.todoAgentId) {
      <span class="text-mute">até</span>
      <app-select class="w-16" [compact]="true" [options]="parallels" [value]="'' + p.todoParallel" (valueChange)="save({ parallel: +$event })"
                  label="Quantas por vez" [minWidth]="80" />
      <span class="text-mute">por vez, das</span>
      <input class="field !w-24 !py-1 text-center text-[13px]" placeholder="sempre" aria-label="Horário (ex.: 08-22)" [value]="p.todoHours"
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
  protected readonly candidates = computed<SelectOption[]>(() => {
    const p = this.project();
    const mine = new Set([p.slug, p.parentSlug].filter(Boolean));
    return [{ value: '', label: 'ninguém' }, ...this.agents.agents().filter(a => !a.builtin && (!a.projectSlug || mine.has(a.projectSlug)))
      .sort((a, b) => Number(!mine.has(a.projectSlug ?? '')) - Number(!mine.has(b.projectSlug ?? '')))
      .map(a => ({ value: String(a.id), label: a.name, avatar: a }))];
  });
  protected readonly parallels: SelectOption[] = [1, 2, 3, 4].map(n => ({ value: String(n), label: String(n) }));

  protected setAgent(value: string): void { this.save({ agentId: value ? Number(value) : null }); }

  protected async save(patch: { agentId?: number | null; parallel?: number; hours?: string }): Promise<void> {
    this.error.set(null);
    try { await this.projects.setTodoOwner(this.project().slug, patch); }
    catch (e) { this.error.set((e as Error).message); }
  }
}

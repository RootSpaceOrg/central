import { Component, computed, inject, input, model } from '@angular/core';

import { AgentsService } from '../../services/agents/agents.service';
import { ProjectsService } from '../../services/projects/projects.service';
import { Select, SelectOption } from '../../ui/select';

/** Escolher agente vendo o ícone (o valor é o id em texto; '' = nenhum). */
@Component({
  selector: 'app-agent-select',
  imports: [Select],
  template: `<app-select [options]="options()" [(value)]="value" [noneLabel]="noneLabel()" [compact]="compact()"
    placeholder="Escolher agente…" label="Agente" />`,
})
export class AgentSelect {
  private readonly agents = inject(AgentsService);
  private readonly projects = inject(ProjectsService);

  readonly value = model<string>('');
  readonly noneLabel = input<string | null>(null);
  readonly compact = input(false);
  /** esconde a Central (ex.: rotinas, onde ela não faz sentido como papel) */
  readonly hideCentral = input(false);

  protected readonly options = computed<SelectOption[]>(() =>
    this.agents.agents().filter(a => !(this.hideCentral() && a.builtin)).map(a => ({
      value: String(a.id), label: a.name, avatar: a,
      hint: a.projectSlug ? this.projects.bySlug().get(a.projectSlug)?.name ?? null : a.builtin ? 'Organiza tudo' : 'Sem projeto',
    })));
}

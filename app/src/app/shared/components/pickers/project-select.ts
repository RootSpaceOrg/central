import { Component, computed, inject, input, model } from '@angular/core';

import { STATUS_LABEL } from '../../services/projects/projects.model';
import { ProjectsService } from '../../services/projects/projects.service';
import { EntitySelect, SelectOption } from '../../ui/entity-select';

/** Escolher projeto vendo o ícone de cada um. noneLabel liga a opção "sem projeto". Frentes aparecem como "Grupo › Frente". */
@Component({
  selector: 'app-project-select',
  imports: [EntitySelect],
  template: `<app-entity-select [options]="options()" [(value)]="value" [noneLabel]="noneLabel()" [compact]="compact()"
    [placeholder]="placeholder()" label="Projeto" />`,
})
export class ProjectSelect {
  private readonly projects = inject(ProjectsService);

  readonly value = model<string>('');
  readonly noneLabel = input<string | null>(null);
  readonly compact = input(false);
  readonly placeholder = input('Escolher projeto…');
  readonly includeDead = input(false);
  /** tirar um projeto da lista (ex.: ele mesmo, ao escolher o grupo dele) */
  readonly exclude = input<string | null>(null);
  /** só projetos de primeiro nível (grupos possíveis) */
  readonly onlyTop = input(false);

  protected readonly options = computed<SelectOption[]>(() =>
    (this.includeDead() ? this.projects.projects() : this.projects.living())
      .filter(p => p.slug !== this.exclude() && (!this.onlyTop() || !p.parentSlug))
      .map(p => ({ value: p.slug, label: this.projects.fullName(p), avatar: p, hint: p.status === 'active' ? null : STATUS_LABEL[p.status] })));
}

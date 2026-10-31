import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ProjectSelect } from '../../../../shared/components/pickers/project-select';

import { KanbanBoard } from '../../../../shared/components/kanban-board/kanban-board';
import { DialogsService } from '../../../../shared/services/dialogs/dialogs.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { TasksService } from '../../../../shared/services/tasks/tasks.service';
import { TurnsService } from '../../../../shared/services/turns/turns.service';
import { Icon } from '../../../../shared/ui/icon';

@Component({
  selector: 'app-backlog-page',
  imports: [KanbanBoard, Icon, ProjectSelect],
  host: { class: 'flex h-full min-h-0 flex-col px-8 pt-7 pb-5' },
  template: `
    <div class="flex items-end gap-4">
      <div class="mr-auto">
        <h1 class="font-display text-[34px] font-bold leading-tight tracking-tight">Backlog</h1>
        <p class="mt-1 text-mute">{{ open() }} tarefas abertas{{ project() ? ' em ' + project()!.name : ' em todos os projetos' }}. Arraste entre as colunas.</p>
      </div>
      <app-project-select class="w-64" [value]="slug() ?? ''" (valueChange)="filter($event)" noneLabel="Todos os projetos" />
      <button type="button" class="btn" (click)="dialogs.newTurn({ projectSlug: slug() })"><app-icon name="night" [size]="18" />Deixar evoluindo</button>
      <button type="button" class="btn btn-primary" (click)="dialogs.newTask({ projectSlug: slug() })"><app-icon name="plus" [size]="18" />Nova tarefa</button>
    </div>

    @for (t of turns.running(); track t.id) {
      <div class="mt-4 flex items-center gap-3 rounded-2xl border border-[#B48CFF]/40 bg-[#B48CFF]/10 px-4 py-2.5 text-[13.5px]">
        <app-icon name="night" [size]="18" class="text-[#B48CFF]" />
        <span>Turno em <b>{{ projects.bySlug().get(t.projectSlug)?.name }}</b>: {{ t.succeeded }} de {{ t.runs }} concluídas,
          até {{ t.until.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }}</span>
        <button type="button" class="ml-auto text-no hover:underline" (click)="turns.stop(t.id)">Parar</button>
      </div>
    }
    @if (tasks.error()) { <p role="alert" class="mt-3 text-no">{{ tasks.error() }}</p> }

    <app-kanban-board class="mt-5 min-h-0 flex-1" [projectSlug]="slug()" />`,
})
export class BacklogPage {
  protected readonly projects = inject(ProjectsService);
  protected readonly tasks = inject(TasksService);
  protected readonly turns = inject(TurnsService);
  protected readonly dialogs = inject(DialogsService);
  private readonly router = inject(Router);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);

  protected readonly slug = computed(() => this.query()?.get('projeto') || null);
  protected readonly project = computed(() => (this.slug() ? this.projects.bySlug().get(this.slug()!) ?? null : null));
  protected readonly open = computed(() => this.tasks.tasks().filter(t =>
    t.column !== 'done' && (this.slug() ? t.projectSlug === this.slug() : this.projects.bySlug().get(t.projectSlug)?.status !== 'dead')).length);

  protected filter(slug: string): void {
    this.router.navigate([], { queryParams: { projeto: slug || null } });
  }
}

import { Component, ElementRef, computed, effect, inject, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { DialogsService } from '../../../../shared/services/dialogs/dialogs.service';
import { ProjectsService } from '../../../../shared/services/projects/projects.service';
import { RUN_STATUS_LABEL, Run, RunStatus, isActive } from '../../../../shared/services/runs/runs.model';
import { RunsService } from '../../../../shared/services/runs/runs.service';
import { AgoPipe } from '../../../../shared/ui/ago.pipe';
import { Icon } from '../../../../shared/ui/icon';
import { MdLitePipe } from '../../../../shared/ui/md-lite.pipe';

const DOT: Record<RunStatus, string> = {
  queued: 'bg-faint', preparing: 'bg-later', running: 'bg-yes', succeeded: 'bg-yes', failed: 'bg-no', killed: 'bg-faint',
};

@Component({
  selector: 'app-agents-page',
  imports: [RouterLink, Icon, AgoPipe, MdLitePipe],
  templateUrl: './agents-page.html',
  host: { class: 'grid h-full grid-cols-[360px_minmax(0,1fr)]' },
})
export class AgentsPage {
  protected readonly runs = inject(RunsService);
  protected readonly projects = inject(ProjectsService);
  protected readonly dialogs = inject(DialogsService);
  private readonly router = inject(Router);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');

  protected readonly statusLabel = RUN_STATUS_LABEL;
  protected readonly dot = DOT;
  protected readonly isActive = isActive;

  protected readonly filter = computed(() => this.query()?.get('projeto') ?? null);
  protected readonly list = computed(() => {
    const f = this.filter();
    return f ? this.runs.runs().filter(r => r.projectSlug === f) : this.runs.runs();
  });
  protected readonly selected = computed<Run | null>(() => {
    const id = Number(this.query()?.get('run'));
    return this.runs.runs().find(r => r.id === id) ?? this.list()[0] ?? null;
  });
  /** a última fala do agente costuma repetir o resultado; mostra só o resultado */
  protected readonly events = computed(() => {
    const r = this.selected();
    const list = r ? this.runs.eventsOf(r.id)() : [];
    return list.filter((e, i) => !(e.kind === 'text' && list[i + 1]?.kind === 'result' && list[i + 1].text === e.text));
  });
  protected readonly elapsed = computed(() => {
    const r = this.selected();
    if (!r?.startedAt) return null;
    const ms = (r.finishedAt ?? new Date()).getTime() - r.startedAt.getTime();
    const min = Math.round(ms / 60000);
    return min < 1 ? 'menos de 1 min' : `${min} min`;
  });

  constructor() {
    // log sempre no fim quando chega evento novo
    effect(() => {
      this.events();
      const el = this.log()?.nativeElement;
      if (el) queueMicrotask(() => el.scrollTo({ top: el.scrollHeight }));
    });
  }

  protected select(r: Run): void {
    this.router.navigate([], { queryParams: { run: r.id }, queryParamsHandling: 'merge' });
  }

  protected project(slug: string) {
    return this.projects.bySlug().get(slug) ?? null;
  }

  protected openWorktree(r: Run): void {
    if (r.worktreePath) this.projects.openInVsCode(r.worktreePath);
  }

  protected openPr(r: Run): void {
    if (r.prUrl) this.projects.openExternal(r.prUrl);
  }

  protected time(d: Date): string {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}

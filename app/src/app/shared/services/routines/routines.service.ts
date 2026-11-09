import { Injectable, inject, signal } from '@angular/core';

import { NewRoutineInput, RoutineDto, RunPermission, RunSize, RunStatus, ScheduleKind } from '../../contract';
import { errorMessage } from '../ipc/ipc.service';
import { RoutinesApiService } from './routines-api.service';

export interface Routine {
  id: number;
  name: string;
  agentId: number | null;
  /** agent = um agente faz; command = roda um comando no terminal, sem Claude */
  kind: 'agent' | 'command';
  shell: string;
  onFailAgent: number | null;
  /** intervalo em minutos (tem prioridade sobre intervalHours) */
  intervalMinutes: number | null;
  projectSlug: string | null;
  repoPath: string | null;
  prompt: string;
  permission: RunPermission;
  size: RunSize;
  scheduleKind: ScheduleKind;
  days: number[];
  time: string;
  intervalHours: number;
  maxSession: number;
  enabled: boolean;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastSkipped: string | null;
  lastStatus: RunStatus | null;
  lastRunId: number | null;
  runCount: number;
}

export type RoutineDraft = Omit<Routine, 'id' | 'nextRunAt' | 'lastRunAt' | 'lastSkipped' | 'lastStatus' | 'lastRunId' | 'runCount'>;

const toModel = (d: RoutineDto): Routine => ({
  id: d.id, name: d.name, agentId: d.agent_id, kind: d.kind ?? 'agent', shell: d.shell ?? '', onFailAgent: d.on_fail_agent ?? null, intervalMinutes: d.interval_minutes ?? null, projectSlug: d.project_slug, repoPath: d.repo_path, prompt: d.prompt, permission: d.permission,
  size: d.size, scheduleKind: d.schedule_kind, days: d.days, time: d.time, intervalHours: d.interval_hours, maxSession: d.max_session,
  enabled: d.enabled, nextRunAt: new Date(d.next_run_at), lastRunAt: d.last_run_at ? new Date(d.last_run_at) : null,
  lastSkipped: d.last_skipped, lastStatus: d.last_status, lastRunId: d.last_run_id, runCount: d.run_count,
});

const toInput = (r: RoutineDraft): NewRoutineInput => ({
  name: r.name, agent_id: r.agentId, project_slug: r.projectSlug, repo_path: r.repoPath, prompt: r.prompt, permission: r.permission, size: r.size,
  schedule_kind: r.scheduleKind, days: r.days, time: r.time, interval_hours: r.intervalHours, max_session: r.maxSession, enabled: r.enabled,
  kind: r.kind, shell: r.shell, on_fail_agent: r.onFailAgent, interval_minutes: r.intervalMinutes,
});

const DAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "Dias úteis às 08:00", "Todo dia às 02:00", "seg e qui às 09:30", "A cada 6 h" */
export function describeSchedule(r: Pick<Routine, 'scheduleKind' | 'days' | 'time' | 'intervalHours'> & { intervalMinutes?: number | null }): string {
  if (r.scheduleKind === 'interval') return r.intervalMinutes ? `A cada ${r.intervalMinutes} min` : `A cada ${r.intervalHours} h`;
  const d = [...r.days].sort();
  const when = d.length === 7 || !d.length ? 'Todo dia' : d.join() === '1,2,3,4,5' ? 'Dias úteis' : d.join() === '0,6' ? 'Fins de semana'
    : d.map(x => DAY[x]).join(', ').replace(/, ([^,]+)$/, ' e $1');
  return `${when[0].toUpperCase()}${when.slice(1)} às ${r.time}`;
}

@Injectable({ providedIn: 'root' })
export class RoutinesService {
  private readonly api = inject(RoutinesApiService);

  readonly routines = signal<Routine[]>([]);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    this.api.onChanged(() => this.load());
    this.load();
  }

  load(): void {
    this.api.list().then(list => { this.routines.set(list.map(toModel)); this.loaded.set(true); });
  }

  async save(id: number | null, draft: RoutineDraft): Promise<void> {
    try {
      if (id) await this.api.update(id, toInput(draft));
      else await this.api.create(toInput(draft));
      this.load();
    } catch (e) {
      throw new Error(errorMessage(e));
    }
  }

  toggle(r: Routine): void {
    this.routines.update(list => list.map(x => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)));
    this.api.update(r.id, { enabled: !r.enabled }).then(() => this.load()).catch(e => { this.error.set(errorMessage(e)); this.load(); });
  }

  async fire(r: Routine): Promise<number | null> {
    try {
      return await this.api.fire(r.id);
    } catch (e) {
      this.error.set(errorMessage(e));
      return null;
    }
  }

  remove(r: Routine): void {
    this.routines.update(list => list.filter(x => x.id !== r.id));
    this.api.remove(r.id).catch(e => { this.error.set(errorMessage(e)); this.load(); });
  }
}

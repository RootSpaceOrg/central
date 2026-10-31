import { Injectable, computed, inject, signal } from '@angular/core';

import { IdeaDto, IdeaStatus, ImportResultDto } from '../../contract';
import { errorMessage } from '../ipc/ipc.service';
import { IdeasApiService } from './ideas-api.service';

export type { IdeaStatus };

export interface Idea {
  id: number;
  projectSlug: string | null;
  title: string;
  body: string | null;
  status: IdeaStatus;
  source: string;
  sourceRef: string;
  taskId: number | null;
  createdAt: Date;
}

export const IDEA_SOURCE_LABEL: Record<string, string> = {
  manual: 'anotada por você', memory: 'das memórias do Claude', doc: 'de um roadmap',
};

const toModel = (d: IdeaDto): Idea => ({
  id: d.id, projectSlug: d.project_slug, title: d.title, body: d.body, status: d.status,
  source: d.source, sourceRef: d.source_ref, taskId: d.task_id, createdAt: new Date(d.created_at),
});

@Injectable({ providedIn: 'root' })
export class IdeasService {
  private readonly api = inject(IdeasApiService);

  readonly ideas = signal<Idea[]>([]);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly fresh = computed(() => this.ideas().filter(i => i.status === 'new'));

  constructor() {
    this.api.onChanged(() => this.load());
    this.load();
  }

  load(): void {
    this.api.list()
      .then(list => { this.ideas.set(list.map(toModel)); this.loaded.set(true); })
      .catch(e => this.error.set(errorMessage(e)));
  }

  async create(title: string, body: string, projectSlug: string | null): Promise<void> {
    await this.api.create({ title, body: body || null, project_slug: projectSlug });
  }

  setProject(id: number, projectSlug: string | null): void {
    this.patch(id, { projectSlug });
    this.api.update(id, { project_slug: projectSlug }).catch(e => this.error.set(errorMessage(e)));
  }

  archive(id: number, archived: boolean): void {
    const status: IdeaStatus = archived ? 'archived' : 'new';
    this.patch(id, { status });
    this.api.update(id, { status }).catch(e => this.error.set(errorMessage(e)));
  }

  async promote(id: number, projectSlug: string): Promise<void> {
    try {
      await this.api.promote(id, projectSlug);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async importPending(): Promise<ImportResultDto> {
    return this.api.importPending();
  }

  private patch(id: number, p: Partial<Idea>): void {
    this.ideas.update(list => list.map(i => (i.id === id ? { ...i, ...p } : i)));
  }
}

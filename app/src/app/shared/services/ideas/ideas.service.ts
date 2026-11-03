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
  /** 'gustavo' ou o agente que sugeriu */
  author: string;
  approvedAt: Date | null;
  /** marco do roadmap que a ideia serve */
  milestoneId: number | null;
  tasks: number;
  tasksDone: number;
  /** quando o agente de triagem pegou a ideia */
  triagedAt: Date | null;
  /** recomendação dele: "aprovar e planejar — motivo" */
  triage: string | null;
}

/** Ciclo de vida: nova (triagem) → aprovada (insumo do backlog) → em andamento (tem tarefas) → feita; ou descartada. */
export const IDEA_STATUS: { id: IdeaStatus; label: string; hint: string }[] = [
  { id: 'new', label: 'Para triar', hint: 'Esperando você aprovar ou descartar.' },
  { id: 'approved', label: 'Aprovadas', hint: 'Insumo do backlog: o gestor do projeto quebra em tarefas.' },
  { id: 'doing', label: 'Em andamento', hint: 'Já viraram tarefas; terminam quando as tarefas terminam.' },
  { id: 'done', label: 'Feitas', hint: 'Todas as tarefas ligadas chegaram em Feito.' },
  { id: 'archived', label: 'Descartadas', hint: 'Fora do rumo. Dá para trazer de volta.' },
];

export const IDEA_SOURCE_LABEL: Record<string, string> = {
  manual: 'anotada por você', memory: 'das memórias do Claude', doc: 'de um roadmap', central: 'de um agente',
};

const toModel = (d: IdeaDto): Idea => ({
  id: d.id, projectSlug: d.project_slug, title: d.title, body: d.body, status: d.status,
  source: d.source, sourceRef: d.source_ref, taskId: d.task_id, createdAt: new Date(d.created_at),
  // ideias antigas criadas por agentes (pela Central) não guardavam o autor
  author: d.author && !(d.author === 'gustavo' && d.source === 'central') ? d.author : d.source === 'central' ? 'agente' : 'gustavo', approvedAt: d.approved_at ? new Date(d.approved_at) : null, milestoneId: d.milestone_id ?? null, tasks: d.tasks ?? 0, tasksDone: d.tasks_done ?? 0,
  triagedAt: d.triaged_at ? new Date(d.triaged_at) : null, triage: d.triage ?? null,
});

@Injectable({ providedIn: 'root' })
export class IdeasService {
  private readonly api = inject(IdeasApiService);

  readonly ideas = signal<Idea[]>([]);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  /** esperando triagem */
  readonly fresh = computed(() => this.ideas().filter(i => i.status === 'new'));
  /** aprovadas que ainda não viraram tarefa: o que o gestor do projeto tem para quebrar */
  readonly waiting = computed(() => this.ideas().filter(i => i.status === 'approved' && !i.tasks));

  constructor() {
    this.api.onChanged(() => this.load());
    this.load();
  }

  load(): void {
    this.api.list()
      .then(list => { this.ideas.set(list.map(toModel)); this.loaded.set(true); })
      .catch(e => this.error.set(errorMessage(e)));
  }

  of(slug: string, status?: IdeaStatus): Idea[] {
    return this.ideas().filter(i => i.projectSlug === slug && (!status || i.status === status));
  }

  async create(title: string, body: string, projectSlug: string | null): Promise<void> {
    await this.api.create({ title, body: body || null, project_slug: projectSlug });
  }

  setProject(id: number, projectSlug: string | null): void {
    this.patch(id, { projectSlug });
    this.api.update(id, { project_slug: projectSlug }).catch(e => this.error.set(errorMessage(e)));
  }

  /** Aprovar exige projeto (a ideia vira insumo do backlog dele). Lança o erro para quem chamou mostrar. */
  async approve(id: number, projectSlug?: string | null): Promise<void> {
    try {
      await this.api.update(id, { status: 'approved', ...(projectSlug ? { project_slug: projectSlug } : {}) });
      this.patch(id, { status: 'approved', ...(projectSlug ? { projectSlug } : {}) });
    } catch (e) {
      throw new Error(errorMessage(e));
    }
  }

  /** liga a ideia a um marco do roadmap (null desliga) */
  setMilestone(id: number, milestoneId: number | null): void {
    this.patch(id, { milestoneId });
    this.api.update(id, { milestone_id: milestoneId }).catch(e => { this.error.set(errorMessage(e)); this.load(); });
  }

  setStatus(id: number, status: IdeaStatus): void {
    this.patch(id, { status });
    this.api.update(id, { status }).catch(e => { this.error.set(errorMessage(e)); this.load(); });
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

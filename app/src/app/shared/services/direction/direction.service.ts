import { Injectable, inject, signal } from '@angular/core';

import { DirectionDto } from '../../contract';
import { errorMessage } from '../ipc/ipc.service';
import { DirectionApiService } from './direction-api.service';

export interface Direction { id: number; text: string; author: string; note: string | null; at: Date }

const toModel = (d: DirectionDto): Direction => ({ id: d.id, text: d.text, author: d.author, note: d.note, at: new Date(d.created_at) });

/** Modelo para o primeiro rumo de um projeto. */
export const DIRECTION_TEMPLATE = `**Objetivo:** onde o projeto precisa chegar (em uma frase).

**Foco agora:** o que importa nas próximas semanas.

**Não fazer:** o que está fora do rumo ou não pode ser mexido.

**Próximos marcos:**
- …`;

/** Rumo de cada projeto (para onde vamos) e o gestor do projeto, que organiza o backlog a partir dele quando você pede. */
@Injectable({ providedIn: 'root' })
export class DirectionService {
  private readonly api = inject(DirectionApiService);

  /** rumo atual por projeto (null = ainda não escrito) */
  readonly bySlug = signal<Record<string, Direction | null>>({});
  readonly planning = signal<Record<string, boolean>>({});

  constructor() {
    this.api.onChanged(() => { for (const slug of Object.keys(this.bySlug())) this.load(slug); });
  }

  load(slug: string): void {
    this.api.get(slug).then(d => this.bySlug.update(m => ({ ...m, [slug]: d ? toModel(d) : null })));
  }

  /** Garante que o rumo do projeto está carregado (para listas como o Início). */
  ensure(slug: string): void { if (!(slug in this.bySlug())) this.load(slug); }

  async history(slug: string): Promise<Direction[]> { return (await this.api.history(slug)).map(toModel); }

  async save(slug: string, text: string, note: string | null): Promise<void> {
    try {
      const d = await this.api.set(slug, text, note);
      this.bySlug.update(m => ({ ...m, [slug]: toModel(d) }));
    } catch (e) {
      throw new Error(errorMessage(e));
    }
  }

  /** Gestor do projeto: organiza o backlog a partir do rumo e das ideias aprovadas. Devolve o id da execução. */
  async plan(slug: string, request: string | null = null): Promise<number> {
    this.planning.update(m => ({ ...m, [slug]: true }));
    try {
      return (await this.api.plan(slug, request)).id;
    } catch (e) {
      throw new Error(errorMessage(e));
    } finally {
      this.planning.update(m => ({ ...m, [slug]: false }));
    }
  }
}

import { Injectable, computed, inject, signal } from '@angular/core';

import { SessionsService } from '../../../../shared/services/sessions/sessions.service';
import { SettingsApiService } from '../../../../shared/services/settings/settings-api.service';
import { GridNode, TEMPLATES, leaves, newId, prune } from './grid-tree';

/** Preset de janela de trabalho: um nome e a árvore de painéis (com as sessões de qualquer projeto). */
export interface GridPreset { id: string; name: string; root: GridNode }

const KEY = 'grids';

/** Grades salvas (nas configurações locais). Toda mudança salva sozinha, um instante depois. */
@Injectable({ providedIn: 'root' })
export class GridsService {
  private readonly settings = inject(SettingsApiService);
  private readonly sessions = inject(SessionsService);
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  readonly presets = signal<GridPreset[]>([]);
  readonly activeId = signal<string | null>(null);
  readonly loaded = signal(false);
  readonly active = computed<GridPreset | null>(() => this.presets().find(p => p.id === this.activeId()) ?? this.presets()[0] ?? null);
  /** painel sendo arrastado (para mostrar onde soltar) */
  readonly dragging = signal<string | null>(null);
  /** sessões que já estão em algum painel da grade ativa */
  readonly placed = computed(() => new Set(this.active() ? leaves(this.active()!.root).map(l => l.sessionId) : []));

  constructor() {
    this.settings.get(KEY).then(raw => {
      const saved = raw ? JSON.parse(raw) as { active: string; list: GridPreset[] } : null;
      if (saved?.list.length) { this.presets.set(saved.list); this.activeId.set(saved.active); }
      else this.create('Minha grade', 'two');
      this.loaded.set(true);
    });
  }

  /** Muda a árvore da grade ativa. */
  update(fn: (root: GridNode) => GridNode): void {
    const p = this.active();
    if (!p) return;
    this.presets.update(list => list.map(x => (x.id === p.id ? { ...x, root: fn(x.root) } : x)));
    this.save();
  }

  /** Sessões fechadas em outro lugar viram painel vazio. */
  prune(): void {
    if (!this.sessions.loaded()) return;
    const ids = this.sessions.byId();
    const p = this.active();
    if (p && leaves(p.root).some(l => l.sessionId !== null && !ids.has(l.sessionId))) this.update(r => prune(r, id => ids.has(id)));
  }

  create(name: string, template: string): void {
    const make = TEMPLATES.find(t => t.id === template)?.make ?? TEMPLATES[0].make;
    const p: GridPreset = { id: newId(), name: name.trim() || 'Grade', root: make() };
    this.presets.update(list => [...list, p]);
    this.activeId.set(p.id);
    this.save();
  }

  /** Cópia da grade ativa (mesmos painéis e sessões), para variar sem perder a original. */
  duplicate(): void {
    const p = this.active();
    if (!p) return;
    const copy: GridPreset = { id: newId(), name: `${p.name} (cópia)`, root: structuredClone(p.root) };
    this.presets.update(list => [...list, copy]);
    this.activeId.set(copy.id);
    this.save();
  }

  select(id: string): void { this.activeId.set(id); this.save(); }

  rename(id: string, name: string): void {
    if (!name.trim()) return;
    this.presets.update(list => list.map(p => (p.id === id ? { ...p, name: name.trim() } : p)));
    this.save();
  }

  /** Apagar a grade não fecha as sessões: elas continuam nas abas dos projetos. */
  remove(id: string): void {
    this.presets.update(list => list.filter(p => p.id !== id));
    if (!this.presets().length) this.create('Minha grade', 'two');
    else if (this.activeId() === id) this.activeId.set(this.presets()[0].id);
    this.save();
  }

  private save(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.settings.set(KEY, JSON.stringify({ active: this.active()?.id, list: this.presets() })), 400);
  }
}

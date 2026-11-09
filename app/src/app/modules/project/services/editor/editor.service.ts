import { Injectable, inject, signal } from '@angular/core';

import { errorMessage } from '../../../../shared/services/ipc/ipc.service';
import { FilesApiService } from '../files/files-api.service';
import { Monaco, loadMonaco } from '../monaco/monaco-loader';

import { AskService } from '../../../../shared/services/ask/ask.service';
export interface EditorTab {
  path: string;
  name: string;
  dirty: boolean;
  /** quando o arquivo não abre no editor (binário, grande) */
  unavailable: string | null;
}

interface Doc { model: any; savedVersion: number }

/** Abas abertas por projeto. Sobrevive à troca de tela: os modelos do Monaco ficam em memória. */
@Injectable({ providedIn: 'root' })
export class EditorService {
  private readonly ask = inject(AskService);
  private readonly files = inject(FilesApiService);
  private readonly docs = new Map<string, Doc>();

  readonly tabs = signal<Record<string, EditorTab[]>>({});
  readonly active = signal<Record<string, string | null>>({});
  readonly error = signal<string | null>(null);

  tabsOf(slug: string): EditorTab[] { return this.tabs()[slug] ?? []; }
  activeOf(slug: string): string | null { return this.active()[slug] ?? null; }

  async open(slug: string, path: string): Promise<void> {
    if (!this.tabsOf(slug).some(t => t.path === path)) {
      const name = path.split(/[\\/]/).pop()!;
      let unavailable: string | null = null;
      if (!this.docs.has(path)) {
        try {
          const file = await this.files.read(path);
          if (file.content === null) unavailable = file.reason;
          else await this.createDoc(path, file.content);
        } catch (e) {
          unavailable = errorMessage(e);
        }
      }
      this.tabs.update(all => ({ ...all, [slug]: [...this.tabsOf(slug), { path, name, dirty: false, unavailable }] }));
    }
    this.active.update(a => ({ ...a, [slug]: path }));
  }

  model(path: string): any | null { return this.docs.get(path)?.model ?? null; }

  async save(slug: string, path: string): Promise<void> {
    const doc = this.docs.get(path);
    if (!doc) return;
    try {
      await this.files.write(path, doc.model.getValue());
      doc.savedVersion = doc.model.getAlternativeVersionId();
      this.setDirty(slug, path, false);
      this.error.set(null);
    } catch (e) {
      this.error.set(`Não salvou ${path.split(/[\\/]/).pop()}: ${errorMessage(e)}`);
    }
  }

  async close(slug: string, path: string): Promise<void> {
    const tab = this.tabsOf(slug).find(t => t.path === path);
    if (tab?.dirty && !(await this.ask.confirm(`Fechar ${tab.name}?`, { message: 'Tem mudanças não salvas; elas se perdem.', confirmLabel: 'Fechar sem salvar', danger: true }))) return;
    const rest = this.tabsOf(slug).filter(t => t.path !== path);
    this.tabs.update(all => ({ ...all, [slug]: rest }));
    if (this.activeOf(slug) === path) this.active.update(a => ({ ...a, [slug]: rest.at(-1)?.path ?? null }));
    if (!Object.values(this.tabs()).some(list => list.some(t => t.path === path))) {
      this.docs.get(path)?.model.dispose();
      this.docs.delete(path);
    }
  }

  private async createDoc(path: string, content: string): Promise<void> {
    const monaco: Monaco = await loadMonaco();
    const model = monaco.editor.createModel(content, undefined, monaco.Uri.file(path));
    const doc: Doc = { model, savedVersion: model.getAlternativeVersionId() };
    model.onDidChangeContent(() => {
      const dirty = model.getAlternativeVersionId() !== doc.savedVersion;
      for (const slug of Object.keys(this.tabs())) this.setDirty(slug, path, dirty);
    });
    this.docs.set(path, doc);
  }

  private setDirty(slug: string, path: string, dirty: boolean): void {
    const list = this.tabsOf(slug);
    if (!list.some(t => t.path === path && t.dirty !== dirty)) return;
    this.tabs.update(all => ({ ...all, [slug]: list.map(t => (t.path === path ? { ...t, dirty } : t)) }));
  }
}

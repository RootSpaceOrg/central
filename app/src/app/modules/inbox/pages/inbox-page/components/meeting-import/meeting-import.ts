import { Component, ElementRef, signal, viewChild, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ProjectSelect } from '../../../../../../shared/components/pickers/project-select';
import { errorMessage } from '../../../../../../shared/services/ipc/ipc.service';
import { Icon } from '../../../../../../shared/ui/icon';
import { InsightsApiService } from '../../../../services/insights/insights-api.service';

/**
 * Reunião → insights: cole a transcrição ou escolha o áudio/vídeo/texto. Um agente lê, ignora a conversa solta e entrega o
 * que importa ao dono de cada projeto (sem dono ligado, vira ideia aqui na Triagem).
 */
@Component({
  selector: 'app-meeting-import',
  imports: [Icon, ProjectSelect, RouterLink],
  template: `
    <button type="button" class="flex items-center gap-2 rounded-full border border-edge bg-panel px-3.5 py-1.5 text-[13px] hover:border-faint" (click)="open()">
      <app-icon name="mic" [size]="14" class="text-[#C6A6FF]" />Reunião</button>

    <dialog #dlg (close)="reset()" aria-labelledby="mt-title" class="m-auto w-[min(720px,94vw)] rounded-3xl border border-edge bg-panel p-0 text-text shadow-2xl">
      <form (submit)="send($event, false)" class="flex max-h-[88vh] flex-col">
        <header class="flex items-center gap-3 border-b border-edge px-6 py-4">
          <h2 id="mt-title" class="mr-auto font-display text-xl font-semibold">Trazer uma reunião</h2>
          <button type="button" class="btn btn-ghost !p-2" (click)="close()" aria-label="Fechar"><app-icon name="close" /></button>
        </header>
        <div class="space-y-4 overflow-y-auto px-6 py-5">
          @if (started(); as id) {
            <div class="rounded-2xl border border-yes/40 bg-yes/5 px-5 py-4 text-[14px]">
              <p class="font-semibold text-yes">Lendo a reunião.</p>
              <p class="mt-1 text-mute">O agente separa o que importa e entrega ao dono de cada projeto. Brincadeira e conversa solta ficam de fora; o que mexe com rumo, preço, dados ou clientes chega aqui na Triagem.</p>
              <a routerLink="/execucoes" [queryParams]="{ run: id }" (click)="close()" class="mt-2 inline-block text-frost hover:underline">Acompanhar a leitura</a>
            </div>
          } @else {
            <p class="text-[13.5px] leading-relaxed text-mute">O agente lê, ignora a conversa solta e entrega o que importa ao <b class="text-text">dono de cada projeto</b>. Pequeno e dentro do rumo, o dono resolve; impactante, vem para você.</p>
            <label class="block">
              <span class="mb-1.5 block text-[12.5px] font-semibold text-mute">Que reunião foi</span>
              <input class="field" placeholder="ex.: Coordenação Sistemática, 11/11" [value]="title()" (input)="title.set($any($event.target).value)" />
            </label>
            <div>
              <span class="mb-1.5 block text-[12.5px] font-semibold text-mute">Projeto (opcional)</span>
              <app-project-select [value]="slug()" (valueChange)="slug.set($event)" noneLabel="Vários / não sei" />
            </div>
            <label class="block">
              <span class="mb-1.5 block text-[12.5px] font-semibold text-mute">Transcrição</span>
              <textarea class="field h-56 resize-y text-[13.5px] leading-relaxed" placeholder="Cole a transcrição (Meet, Zoom, Teams, anotações)…" [value]="text()" (input)="text.set($any($event.target).value)"></textarea>
            </label>
          }
          @if (error()) { <p role="alert" class="text-[13px] text-no">{{ error() }}</p> }
        </div>
        @if (!started()) {
          <footer class="flex flex-wrap items-center gap-2 border-t border-edge px-6 py-3.5">
            <button type="button" class="btn" [disabled]="busy()" (click)="send($event, true)" title="Áudio ou vídeo usa a extensão Transcrição; .txt, .vtt e .srt vão direto">
              <app-icon name="folder" [size]="15" />{{ busy() === 'file' ? 'Transcrevendo…' : 'Escolher áudio, vídeo ou texto' }}</button>
            <span class="flex-1"></span>
            <button type="button" class="btn btn-ghost" (click)="close()">Cancelar</button>
            <button class="btn btn-primary" [disabled]="!!busy() || !text().trim()">{{ busy() === 'text' ? 'Enviando…' : 'Ler a transcrição' }}</button>
          </footer>
        }
      </form>
    </dialog>`,
})
export class MeetingImport {
  private readonly api = inject(InsightsApiService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  protected readonly title = signal('');
  protected readonly slug = signal('');
  protected readonly text = signal('');
  protected readonly busy = signal<'file' | 'text' | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly started = signal<number | null>(null);

  protected open(): void { this.dlg().nativeElement.showModal(); }
  protected close(): void { this.dlg().nativeElement.close(); }
  protected reset(): void { this.title.set(''); this.text.set(''); this.slug.set(''); this.error.set(null); this.started.set(null); this.busy.set(null); }

  protected async send(e: Event, file: boolean): Promise<void> {
    e.preventDefault();
    if (!file && !this.text().trim()) return;
    this.busy.set(file ? 'file' : 'text');
    this.error.set(null);
    try {
      const id = await this.api.meeting({ title: this.title().trim() || 'Reunião', text: file ? null : this.text(), file, project_slug: this.slug() || null });
      if (id) this.started.set(id);
    } catch (err) { this.error.set(errorMessage(err)); }
    finally { this.busy.set(null); }
  }
}

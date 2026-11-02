import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';

import { AutopilotMode } from '../../contract';
import { DialogsService } from '../../services/dialogs/dialogs.service';
import { ProjectsService } from '../../services/projects/projects.service';
import { PULSE_LABEL, PulseService } from '../../services/pulse/pulse.service';
import { AgoPipe } from '../../ui/ago.pipe';
import { Icon, IconName } from '../../ui/icon';
import { ProjectAvatar } from '../../ui/project-avatar';

const MODES: { id: AutopilotMode; title: string; text: string; icon: IconName; tag?: string }[] = [
  { id: 'tasks', title: 'Só o que eu aprovei', icon: 'kanban',
    text: 'Executa as tarefas de "A fazer". Sem tarefa, abre uma decisão perguntando o próximo passo.' },
  { id: 'plan', title: 'Propor e eu aprovo', icon: 'inbox', tag: 'recomendado',
    text: 'Sem tarefa, um agente lê o código, o backlog e as ideias e propõe até 3 tarefas como decisões. Você aprova de manhã; elas rodam na noite seguinte.' },
  { id: 'trust', title: 'Planejar e fazer', icon: 'night',
    text: 'Sem tarefa, as tarefas planejadas já entram em "A fazer" e rodam nas noites seguintes. Você só revisa os PRs.' },
];

const HINTS = [
  'Terminar o que está em revisão antes de abrir frentes novas.',
  'Estabilidade e bugs antes de features.',
  'Foco no fluxo de cadastro e onboarding.',
  'Não mexer em pagamentos, infra nem migrações de banco.',
  'Escrever testes onde faltam, sem mudar comportamento.',
];

/** Ligar o piloto automático de um projeto dizendo para onde ele deve levar o projeto. */
@Component({
  selector: 'app-autopilot-dialog',
  imports: [Icon, ProjectAvatar, AgoPipe],
  template: `
    <dialog #dlg (close)="dialogs.autopilot.set(null)" aria-labelledby="ap-title"
            class="m-auto max-h-[92vh] w-[min(720px,94vw)] overflow-y-auto rounded-3xl border border-edge bg-panel p-0 text-text shadow-2xl">
      @if (project(); as p) {
        <header class="flex items-start gap-4 px-8 pt-7 pb-2">
          <app-project-avatar [project]="p" [size]="40" />
          <div class="flex-1">
            <h2 id="ap-title" class="flex items-center gap-2 font-display text-2xl font-semibold">
              Piloto automático
              <span class="rounded-full px-2.5 py-0.5 text-[12px] font-semibold" [class]="p.autopilot ? 'bg-[#B48CFF]/20 text-[#C6A6FF]' : 'bg-edge text-mute'">
                {{ p.autopilot ? 'ligado' : 'desligado' }}</span>
            </h2>
            <p class="mt-0.5 text-mute">{{ p.name }}: de madrugada ({{ pulse.status()?.window ?? '01:00–06:00' }}), um agente leva uma tarefa até um PR rascunho, seguindo a sua direção.</p>
          </div>
          <button type="button" class="btn btn-ghost !p-2" (click)="dialogs.autopilot.set(null)" aria-label="Fechar"><app-icon name="close" /></button>
        </header>

        <section class="px-8 pt-4">
          <label for="ap-brief" class="font-display text-[16px] font-semibold">Para onde levar o projeto?</label>
          <p class="text-[13px] text-mute">Vai em todo prompt do piloto: objetivo, prioridade e o que não pode mexer.</p>
          <textarea id="ap-brief" class="field mt-2 min-h-32 resize-y leading-relaxed" [value]="brief()" (input)="brief.set($any($event.target).value)"
                    placeholder="Ex.: Fechar a Fase 1 de Afiliados (os 6 PRs) e deixar o Instagram estável. Prioridade: o que destrava vendas. Não mexer em pagamentos."></textarea>
          <div class="mt-2 flex flex-wrap gap-1.5">
            @for (h of hints; track h) {
              <button type="button" (click)="addHint(h)" class="rounded-full border border-dashed border-edge px-2.5 py-0.5 text-[12px] text-mute transition hover:border-faint hover:text-text">+ {{ h }}</button>
            }
          </div>
        </section>

        <section class="px-8 pt-6">
          <p class="font-display text-[16px] font-semibold">Quando "A fazer" estiver vazio</p>
          <div class="mt-2 grid gap-2" role="radiogroup" aria-label="Autonomia do piloto">
            @for (m of modes; track m.id) {
              <button type="button" role="radio" [attr.aria-checked]="mode() === m.id" (click)="mode.set(m.id)"
                      class="flex items-start gap-3 rounded-2xl border-2 px-4 py-3 text-left transition"
                      [class]="mode() === m.id ? 'border-[#B48CFF] bg-[#B48CFF]/10' : 'border-edge hover:border-faint'">
                <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl" [class]="mode() === m.id ? 'bg-[#B48CFF]/25 text-[#C6A6FF]' : 'bg-raise text-mute'">
                  <app-icon [name]="m.icon" [size]="16" /></span>
                <span class="flex-1">
                  <span class="flex items-center gap-2 font-semibold">{{ m.title }}
                    @if (m.tag) { <span class="rounded-full bg-yes/15 px-2 py-0.5 text-[11px] font-semibold text-yes">{{ m.tag }}</span> }</span>
                  <span class="mt-0.5 block text-[13px] text-mute">{{ m.text }}</span>
                </span>
              </button>
            }
          </div>
        </section>

        <section class="mx-8 mt-6 rounded-2xl bg-night/60 px-4 py-3 text-[13px] text-mute">
          <p class="font-semibold text-text">Travas</p>
          <ul class="mt-1 list-disc space-y-0.5 pl-5">
            <li>Uma tarefa por noite; nada novo enquanto houver tarefa do projeto em andamento ou revisão.</li>
            <li>Sempre em branch própria até PR rascunho: nunca mergeia, nunca faz push em main/develop.</li>
            <li>Pula a noite se a sessão do Claude estiver em 60% ou a semana em 85%.</li>
          </ul>
          @if (last(); as l) {
            <p class="mt-2">Última passada {{ pulse.status()?.at ?? null | ago }}: <b class="text-text">{{ label[l.action] }}</b>, {{ l.text }}</p>
          }
        </section>

        @if (error()) { <p role="alert" class="mx-8 mt-4 text-[13px] text-no">{{ error() }}</p> }

        <footer class="mt-6 flex items-center gap-2 border-t border-edge px-8 py-4">
          @if (p.autopilot) { <button type="button" class="btn btn-sm btn-ghost !text-no" (click)="save(false)" [disabled]="busy()">Desligar</button> }
          <span class="flex-1"></span>
          <button type="button" class="btn btn-sm" (click)="test()" [disabled]="busy() || !brief().trim()" title="Salva, liga e roda a passada agora (fora da madrugada)">
            <app-icon name="play" [size]="14" />{{ pulse.running() ? 'Rodando…' : 'Rodar agora' }}</button>
          <button type="button" class="btn btn-primary" (click)="save(true)" [disabled]="busy() || !brief().trim()">
            <app-icon name="night" [size]="16" />{{ p.autopilot ? 'Salvar' : 'Ligar o piloto' }}</button>
        </footer>
      }
    </dialog>`,
})
export class AutopilotDialog {
  protected readonly dialogs = inject(DialogsService);
  protected readonly pulse = inject(PulseService);
  private readonly projects = inject(ProjectsService);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  protected readonly modes = MODES;
  protected readonly hints = HINTS;
  protected readonly label = PULSE_LABEL;
  protected readonly brief = signal('');
  protected readonly mode = signal<AutopilotMode>('plan');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly project = computed(() => {
    const slug = this.dialogs.autopilot();
    return slug ? this.projects.bySlug().get(slug) ?? null : null;
  });
  protected readonly last = computed(() => this.pulse.status()?.items.find(i => i.slug === this.project()?.slug) ?? null);

  constructor() {
    effect(() => {
      const open = !!this.dialogs.autopilot();
      const el = this.dlg()?.nativeElement;
      if (!el) return;
      if (open && !el.open) {
        const p = this.project();
        this.brief.set(p?.autopilotBrief ?? '');
        // quem nunca ligou começa no recomendado
        this.mode.set(p?.autopilotBrief ? p.autopilotMode : 'plan');
        this.error.set(null);
        el.showModal();
      }
      if (!open && el.open) el.close();
    });
  }

  protected addHint(h: string): void {
    const cur = this.brief().trim();
    if (!cur.includes(h)) this.brief.set(cur ? `${cur}\n${h}` : h);
  }

  protected async save(on: boolean, close = true): Promise<boolean> {
    const p = this.project();
    if (!p) return false;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.projects.configureAutopilot(p.slug, { on, brief: this.brief(), mode: this.mode() });
      if (close) this.dialogs.autopilot.set(null);
      return true;
    } catch (e) {
      this.error.set((e as Error).message);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async test(): Promise<void> {
    const p = this.project();
    if (!p || !(await this.save(true, false))) return;
    await this.pulse.runNow(p.slug);
    this.error.set(this.pulse.error());
  }
}

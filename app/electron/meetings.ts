/**
 * Reuniões: a Central grava a call (áudio do sistema + microfone e, se pedido, a tela), transcreve ao parar e deixa
 * conversar com um agente sobre ela (a transcrição e os prints da tela entram como contexto).
 * A gravação acontece na tela (MediaRecorder); aqui chegam os pedaços, que vão direto para o disco (se a Central cair no
 * meio, o que já foi gravado fica). Tudo mora em Development/.central-meetings/<id>/, onde os agentes conseguem ler.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ChatMessageDto, MeetingDto } from '../src/app/shared/contract';
import { centralAgent } from './agentdefs';
import { saveMessage, sendChat } from './central-agent';
import { DEV_ROOT, all, get, now, run } from './db';
import { sttStatus, transcribeFile } from './media';

const ROOT = join(DEV_ROOT, '.central-meetings');
const dirOf = (id: number) => join(ROOT, String(id));
const fileOf = (m: { id: number; screen: number }) => join(dirOf(m.id), m.screen ? 'gravacao.webm' : 'audio.webm');

type Notify = (chatId: number, message: ChatMessageDto | null, busy: boolean) => void;

const row = (id: number) => get<MeetingDto & { screen: number }>('select * from meetings where id = ?', id) ?? null;
/** prints da tela (nome = segundos desde o começo) */
const framesOf = (id: number) => {
  const d = join(dirOf(id), 'prints');
  return existsSync(d) ? readdirSync(d).filter(f => f.endsWith('.png')).sort() : [];
};
const dto = (m: MeetingDto & { screen: number }): MeetingDto => ({ ...m, screen: m.screen, frames: framesOf(m.id).length, path: dirOf(m.id) });

export const listMeetings = () => all<MeetingDto & { screen: number }>('select * from meetings order by id desc limit 200').map(dto);
export const getMeeting = (id: number) => { const m = row(id); return m ? dto(m) : null; };

export function startMeeting(title: string, projectSlug: string | null, screen: boolean): MeetingDto {
  if (get(`select 1 from meetings where status = 'recording'`)) throw new Error('Já tem uma reunião sendo gravada.');
  const id = Number(run(`insert into meetings (title, project_slug, screen, status, started_at) values (?,?,?, 'recording', ?)`,
    title.trim() || 'Reunião', projectSlug, screen ? 1 : 0, now()).lastInsertRowid);
  mkdirSync(dirOf(id), { recursive: true });
  return getMeeting(id)!;
}

/** um pedaço da gravação (a cada poucos segundos): vai direto para o arquivo */
export function meetingChunk(id: number, bytes: Uint8Array): void {
  const m = row(id);
  if (!m || m.status !== 'recording') return;
  appendFileSync(fileOf(m), Buffer.from(bytes));
}

/** print da tela compartilhada (só quando a tela mudou); o nome guarda o momento, para citar "aos 12:30" */
export function meetingFrame(id: number, seconds: number, png: Uint8Array): void {
  const m = row(id);
  if (!m || m.status !== 'recording') return;
  const d = join(dirOf(id), 'prints');
  mkdirSync(d, { recursive: true });
  const t = Math.max(0, Math.round(seconds));
  writeFileSync(join(d, `${String(Math.floor(t / 60)).padStart(3, '0')}m${String(t % 60).padStart(2, '0')}s.png`), Buffer.from(png));
}

/** parou: transcreve (se a extensão estiver pronta) e avisa a tela a cada mudança */
export async function stopMeeting(id: number, seconds: number, changed: () => void): Promise<void> {
  const m = row(id);
  if (!m) throw new Error('Reunião não encontrada.');
  run(`update meetings set status = 'transcribing', ended_at = ?, duration = ? where id = ?`, now(), Math.round(seconds), id);
  changed();
  const file = fileOf(m);
  if (!existsSync(file) || statSync(file).size < 1000) {
    run(`update meetings set status = 'failed', error = ? where id = ?`, 'A gravação ficou vazia (o áudio não foi capturado).', id);
    return changed();
  }
  await transcribe(id, changed);
}

export async function transcribe(id: number, changed: () => void): Promise<void> {
  const m = row(id);
  if (!m) return;
  if (!sttStatus().ready) {
    run(`update meetings set status = 'recorded', error = ? where id = ?`, 'Para transcrever, instale e prepare a extensão Transcrição (Extensões) e clique em "Transcrever".', id);
    return changed();
  }
  run(`update meetings set status = 'transcribing', error = null where id = ?`, id);
  changed();
  try {
    // reunião longa no whisper local demora: até 3 h de processamento
    const r = await transcribeFile(fileOf(m), 3 * 3600_000);
    writeFileSync(join(dirOf(id), 'transcricao.txt'), r.text);
    run(`update meetings set status = 'ready', transcript = ? where id = ?`, r.text, id);
  } catch (e) {
    run(`update meetings set status = 'recorded', error = ? where id = ?`, `Não deu para transcrever: ${(e as Error).message.slice(0, 300)}`, id);
  }
  changed();
}

/** contexto que o agente recebe (escondido) na primeira pergunta sobre a reunião */
function context(m: MeetingDto & { screen: number }): string {
  const frames = framesOf(m.id);
  const project = m.project_slug ? get<{ name: string }>('select name from projects where slug = ?', m.project_slug)?.name : null;
  return `[Reunião #${m.id}] "${m.title}"${project ? ` · projeto ${project} (slug ${m.project_slug})` : ''} · ${m.started_at.slice(0, 16).replace('T', ' ')} · ${Math.round((m.duration ?? 0) / 60)} min.
O Gustavo gravou esta reunião na Central e vai te pedir coisas sobre ela. Use o que foi dito (e mostrado) como fonte; quando
citar algo, diga quando foi dito se der. Não invente o que não está na transcrição: se faltar, diga que faltou.
${frames.length ? `\nPrints da tela compartilhada (o nome é o momento da reunião; abra os que importarem com a ferramenta de ler arquivos):\n${frames.map(f => `- ${join(dirOf(m.id), 'prints', f)}`).join('\n')}\n` : ''}
Pastas: gravação e arquivos em ${dirOf(m.id)}.

Transcrição:
${m.transcript ?? '(sem transcrição)'}`;
}

/** um pedido sobre a reunião: a primeira vez abre a conversa (com o contexto escondido); depois continua nela */
export function askMeeting(id: number, text: string, agentId: number | null, notify: Notify, changed: () => void): number {
  const m = row(id);
  if (!m) throw new Error('Reunião não encontrada.');
  if (!m.transcript) throw new Error('A reunião ainda não tem transcrição.');
  const t = text.trim();
  if (!t) throw new Error('Escreva o que você quer.');
  const agent = agentId ?? centralAgent().id;
  if (m.chat_id && get('select 1 from chats where id = ?', m.chat_id)) {
    sendChat(m.chat_id, agent, t, notify, changed, null, null);
    return m.chat_id;
  }
  const chatId = sendChat(null, agent, `${context(m)}\n\nO pedido dele:\n${t}`, notify, changed, null, null, true);
  saveMessage(chatId, 'user', t, notify);
  run('update chats set title = ? where id = ?', `Reunião: ${m.title}`, chatId);
  run('update meetings set chat_id = ? where id = ?', chatId, id);
  changed();
  return chatId;
}

export function updateMeeting(id: number, patch: { title?: string; project_slug?: string | null }): void {
  if (patch.title !== undefined) run('update meetings set title = ? where id = ?', patch.title.trim() || 'Reunião', id);
  if (patch.project_slug !== undefined) run('update meetings set project_slug = ? where id = ?', patch.project_slug, id);
}

export function deleteMeeting(id: number): void {
  rmSync(dirOf(id), { recursive: true, force: true });
  run('delete from meetings where id = ?', id);
}

/** a Central abriu com uma gravação que não terminou (caiu no meio): o que foi gravado fica, para transcrever */
export function recoverMeetings(): void {
  run(`update meetings set status = 'recorded', ended_at = coalesce(ended_at, ?), error = 'A Central fechou durante a gravação: o que foi gravado até ali ficou salvo.' where status = 'recording'`, now());
  run(`update meetings set status = 'recorded' where status = 'transcribing'`);
}

/** nome do arquivo de mídia, para o player (central-media) */
export const meetingMedia = (id: number) => { const m = row(id); return m ? fileOf(m) : null; };

/**
 * Reuniões: a Central grava a call (áudio do sistema + microfone e, se pedido, a tela), transcreve ao parar e deixa
 * conversar com um agente sobre ela (a transcrição e os prints da tela entram como contexto).
 * A gravação acontece na tela (MediaRecorder); aqui chegam os pedaços, que vão direto para o disco (se a Central cair no
 * meio, o que já foi gravado fica). Tudo mora em Development/.central-meetings/<id>/, onde os agentes conseguem ler.
 */
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { app } from 'electron';
import { join } from 'node:path';

import type { ChatMessageDto, MeetingDto } from '../src/app/shared/contract';
import { centralAgent } from './agentdefs';
import { saveMessage, sendChat } from './central-agent';
import { DEV_ROOT, all, get, now, run } from './db';
import { sttStatus, transcribeFile } from './media';

const execFileP = promisify(execFile);

const ROOT = join(DEV_ROOT, '.central-meetings');
/**
 * pasta da reunião: <id>-<quando começou> (nome único: duas Centrais, ou uma cópia de teste, não escrevem na mesma pasta);
 * as primeiras reuniões ficaram em <id>, e continuam lá
 */
const dirOf = (id: number) => join(ROOT, get<{ dir: string | null }>('select dir from meetings where id = ?', id)?.dir ?? String(id));
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
  const at = now();
  const id = Number(run(`insert into meetings (title, project_slug, screen, status, started_at) values (?,?,?, 'recording', ?)`,
    title.trim() || 'Reunião', projectSlug, screen ? 1 : 0, at).lastInsertRowid);
  // nome único guardado no registro: nunca cai na pasta de outra reunião (outra Central, cópia de teste)
  run('update meetings set dir = ? where id = ?', `${id}-${at.replace(/\D/g, '').slice(0, 14)}`, id);
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
export async function stopMeeting(id: number, seconds: number, changed: () => void, trimTo: number | null = null): Promise<void> {
  const m = row(id);
  if (!m) throw new Error('Reunião não encontrada.');
  run(`update meetings set status = 'transcribing', ended_at = ?, duration = ? where id = ?`, now(), Math.round(seconds), id);
  changed();
  const file = fileOf(m);
  if (!existsSync(file) || statSync(file).size < 1000) {
    run(`update meetings set status = 'failed', error = ? where id = ?`, 'A gravação ficou vazia (o áudio não foi capturado).', id);
    return changed();
  }
  // ficou ligada depois do fim da call: o fim mudo sai antes de transcrever
  if (trimTo && trimTo < seconds - 5) {
    try { await cut(id, 0, trimTo); run('update meetings set error = ? where id = ?', `O silêncio do fim foi cortado (a gravação seguiu ${Math.round((seconds - trimTo) / 60)} min depois do último som).`, id); }
    catch (e) { console.error('reunião: cortar o fim', e); }
  }
  await transcribe(id, changed);
}

/** fica só o trecho de `from` a `to` (s): o arquivo, a duração e os prints (renomeados para o tempo novo) */
async function cut(id: number, from: number, to: number): Promise<void> {
  const m = row(id);
  if (!m) throw new Error('Reunião não encontrada.');
  const ff = ffmpegPath();
  if (!ff) throw new Error('Falta o ffmpeg: prepare a extensão Transcrição (Extensões).');
  const file = fileOf(m), tmp = `${file}.corte.webm`;
  await execFileP(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(from), '-to', String(to), '-i', file, '-c', 'copy', tmp], { windowsHide: true, timeout: 10 * 60_000 });
  if (!existsSync(tmp) || statSync(tmp).size < 1000) throw new Error('O corte saiu vazio.');
  renameSync(tmp, file);
  // prints: os de fora saem, os de dentro ganham o tempo novo
  const dir = join(dirOf(id), 'prints');
  for (const f of framesOf(id)) {
    const mm = /^(\d+)m(\d+)s\.png$/.exec(f);
    const t = mm ? Number(mm[1]) * 60 + Number(mm[2]) : 0;
    if (t < from || t > to) rmSync(join(dir, f), { force: true });
    else if (from > 0) renameSync(join(dir, f), join(dir, `${stamp(t - from)}.png`));
  }
  rmSync(join(dirOf(id), 'quadros'), { recursive: true, force: true });
  run('update meetings set duration = ?, transcript = null where id = ?', Math.round(to - from), id);
}

/** cortar pela tela: fica de `from` a `to`; transcreve de novo (os tempos mudaram) */
export async function trimMeeting(id: number, from: number, to: number, changed: () => void): Promise<void> {
  const m = row(id);
  if (!m) throw new Error('Reunião não encontrada.');
  if (m.status === 'recording' || m.status === 'transcribing') throw new Error('Espere a gravação e a transcrição terminarem.');
  const a = Math.max(0, from), b = Math.min(to, m.duration ?? to);
  if (!(b - a >= 1)) throw new Error('O trecho precisa ter pelo menos 1 segundo.');
  run(`update meetings set status = 'transcribing', error = null where id = ?`, id);
  changed();
  try { await cut(id, a, b); }
  catch (e) { run(`update meetings set status = 'recorded', error = ? where id = ?`, `Não deu para cortar: ${(e as Error).message}`, id); return changed(); }
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
    // com o tempo de cada trecho ("[12:30] …"): o agente acha o momento do vídeo (meeting_frames at)
    const r = await transcribeFile(fileOf(m), 3 * 3600_000, true);
    const text = r.timed?.trim() || r.text;
    writeFileSync(join(dirOf(id), 'transcricao.txt'), text);
    run(`update meetings set status = 'ready', transcript = ? where id = ?`, text, id);
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
citar algo, diga quando foi dito (a transcrição traz o tempo de cada trecho, "[12:30] …"). Não invente o que não está
na transcrição: se faltar, diga que faltou.
${frames.length ? `\nPrints da tela compartilhada (o nome é o momento da reunião; abra os que importarem com a ferramenta de ler arquivos):\n${frames.map(f => `- ${join(dirOf(m.id), 'prints', f)}`).join('\n')}\n` : ''}
Pastas: gravação e arquivos em ${dirOf(m.id)}.
${m.screen ? `Para ver um momento ou um trecho do vídeo com mais detalhe (os prints acima são só amostras): meeting_frames(meeting_id ${m.id}, at '12:30') ou (from, to, every em segundos); quer mais detalhe, chame de novo com trecho e intervalo menores.` : ''}

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

/** ffmpeg que a extensão Transcrição instalou (Windows) ou o do sistema (Mac/Linux) */
function ffmpegPath(): string | null {
  const base = join(app.getPath('userData'), 'extensions', 'transcricao', 'bin', 'ffmpeg');
  if (existsSync(base)) for (const d of readdirSync(base)) { const f = join(base, d, 'bin', 'ffmpeg.exe'); if (existsSync(f)) return f; }
  return ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find(p => existsSync(p)) ?? null;
}

/** "12:30", "1:02:03" ou segundos → segundos */
const toSeconds = (v: string | number): number => {
  if (typeof v === 'number') return v;
  const parts = v.trim().split(':').map(Number);
  if (parts.some(n => Number.isNaN(n))) throw new Error(`Momento inválido: "${v}" (use 12:30 ou segundos).`);
  return parts.reduce((a, n) => a * 60 + n, 0);
};
const stamp = (s: number) => `${String(Math.floor(s / 60)).padStart(3, '0')}m${String(Math.floor(s % 60)).padStart(2, '0')}s`;

/**
 * Quadros do vídeo da reunião (só gravada com tela), em resolução cheia: um momento (at) ou um trecho (from/to) a cada
 * `every` segundos. Para ver mais detalhe, o agente chama de novo com um trecho menor e um intervalo menor (até 1 s).
 */
export async function meetingFrames(id: number, q: { at?: string | number; from?: string | number; to?: string | number; every?: number }): Promise<{ frames: { at: string; path: string }[]; note?: string }> {
  const m = row(id);
  if (!m) throw new Error('Reunião não encontrada.');
  if (!m.screen) throw new Error('Esta reunião foi gravada só com áudio: não há vídeo para olhar.');
  const video = fileOf(m);
  if (!existsSync(video)) throw new Error('O vídeo desta reunião não está mais no disco.');
  const ff = ffmpegPath();
  if (!ff) throw new Error('Falta o ffmpeg: prepare a extensão Transcrição (Extensões).');
  const dur = m.duration ?? Infinity;
  const scale = 'scale=min(2560\\,iw):-2';
  const outDir = join(dirOf(id), 'quadros');
  mkdirSync(outDir, { recursive: true });
  const run1 = (args: string[]) => execFileP(ff, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, timeout: 5 * 60_000 });
  if (q.at !== undefined) {
    const t = Math.min(Math.max(0, toSeconds(q.at)), Math.max(0, dur - 0.2));
    const path = join(outDir, `${stamp(t)}.png`);
    await run1(['-ss', String(t), '-i', video, '-frames:v', '1', '-vf', scale, path]);
    return { frames: existsSync(path) ? [{ at: stamp(t), path }] : [], note: existsSync(path) ? undefined : 'Não saiu quadro nesse momento (fora do vídeo?).' };
  }
  const from = Math.max(0, toSeconds(q.from ?? 0)), to = Math.min(toSeconds(q.to ?? dur), dur);
  const every = Math.max(1, q.every ?? 5);
  if (!(to > from)) throw new Error('Trecho vazio: "to" precisa ser depois de "from".');
  const n = Math.floor((to - from) / every) + 1;
  if (n > 60) throw new Error(`Daria ${n} quadros: no máximo 60 por vez. Aumente "every" ou diminua o trecho.`);
  const tmp = join(outDir, `t${Date.now()}`);
  mkdirSync(tmp);
  await run1(['-ss', String(from), '-t', String(to - from), '-i', video, '-vf', `fps=1/${every},${scale}`, '-frames:v', String(n), join(tmp, '%03d.png')]);
  const frames = readdirSync(tmp).filter(f => f.endsWith('.png')).sort().map((f, i) => {
    const t = from + i * every, path = join(outDir, `${stamp(t)}.png`);
    renameSync(join(tmp, f), path);
    return { at: stamp(t), path };
  });
  rmSync(tmp, { recursive: true, force: true });
  return { frames };
}

/** nome do arquivo de mídia, para o player (central-media) */
export const meetingMedia = (id: number) => { const m = row(id); return m ? fileOf(m) : null; };

/**
 * WhatsApp na Central (usa a extensão "whatsapp"), com um ou mais números conectados:
 * - Cada número tem quem responde (um agente; padrão: a Central). Donos (os números cadastrados, e a conversa "você
 *   mesmo" de cada número) falam com esse agente: uma conversa persistente por número + agente + pessoa, e a resposta
 *   volta pelo mesmo número.
 * - Qualquer outro número fica registrado como contato e não aciona agente nenhum (texto de estranho é entrada não
 *   confiável; o atendimento a clientes, com ferramentas restritas, vem depois).
 * - Agentes mandam mensagem com whatsapp_send (pelo número em que respondem, ou o primeiro conectado). Contato novo
 *   (nunca escreveu) pede aprovação, a não ser que você libere "qualquer número" em Extensões.
 */
import { getSetting, onDecided, setSetting } from './backlog';
import { sendChat } from './central-agent';
import { all, get, now, run } from './db';
import { callExtension, onExtensionEvent, running } from './extensions';
import { digits, splitReply, toWhatsApp } from './wa-format';
import { agentCwd, getAgent } from './agentdefs';
import { analyzeVideo, mediaReady, transcribeFile } from './media';
import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ChatMessageDto } from '../src/app/shared/contract';

export { digits };

const EXT = 'whatsapp';
/** quem envia de fato (a extensão); o teste troca por um gravador */
let sendOut = (account: string, to: string, text: string): Promise<unknown> => callExtension(EXT, 'send', { account, to, text });
export const setSender = (fn: typeof sendOut) => { sendOut = fn; };
type Notify = (chatId: number, msg: ChatMessageDto | null, live: boolean) => void;
type Me = { id: string; lid: string | null; phone: string; name: string | null };
export interface WaAccount { account: string; state: 'disconnected' | 'pairing' | 'connecting' | 'open'; me: Me | null; code: string | null; agent_id: number | null }
interface WaMedia { kind: 'image' | 'audio' | 'video' | 'document'; path: string | null; mime: string; seconds: number | null; name: string | null; voice?: boolean; tooBig?: boolean }
interface WaMessage { account: string; id: string; chat: string; phone: string | null; name: string | null; fromMe: boolean; self: boolean; text: string; media?: WaMedia | null; at: number }

/** estado de cada número (vem da extensão) */
const accounts = new Map<string, Omit<WaAccount, 'agent_id'>>();
/** quem responde em cada número (configurado na tela): conta → agente; sem = a Central */
const agentsOf = (): Record<string, number> => { try { return JSON.parse(getSetting('wa:agents') ?? '{}'); } catch { return {}; } };
export function setAccountAgent(account: string, agentId: number | null): void {
  const m = agentsOf();
  if (agentId) m[account] = agentId; else delete m[account];
  setSetting('wa:agents', JSON.stringify(m));
}
const agentFor = (account: string) => agentsOf()[account] ?? deps.centralId();
/** números em que quem escrever conversa com o agente (atendimento) */
const openOf = (): Record<string, boolean> => { try { return JSON.parse(getSetting('wa:open') ?? '{}'); } catch { return {}; } };
export function setAccountOpen(account: string, on: boolean): void {
  const m = openOf();
  if (on) m[account] = true; else delete m[account];
  setSetting('wa:open', JSON.stringify(m));
}
/** atendimento: no máximo N mensagens por pessoa por hora acionam o agente (o resto fica registrado) */
const PER_HOUR = 20;
const hits = new Map<string, number[]>();
function allowHit(phone: string): boolean {
  const now_ = Date.now(), list = (hits.get(phone) ?? []).filter(t => now_ - t < 3_600_000);
  if (list.length >= PER_HOUR) { hits.set(phone, list); return false; }
  hits.set(phone, [...list, now_]);
  return true;
}

export const waStatus = () => ({
  installed: running(EXT) || getSetting(`ext:${EXT}:enabled`) === '1',
  accounts: [...accounts.values()].map(a => ({ ...a, agent_id: agentsOf()[a.account] ?? null, open: !!openOf()[a.account] })),
});
const opened = () => [...accounts.values()].filter(a => a.state === 'open');

export const owners = (): string[] => { try { return (JSON.parse(getSetting('wa:owners') ?? '[]') as string[]).map(digits).filter(Boolean); } catch { return []; } };
const anyNumber = () => getSetting('wa:any') === '1';

/** cada parágrafo da resposta vira uma mensagem (como uma pessoa manda), a não ser que desligue em Extensões */
const splitOn = () => getSetting('wa:split') !== '0';
const bubbles = () => (splitOn()
  ? ' Cada parágrafo que você escrever (separado por linha em branco) sai como uma mensagem separada: quebre como uma pessoa quebraria, ou escreva tudo junto para mandar uma só. Se as suas instruções dizem como responder, siga elas.'
  : '');
const intro = (who: string) => `(Mensagem de ${who} pelo WhatsApp.${bubbles()} Responda curto, em texto simples do WhatsApp: *negrito* com um asterisco, listas com •,
sem tabelas nem blocos de código. O que precisar de tela, diga onde está na Central.)`;

let deps: { notify: Notify; changed: () => void; onStatus: () => void; centralId: () => number };
const waiting = new Map<string, string[]>();

export function initWhatsApp(d: typeof deps): void {
  deps = d;
  onExtensionEvent(EXT, (event, data) => {
    if (event === 'status') {
      // a extensão inteira caiu (stopped): todos os números ficam desconectados até ela voltar
      if (data.stopped) for (const a of accounts.values()) a.state = 'disconnected';
      else if (data.removed) accounts.delete(data.account);
      else accounts.set(data.account, { account: data.account, state: data.state, me: data.me ?? null, code: data.code ?? null });
      deps.onStatus();
    }
    if (event === 'ready') callExtension(EXT, 'status').then((list: any[]) => { for (const a of list) accounts.set(a.account, { account: a.account, state: a.state, me: a.me ?? null, code: a.code ?? null }); deps.onStatus(); }, () => {});
    if (event === 'message') inbound(data as WaMessage);
  });
  // aprovou a decisão de mandar para um contato novo: manda; recusou: descarta
  onDecided((p, verdict) => {
    if (p.source !== 'whatsapp') return false;
    const out = get<{ id: number; to_number: string; text: string; account: string | null }>(`select id, to_number, text, account from wa_outbox where proposal_id = ? and status = 'pending'`, p.id);
    if (!out) return true;
    if (verdict === 'approve') {
      const account = out.account && accounts.get(out.account)?.state === 'open' ? out.account : opened()[0]?.account ?? 'main';
      sendOut(account, out.to_number, out.text)
        .then(() => { run(`update wa_outbox set status = 'sent', sent_at = ? where id = ?`, now(), out.id); touch(out.to_number, null, 'out'); })
        .catch(e => run(`update wa_outbox set status = 'failed', error = ? where id = ?`, String(e.message), out.id));
    } else if (verdict === 'reject') run(`update wa_outbox set status = 'rejected' where id = ?`, out.id);
    return true;
  });
}

function touch(phone: string, m: WaMessage | null, dir: 'in' | 'out'): void {
  run(`insert into wa_contacts (phone, chat, name, last_in_at, last_out_at, last_text, account) values (?,?,?,?,?,?,?)
       on conflict(phone) do update set chat = coalesce(excluded.chat, chat), name = coalesce(excluded.name, name),
         last_in_at = coalesce(excluded.last_in_at, last_in_at), last_out_at = coalesce(excluded.last_out_at, last_out_at),
         last_text = coalesce(excluded.last_text, last_text), account = coalesce(excluded.account, account)`,
    phone, m?.chat ?? null, m?.name ?? null, dir === 'in' ? now() : null, dir === 'out' ? now() : null, m?.text.slice(0, 500) ?? null, m?.account ?? null);
}

/**
 * Mídia → texto que o agente entende: imagem e PDF ele abre (Read); áudio chega transcrito; vídeo vira quadros + fala.
 * Agente de atuação restrita só lê a pasta media/ dele: o arquivo é copiado para lá.
 */
async function mediaText(m: WaMessage, agentId: number): Promise<string> {
  const md = m.media;
  if (!md) return m.text;
  const caption = m.text ? `\nLegenda: ${m.text}` : '';
  const secs = md.seconds ? ` de ${md.seconds}s` : '';
  const label = { image: 'uma imagem', audio: md.voice ? 'um áudio' : 'um arquivo de áudio', video: 'um vídeo', document: `um documento${md.name ? ` (${md.name})` : ''}` }[md.kind];
  if (md.tooBig || !md.path) return `[Mandou ${label} grande demais para abrir aqui (mais de 25 MB).]${caption}`;
  const agent = getAgent(agentId);
  const local = (file: string) => {
    if (!agent?.restricted) return file;
    const dir = join(agentCwd(agent), 'media');
    mkdirSync(dir, { recursive: true });
    copyFileSync(file, join(dir, basename(file)));
    return `media/${basename(file)}`;
  };
  if (md.kind === 'image' || md.kind === 'document') return `[Mandou ${label}: ${local(md.path)} (abra com Read para ver)]${caption}`;
  if (!mediaReady()) return `[Mandou ${label}${secs}, mas a Central ainda não entende ${md.kind === 'audio' ? 'áudio' : 'vídeo'} (extensão Transcrição não instalada ou não preparada). Peça para escrever, se precisar.]${caption}`;
  try {
    if (md.kind === 'audio') return `[Mandou ${label}${secs}. Transcrição: "${(await transcribeFile(md.path)).text}"]${caption}`;
    const out = agent?.restricted ? join(agentCwd(agent), 'media') : undefined;
    const v = await analyzeVideo(md.path, out);
    const frames = v.frames.map(f => (out ? `media/${basename(f)}` : f));
    return `[Mandou ${label}${secs}. Quadros (abra com Read): ${frames.join(', ')}. Fala: ${v.transcript ? `"${v.transcript}"` : '(sem fala)'}]${caption}`;
  } catch (e) {
    return `[Mandou ${label}${secs}, mas não deu para entender: ${(e as Error).message}]${caption}`;
  }
}

export function inbound(m: WaMessage): void {
  // o que você mandou do celular para outras pessoas não é conversa com a Central
  if (m.fromMe && !m.self) return;
  // da casa: os donos cadastrados e os números conectados na própria Central (falar de um para o outro funciona)
  const house = [...owners(), ...opened().map(a => a.me?.phone).filter((p): p is string => !!p)];
  const owner = m.self || (!!m.phone && house.includes(m.phone));
  const account = m.account ?? 'main';
  if (!owner) {
    if (m.phone) touch(m.phone, m, 'in');
    deps.changed();
    // número com "responder qualquer pessoa": quem escreveu conversa com o agente do número (com limite por pessoa)
    if (openOf()[account] && m.phone && allowHit(m.phone)) withMedia(m, account, text => soon(account, m.phone!, m.chat, text, m.name ?? `+${m.phone}`, true));
    return;
  }
  withMedia(m, account, text => soon(account, m.self ? 'self' : m.phone!, m.chat, text, m.self ? 'Gustavo' : m.name ?? `+${m.phone}`));
}

/** texto puro segue na hora; com mídia, mostra "digitando" enquanto transcreve/abre e depois segue */
function withMedia(m: WaMessage, account: string, go: (text: string) => void): void {
  if (!m.media) return go(m.text);
  callExtension(EXT, 'typing', { account, to: m.chat }).catch(() => {});
  mediaText(m, agentFor(account)).then(go, () => go(m.text));
}

/**
 * Espera alguns segundos depois da última mensagem antes de chamar o agente: "oi, tudo bem?" + "preciso da sua ajuda"
 * viram uma resposta só. 0 = responde na hora. (O que chega enquanto o agente responde já vai junto depois.)
 */
const gathering = new Map<string, { texts: string[]; timer?: ReturnType<typeof setTimeout> }>();
function soon(account: string, who: string, chat: string, text: string, name: string, outside = false): void {
  const wait = Math.max(0, Math.min(60, Number(getSetting('wa:wait') ?? 8) || 0));
  if (!wait) return talk(account, who, chat, text, name, outside);
  const k = `${account}:${who}`;
  const g = gathering.get(k) ?? { texts: [] };
  clearTimeout(g.timer);
  g.texts.push(text);
  g.timer = setTimeout(() => { gathering.delete(k); talk(account, who, chat, g.texts.join('\n'), name, outside); }, wait * 1000);
  gathering.set(k, g);
}

/** Dono escreveu: segue a conversa dele com o agente do número; o que chega enquanto ele responde vai junto depois. */
function talk(account: string, who: string, chat: string, text: string, name: string, outside = false): void {
  const agentId = agentFor(account);
  const key = `${account}:${agentId}:${who}`;
  // conversa de antes dos vários números (v0.28): a "você mesmo" com a Central continua a mesma
  const legacy = account === 'main' && agentId === deps.centralId() ? Number(getSetting(`wa:chat:${who}`)) || null : null;
  const saved = Number(getSetting(`wa:chat:${key}`)) || legacy;
  const chatId = saved && get('select 1 from chats where id = ? and agent_id = ?', saved, agentId) ? saved : null;
  if (waiting.has(key)) { waiting.get(key)!.push(text); return; }
  waiting.set(key, []);
  // "digitando…" enquanto o agente pensa: o WhatsApp apaga o aviso em ~10-25 s, então renova a cada 8 s até a resposta sair
  const typing = () => callExtension(EXT, 'typing', { account, to: chat }).catch(() => {});
  typing();
  const keep = setInterval(typing, 8000);
  let last: string | null = null;
  const notify: Notify = (id, msg, live) => {
    deps.notify(id, msg, live);
    if (msg?.role === 'assistant') last = msg.text;
    if (msg?.role === 'error') last = `⚠️ ${msg.text}`;
    if (msg === null && !live) {
      clearInterval(keep);
      const reply = toWhatsApp(last ?? 'Terminei, mas não tenho nada para dizer aqui. Veja a conversa na Central.');
      // uma mensagem por parágrafo (a extensão manda em ordem, com "digitando" entre elas)
      for (const part of splitOn() ? splitReply(reply) : [reply]) sendOut(account, chat, part).catch(() => {});
      const queued = waiting.get(key) ?? [];
      waiting.delete(key);
      if (queued.length) talk(account, who, chat, queued.join('\n\n'), name, outside);
    }
  };
  try {
    const first = outside ? `(Mensagem de ${name} (+${who}), uma pessoa de fora, pelo WhatsApp.${bubbles()} Responda como no WhatsApp: curto e educado.)` : intro(name);
    const id = sendChat(chatId, agentId, chatId ? text : `${first}\n\n${text}`, notify, deps.changed);
    if (!chatId) {
      const phone = accounts.get(account)?.me?.phone;
      run('update chats set title = ?, contact = ? where id = ?', `WhatsApp${phone ? ` +${phone}` : ''} · ${who === 'self' ? 'você' : name}`, who === 'self' ? null : who, id);
      setSetting(`wa:chat:${key}`, String(id));
    }
  } catch (e) {
    clearInterval(keep);
    waiting.delete(key);
    sendOut(account, chat, `⚠️ ${(e as Error).message}`).catch(() => {});
  }
}

/** Ferramenta dos agentes: manda (ou pede aprovação para mandar) uma mensagem, pelo número em que o agente responde. */
export async function agentSend(to: string, text: string, from: { name: string; agentId: number | null }, fromNumber?: string): Promise<string> {
  const n = digits(to);
  if (n.length < 10) throw new Error('Número inválido: use DDI + DDD + número, ex.: 5511999998888.');
  const mine = Object.entries(agentsOf()).find(([acc, id]) => id === from.agentId && accounts.get(acc)?.state === 'open')?.[0];
  const byNumber = fromNumber ? [...accounts.values()].find(a => a.me?.phone === digits(fromNumber))?.account : undefined;
  if (fromNumber && !byNumber) throw new Error(`O número ${fromNumber} não está conectado na Central.`);
  const account = byNumber ?? mine ?? opened()[0]?.account ?? null;
  const known = owners().includes(n) || !!get('select 1 from wa_contacts where phone = ? and last_in_at is not null', n);
  if (!known && !anyNumber()) {
    const { lastInsertRowid } = run(`insert into proposals (project_slug, title, body, next_action, tier, source, source_ref) values (null, ?, ?, ?, 1, 'whatsapp', ?)`,
      `Mandar WhatsApp para +${n}?`, `${from.name} quer mandar esta mensagem para um número que nunca falou com vocês:\n\n${text}`, 'A Central envia a mensagem.', `wa-${Date.now()}`);
    run(`insert into wa_outbox (to_number, text, proposal_id, status, created_by, account) values (?,?,?, 'pending', ?, ?)`, n, text, Number(lastInsertRowid), from.name, account);
    deps.changed();
    return `Contato novo: pedi aprovação ao Gustavo (decisão #${lastInsertRowid}). A mensagem sai quando ele aprovar.`;
  }
  if (!account) throw new Error('Nenhum número de WhatsApp conectado (Extensões → WhatsApp).');
  await sendOut(account, n, toWhatsApp(text));
  touch(n, null, 'out');
  return `Mensagem enviada para +${n}.`;
}

/** Aviso para os donos (ex.: execução esperando você), pelo primeiro número conectado. */
export function notifyOwners(text: string): void {
  const a = opened()[0];
  if (!a || getSetting('wa:notify') === '0') return;
  const to = owners().length ? owners() : a.me ? [a.me.id] : [];
  for (const n of to) sendOut(a.account, n, toWhatsApp(text)).catch(() => {});
}

/** Conecta mais um número: cria a conta e pede o código (chega pelo status). */
export async function pairAccount(account: string | null, phone: string): Promise<string> {
  const id = account ?? (accounts.has('main') ? `n${Date.now().toString(36)}` : 'main');
  await callExtension(EXT, 'pair', { account: id, phone });
  return id;
}

export const listContacts = () => all<{ phone: string; name: string | null; last_in_at: string | null; last_out_at: string | null; last_text: string | null; account: string | null }>(
  'select phone, name, last_in_at, last_out_at, last_text, account from wa_contacts order by coalesce(last_in_at, last_out_at) desc limit 100');

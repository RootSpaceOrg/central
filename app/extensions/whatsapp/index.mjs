/**
 * Extensão WhatsApp da Central: roda num processo próprio (utilityProcess do Electron), segura a conexão do número
 * vinculado (Baileys, o mesmo protocolo do WhatsApp Web) e conversa com a Central por mensagens:
 *   Central → extensão: { id, call: 'status' | 'pair' | 'send' | 'typing' | 'logout', args }
 *   extensão → Central: { id, result } | { id, error } | { event: 'status' | 'message' | 'log', data }
 * Sem servidor e sem npm na máquina: é um arquivo só (empacotado com esbuild), baixado do release.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import makeWASocket, { DisconnectReason, jidNormalizedUser, useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';

const port = process.parentPort;
const dataDir = process.argv[2] ?? process.env.CENTRAL_EXT_DATA;
const authDir = join(dataDir, 'auth');
const emit = (event, data) => port.postMessage({ event, data });
const log = text => emit('log', String(text));

let sock = null;
let state = { state: 'disconnected', me: null, code: null };
/** número que pediu pareamento (enquanto não registra) */
let pairing = null;
/** ids que nós mandamos: o eco não volta como mensagem nova (evita laço respondendo a si mesmo) */
const sent = new Set();
/** fila de envio: no máximo uma mensagem a cada 1,2 s, com "digitando" antes (menos cara de robô, menos risco de bloqueio) */
let queue = Promise.resolve();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const setState = patch => { state = { ...state, ...patch }; emit('status', state); };
const digits = s => String(s ?? '').replace(/\D/g, '');

async function connect() {
  const { state: auth, saveCreds } = await useMultiFileAuthState(authDir);
  // navegador padrão do Baileys (Chrome no Mac): o vínculo por código de pareamento só aceita um navegador conhecido;
  // nome próprio ("Central") faz o celular dizer que o código está errado
  const s = makeWASocket({ auth, logger: pino({ level: 'silent' }), markOnlineOnConnect: false, syncFullHistory: false });
  sock = s;
  s.ev.on('creds.update', saveCreds);
  s.ev.on('connection.update', async u => {
    if (s !== sock) return;
    // conta nova: o WhatsApp pede o vínculo; com o número digitado, a Central mostra o código de 8 letras
    if (u.qr && !auth.creds.registered) {
      if (!pairing) return setState({ state: 'disconnected', code: null });
      if (state.code) return;
      try { setState({ state: 'pairing', code: await s.requestPairingCode(pairing) }); }
      catch (e) { log(`pareamento: ${e.message}`); setState({ state: 'disconnected', code: null }); }
    }
    if (u.connection === 'open') {
      pairing = null;
      setState({ state: 'open', code: null, me: { id: jidNormalizedUser(s.user.id), lid: s.user.lid ? jidNormalizedUser(s.user.lid) : null, phone: digits(s.user.id.split(':')[0]), name: s.user.name ?? null } });
    }
    if (u.connection === 'close') {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        rmSync(authDir, { recursive: true, force: true });
        sock = null;
        return setState({ state: 'disconnected', me: null, code: null });
      }
      // queda de rede ou reinício pedido pelo WhatsApp: volta sozinho
      setState({ state: auth.creds.registered ? 'connecting' : state.state });
      setTimeout(() => { if (s === sock) connect().catch(e => log(e.message)); }, code === DisconnectReason.restartRequired ? 200 : 3000);
    }
  });
  s.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      const jid = m.key.remoteJid ?? '';
      if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) continue; // grupos e status ficam de fora
      if (sent.has(m.key.id)) { sent.delete(m.key.id); continue; }
      const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? m.message?.imageMessage?.caption ?? null;
      if (!text?.trim()) continue;
      const pn = jid.endsWith('@s.whatsapp.net') ? jid : m.key.remoteJidAlt ?? m.key.senderPn ?? null;
      const me = state.me;
      const self = !!me && (jidNormalizedUser(jid) === me.id || (me.lid && jidNormalizedUser(jid) === me.lid));
      emit('message', { id: m.key.id, chat: jid, phone: pn ? digits(pn.split('@')[0]) : null, name: m.pushName ?? null, fromMe: !!m.key.fromMe, self, text: text.trim(), at: Number(m.messageTimestamp ?? 0) * 1000 || Date.now() });
    }
  });
}

/** destino: um chat que já falou com a gente (jid) ou um número (só dígitos, com DDI) */
async function target(to) {
  if (String(to).includes('@')) return to;
  const n = digits(to);
  if (n.length < 10) throw new Error('Número inválido: use DDI + DDD + número (ex.: 5511999998888).');
  const [hit] = (await sock.onWhatsApp(n)) ?? [];
  if (!hit?.exists) throw new Error(`O número ${n} não tem WhatsApp.`);
  return hit.jid;
}

const calls = {
  status: async () => state,
  async pair({ phone }) {
    const n = digits(phone);
    if (n.length < 10) throw new Error('Digite o número com DDI e DDD (ex.: 55 11 99999-8888).');
    if (state.state === 'open') throw new Error('Já está conectado. Desconecte antes de vincular outro número.');
    pairing = n;
    sock?.end(undefined);
    sock = null;
    rmSync(authDir, { recursive: true, force: true });
    setState({ state: 'pairing', code: null });
    await connect();
    // o código chega pelo evento de status
    return { ok: true };
  },
  async send({ to, text }) {
    if (state.state !== 'open' || !sock) throw new Error('O WhatsApp não está conectado.');
    if (!String(text ?? '').trim()) throw new Error('Mensagem vazia.');
    const job = queue.then(async () => {
      const jid = await target(to);
      await sock.sendPresenceUpdate('composing', jid).catch(() => {});
      await sleep(Math.min(600 + text.length * 15, 2500));
      const r = await sock.sendMessage(jid, { text: String(text) });
      if (r?.key?.id) sent.add(r.key.id);
      await sock.sendPresenceUpdate('paused', jid).catch(() => {});
      await sleep(1200);
      return { id: r?.key?.id ?? null, jid };
    });
    queue = job.catch(() => {});
    return job;
  },
  async typing({ to }) { if (sock && state.state === 'open') await sock.sendPresenceUpdate('composing', await target(to)).catch(() => {}); return { ok: true }; },
  async logout() {
    try { await sock?.logout(); } catch { /* já caiu */ }
    sock = null;
    pairing = null;
    rmSync(authDir, { recursive: true, force: true });
    setState({ state: 'disconnected', me: null, code: null });
    return { ok: true };
  },
};

port.on('message', async e => {
  const { id, call, args } = e.data ?? {};
  try { port.postMessage({ id, result: await calls[call](args ?? {}) }); }
  catch (err) { port.postMessage({ id, error: err?.message ?? String(err) }); }
});

// já vinculado antes: reconecta sozinho
import('node:fs').then(({ existsSync }) => { if (existsSync(join(authDir, 'creds.json'))) { setState({ state: 'connecting' }); connect().catch(e => log(e.message)); } else emit('status', state); });

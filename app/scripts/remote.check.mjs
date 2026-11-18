// Self-check do servidor do celular (remote.ts): pareamento, lista fechada de ações e o que nunca pode entrar nela.
// `node scripts/remote.check.mjs`
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(root, '.remote-check-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const stub = join(dir, 'settings.js');
writeFileSync(stub, `const m = new Map(); module.exports = { getSetting: k => m.get(k) ?? null, setSetting: (k, v) => m.set(k, v) };`);
await build({ entryPoints: [join(root, 'electron/remote.ts')], outfile: join(dir, 'r.js'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'error',
  plugins: [{ name: 'stub', setup: b => b.onResolve({ filter: /^\.\/backlog$/ }, () => ({ path: stub, external: true })) }] });
const req = createRequire(import.meta.url);
process.env.CENTRAL_REMOTE_HOST = '127.0.0.1';
process.env.CENTRAL_REMOTE_TESTCODE = '424242';
const r = req(join(dir, 'r.js'));
const ok = (c, m) => { if (!c) throw new Error(m); };

// 1. o que nunca pode ir para o celular (agente com permissão total, terminal, shell, merge, mexer no time, segredos)
const NEVER = [/^runs:(start|continue|grant|handoff)/, /^pty:/, /^shell:/, /^terminal/, /^review:approveMany$/, /^prs:/, /^chat:(yolo|grant|attach)$/,
  /^agents:(create|update|delete)$/, /^projects:(create|update|delete)$/, /^remote:/, /^routines:/, /^extensions?:/, /^stt:(set|key)/, /^github:/, /^data:/];
for (const ch of r.ALLOW) ok(!NEVER.some(re => re.test(ch)), `"${ch}" nunca pode estar liberado no celular`);

// 2. o servidor de verdade
const web = join(dir, 'web'); mkdirSync(web); writeFileSync(join(web, 'index.html'), '<html>app</html>');
const calls = [];
const handlers = new Map([...r.ALLOW, 'runs:start', 'settings:get'].map(ch => [ch, (...a) => { calls.push([ch, a]); return ch === 'settings:get' ? 'segredo' : 'ok'; }]));
r.startRemote({ handlers, webRoot: web, media: () => null, changed: () => {} });
r.setRemote(true);
await new Promise(res => setTimeout(res, 400));
const base = `http://127.0.0.1:${r.REMOTE_PORT}`;
let cookie = '';
const call = (channel, args = []) => fetch(base + '/api/invoke', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ channel, args }) });

ok((await fetch(base + '/')).status === 200, 'o app (arquivos) abre sem parear');
ok((await call('projects:list')).status === 401, 'sem parear: recusa');
r.newPairing();
ok((await fetch(base + '/api/pair', { method: 'POST', body: JSON.stringify({ code: '000000' }) })).status === 403, 'código errado: recusa');
const p = await fetch(base + '/api/pair', { method: 'POST', body: JSON.stringify({ code: '424242', name: 'teste' }) });
ok(p.status === 200, 'código certo: pareia');
cookie = (p.headers.get('set-cookie') ?? '').split(';')[0];
ok(/HttpOnly/.test(p.headers.get('set-cookie') ?? ''), 'token em cookie HttpOnly (a tela não lê)');
ok((await fetch(base + '/api/pair', { method: 'POST', body: JSON.stringify({ code: '424242' }) })).status === 403, 'código vale uma vez só');
ok((await call('projects:list')).status === 200, 'pareado: o liberado responde');
ok((await call('runs:start', [{}])).status === 403, 'iniciar agente: recusa');
ok(!calls.some(c => c[0] === 'runs:start'), 'o handler proibido nem é chamado');
ok((await call('settings:get', ['stt:openai_key'])).status === 403, 'configuração sensível: recusa');
ok((await call('settings:get', ['chat:last'])).status === 200, 'configuração de tela: libera');
await call('chat:send', [null, 1, 'oi']);
ok(calls.find(c => c[0] === 'chat:send')?.[1][2] === '📱 oi', 'mensagem do celular chega marcada');
r.revokeDevice((await r.remoteStatus()).devices[0].id);
ok((await call('projects:list')).status === 401, 'desparear corta na hora');
await r.stopRemote();
console.log('remote ok');

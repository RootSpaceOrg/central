// Notificações: o que avisa (por tipo), "só se falhar" e o horário de não perturbe.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'notif-'));
await build({ entryPoints: [join(root, 'electron/notif.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(dir, 'f.js'), logLevel: 'error' });
const f = createRequire(import.meta.url)(join(dir, 'f.js'));
const ok = (c, m) => { if (!c) throw new Error(m); };
const day = new Date(2026, 10, 7, 15, 0), night = new Date(2026, 10, 7, 23, 30), early = new Date(2026, 10, 7, 6, 0);
const p = f.NOTIF_DEFAULTS;

ok(f.shouldNotify(p, 'run', true, day) && f.shouldNotify(p, 'run', false, day), 'agente: sempre (padrão)');
ok(!f.shouldNotify(p, 'board', true, day) && f.shouldNotify(p, 'board', false, day), 'etapa de quadro: só se falhar (padrão)');
ok(!f.shouldNotify(p, 'routine', true, day) && f.shouldNotify(p, 'routine', false, day), 'rotina: só se falhar (padrão)');
ok(!f.shouldNotify({ ...p, agents: 'none' }, 'run', false, day), 'nunca');
ok(f.shouldNotify(p, 'idle', true, day) && !f.shouldNotify({ ...p, idle: false }, 'idle', true, day), 'tudo terminou liga e desliga');
const q = { ...p, quiet: '22-07' };
ok(!f.shouldNotify(q, 'run', false, night) && !f.shouldNotify(q, 'waiting', true, early) && f.shouldNotify(q, 'run', false, day), 'não perturbe atravessa a meia-noite');
ok(f.shouldNotify(q, 'system', true, night), 'aviso do sistema passa');
ok(f.inQuiet('13-14', new Date(2026, 10, 7, 13, 30)) && !f.inQuiet('', night) && !f.inQuiet('5-5', night), 'horário no mesmo dia; vazio e igual = desligado');
ok(f.parseNotif('{"boards":"none"}').boards === 'none' && f.parseNotif('{"boards":"none"}').agents === 'all' && f.parseNotif('lixo').idle === true, 'lê o salvo com os padrões');

rmSync(dir, { recursive: true, force: true });
console.log('notif ok');

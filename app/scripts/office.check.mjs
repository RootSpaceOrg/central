// Self-check da planta do Escritório: `node scripts/office.check.mjs`
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'office-'));
const out = join(dir, 'office-map.mjs');
await build({ entryPoints: [new URL('../src/app/modules/office/office-map.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')], outfile: out, format: 'esm', logLevel: 'error' });
const m = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const ok = (c, msg) => { if (!c) throw new Error(msg); };

// sala pelo papel
ok(m.inferRoom('Sentinela de erros: olha o Sentry') === 'monitor', 'sentinela → monitoração');
ok(m.inferRoom('Marketing: pensa conteúdo') === 'creative', 'marketing → criativo');
ok(m.inferRoom('Suporte KultivAi') === 'business', 'suporte → negócios');
ok(m.inferRoom('Revisor de código') === 'eng', 'padrão → engenharia');
ok(m.inferRoom('login e blog') === 'eng', '"login"/"blog" não é monitoração');
ok(m.inferRoom('postgres') === 'eng', '"postgres" não é criativo');

// lugares: mesa antes de ficar em pé, ninguém troca de lugar quando chega gente
const seats = new Map();
let p = m.place([{ key: 'a', room: 'eng' }, { key: 'b', room: 'eng' }], seats);
ok(p.get('a').seated && p.get('b').seated && p.get('a').seat !== p.get('b').seat, 'cada um numa mesa');
const aSeat = p.get('a').seat;
p = m.place([{ key: 'new', room: 'eng' }, { key: 'b', room: 'eng' }, { key: 'a', room: 'eng' }], seats);
ok(p.get('a').seat === aSeat, 'quem já estava continua no lugar');
ok(new Set([...p.values()].map(x => x.seat)).size === 3, 'lugares distintos');
// lotou: ninguém fica sem lugar
const many = Array.from({ length: 20 }, (_, i) => ({ key: `k${i}`, room: 'monitor' }));
p = m.place(many, new Map());
ok(p.size === 20 && [...p.values()].every(x => x.room === 'monitor'), 'sala lotada ainda posiciona todos');
// copa: só em pé
ok([...m.place([{ key: 'z', room: 'copa' }], new Map()).values()][0].seated === false, 'copa não tem mesa');

// caminho: troca de sala passa pelo corredor; mesma sala vai direto; quem chega vem do elevador
const from = m.place([{ key: 'x', room: 'copa' }], new Map()).get('x');
const to = m.place([{ key: 'x', room: 'eng' }], new Map()).get('x');
const r = m.route(from, to);
ok(r.some(([, y]) => y === 7), 'passa pelo corredor');
ok(r.at(-1)[0] === to.x && r.at(-1)[1] === to.y, 'termina no lugar');
ok(m.route(to, { ...to, x: to.x + 1 }).length === 2, 'mesma sala: direto');
ok(m.route(null, to)[0][1] === 7, 'chega pelo elevador');

// todo lugar fica dentro da sala
for (const room of m.ROOMS) for (const [x, y] of [...room.desks.map(([x, y]) => [x + 1, y + 1.55]), ...room.stands])
  ok(x > room.x && x < room.x + room.w && y > room.y && y < room.y + room.d, `${room.id}: lugar (${x},${y}) fora da sala`);

console.log('office ok');

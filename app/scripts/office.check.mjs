// Self-check da planta do Escritório: `node scripts/office.check.mjs`
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'office-'));
const out = join(dir, 'office-map.mjs');
await build({ entryPoints: [new URL('../src/app/modules/office/office-map.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')], outfile: out, format: 'esm', bundle: true, logLevel: 'error' });
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
ok(r.some(([, y]) => y === m.CORRIDOR_Y), 'passa pelo corredor');
ok(r.at(-1)[0] === to.x && r.at(-1)[1] === to.y, 'termina no lugar');
ok(m.route(to, { ...to, x: to.x + 1 }).every(([, y]) => y !== m.CORRIDOR_Y), 'mesma sala: não sai da sala');
ok(m.route(null, to)[0][1] === m.CORRIDOR_Y, 'chega pelo elevador');

// todo lugar fica dentro da sala
for (const room of m.ROOMS) for (const [x, y] of [...room.desks.map(([x, y]) => [x + 1, y + 0.29]), ...room.stands])
  ok(x > room.x && x < room.x + room.w && y > room.y && y < room.y + room.d, `${room.id}: lugar (${x},${y}) fora da sala`);

// da porta até cada mesa: nenhum trecho do caminho atravessa uma mesa (2 x 1,84, de z+0,94 a z+1,84 é o tampo)
const crosses = ([x0, y0], [x1, y1], [dx, dz]) => {
  for (let t = 0; t <= 1; t += 0.02) {
    const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    if (x > dx + 0.05 && x < dx + 1.95 && y > dz + 0.95 && y < dz + 1.83) return true;
  }
  return false;
};
for (const room of m.ROOMS) room.desks.forEach((_, i) => {
  const seat = m.place([{ key: 'q', room: room.id }], new Map([['q', `${room.id}:${i}`]])).get('q');
  const path = m.route(null, seat);
  for (let k = 1; k < path.length; k++) for (const d of room.desks)
    ok(!crosses(path[k - 1], path[k], d), `${room.id}:${i}: o caminho atravessa a mesa (${d})`);
});
// as salas cobrem o andar sem sobrepor e as portas ficam dentro da parede da sala
for (const r of m.ROOMS) ok(r.x + r.w <= m.MAP_W && r.y + r.d <= m.MAP_H && r.door > r.x && r.door + 1.2 < r.x + r.w, `${r.id}: fora do andar ou porta fora da parede`);

console.log('office ok');

// aparência do boneco: o que vem do banco é validado (campo estranho volta ao padrão)
{
  const dir2 = mkdtempSync(join(tmpdir(), 'look-'));
  const out2 = join(dir2, 'look.mjs');
  await build({ entryPoints: [new URL('../src/app/shared/ui/avatar-look.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')], outfile: out2, format: 'esm', logLevel: 'error' });
  const l = await import(pathToFileURL(out2).href);
  rmSync(dir2, { recursive: true, force: true });
  const d = l.LOOK_DEFAULT;
  ok(l.parseLook('') === d && l.parseLook(null) === d && l.parseLook('{quebrado') === d, 'vazio ou inválido = padrão');
  const v = l.parseLook(JSON.stringify({ hair: 'rabo', acc: 'oculos', skin: 2, outfit: '#aabbcc' }));
  ok(v.hair === 'rabo' && v.acc === 'oculos' && v.skin === 2 && v.outfit === '#aabbcc', 'look válido');
  const x = l.parseLook(JSON.stringify({ hair: 'chapéu', acc: 'capa', skin: 99, outfit: 'red; x' }));
  ok(x.hair === 'curto' && x.acc === 'nenhum' && x.skin === -1 && x.outfit === '', 'campos estranhos voltam ao padrão');
  console.log('look ok');
}

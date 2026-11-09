// Freio da cota: faixas por prioridade, vaga guardada para alta, envelhecimento, pausa, retomada e cadeia de agentes.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'gov-'));
await build({ entryPoints: [join(root, 'electron/governor.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(dir, 'g.js'), logLevel: 'error' });
const g = createRequire(import.meta.url)(join(dir, 'g.js'));
const ok = (c, m) => { if (!c) throw new Error(m); };
const u = (session, week = 10) => ({ session, week, sessionReset: '2026-11-04T15:00:00Z', weekReset: '2026-11-08T00:00:00Z' });

// faixas
ok(g.canStart(2, u(59)) && !g.canStart(2, u(60)), 'baixa para em 60%');
ok(g.canStart(1, u(79)) && !g.canStart(1, u(80)), 'normal para em 80%');
ok(g.canStart(0, u(89)) && !g.canStart(0, u(90)), 'alta para em 90%');
ok(!g.canStart(1, u(10, 90)) && g.canStart(0, u(10, 90)), 'semana também freia');
ok(g.canStart(1, { session: null, week: null }), 'uso desconhecido não trava');
ok(g.brakeLabel(u(85)) === 'Freio: só prioridade alta' && g.brakeLabel(u(10)) === null, 'rótulo do freio');

// pausa
ok(g.mustPause(u(94)) === null, '94% segue');
ok(g.mustPause(u(95))?.until === '2026-11-04T15:00:00Z', '95% pausa até renovar a sessão');
ok(g.mustPause(u(10, 98))?.until === '2026-11-08T00:00:00Z', 'semana estourando pausa até a semana renovar');
ok(g.LIMIT_HIT.test("Claude AI usage limit reached|1762300000") && g.LIMIT_HIT.test("You've hit your limit · resets 3pm") && !g.LIMIT_HIT.test('Tests failed'), 'reconhece o limite do plano');

// fila: prioridade, vaga guardada, envelhecimento
const now = Date.parse('2026-11-04T12:00:00Z');
const q = (id, priority, minsAgo = 0, paused = null) => ({ id, priority, paused, created_at: new Date(now - minsAgo * 60_000).toISOString() });
ok(g.pickNext([q(1, 1), q(2, 0), q(3, 2)], 0, 4, u(10), now).join() === '2,1,3', 'alta primeiro, depois ordem');
ok(g.pickNext([q(1, 1), q(2, 1)], 3, 4, u(10), now).length === 0, 'última vaga fica para alta');
ok(g.pickNext([q(1, 1), q(2, 0)], 3, 4, u(10), now).join() === '2', 'alta usa a vaga guardada');
ok(g.pickNext([q(1, 1), q(2, 2)], 0, 4, u(70), now).join() === '1', 'acima de 60% a baixa espera');
ok(g.pickNext([q(1, 1, 0), q(2, 2, 50)], 0, 3, u(10), now).join() === '1,2', 'baixa esperando 50 min já empata com normal');
ok(g.pickNext([q(1, 1, 0, '{}')], 0, 4, u(10), now).length === 0, 'pausada não entra');

// retomada
const p = (id, priority, until) => ({ ...q(id, priority, 0, '{}'), until });
ok(g.nextToResume([p(1, 1, '2026-11-04T13:00:00Z')], u(10), now) === null, 'antes de renovar não volta');
ok(g.nextToResume([p(1, 1, '2026-11-04T11:00:00Z'), p(2, 0, '2026-11-04T11:00:00Z')], u(10), now) === 2, 'renovou: volta uma, a mais prioritária');
ok(g.nextToResume([p(1, 2, null)], u(70), now) === null, 'sem previsão: volta quando o freio deixar');

// faixas configuráveis
g.setLimits({ session: [95, 50, 30], week: [99, 99, 99], pause: { session: 97, week: 99 } });
ok(g.canStart(1, u(49)) && !g.canStart(1, u(50)) && g.canStart(0, u(94)), 'faixas novas valem');
ok(g.mustPause(u(96)) === null && g.mustPause(u(97)) !== null, 'pausa no novo teto');
ok(JSON.stringify(g.parseLimits({ session: [150, 'x', -5] }).session) === JSON.stringify([100, 80, 0]), 'valores conferidos (0 a 100, inválido volta ao padrão)');
g.setLimits(g.DEFAULT_LIMITS);

// cadeia
ok(g.chainProblem([5, 6], 7) === null, 'cadeia curta passa');
ok(g.chainProblem([5, 6], 5)?.includes('laço'), 'repetir agente é laço');
ok(g.chainProblem([1, 2, 3, 4], 9)?.includes('saltos'), 'mais de 3 saltos para');

rmSync(dir, { recursive: true, force: true });
console.log('governor ok');

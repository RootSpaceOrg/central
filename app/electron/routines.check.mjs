// Self-check da agenda das rotinas: `node electron/routines.check.mjs`
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'sched-'));
await build({ entryPoints: [join(fileURLToPath(import.meta.url), '..', 'schedule.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(dir, 's.js'), logLevel: 'error' });
const { nextRun } = createRequire(import.meta.url)(join(dir, 's.js'));
rmSync(dir, { recursive: true, force: true });

const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const sat = new Date(2026, 9, 31, 14, 0); // sábado 31/10/2026 14:00
const cases = [
  [nextRun('daily', [1, 2, 3, 4, 5], '08:00', 0, sat), '2026-11-02 08:00'], // dia útil → segunda
  [nextRun('daily', [], '15:30', 0, sat), '2026-10-31 15:30'],              // todo dia, ainda hoje
  [nextRun('daily', [], '09:00', 0, sat), '2026-11-01 09:00'],              // já passou → amanhã
  [nextRun('daily', [6], '14:00', 0, sat), '2026-11-07 14:00'],             // mesmo horário de agora → semana que vem
  [nextRun('interval', [], '', 6, sat), '2026-10-31 20:00'],
  [nextRun('interval', [], '', 6, sat, 15), '2026-10-31 14:15'],             // de 15 em 15 min (minutos têm prioridade)
  [nextRun('interval', [], '', 6, sat, 2), '2026-10-31 14:05'],              // mínimo de 5 min
];
for (const [got, want] of cases) if (fmt(got) !== want) throw new Error(`esperado ${want}, veio ${fmt(got)}`);
console.log('ok');

// Self-check da agenda das rotinas: `node electron/routines.check.mjs`
// (nextRun é copiado de electron/routines.ts; mudou lá, mude aqui.)
function nextRun(kind, days, time, hours, from) {
  if (kind === 'interval') return new Date(from.getTime() + Math.max(hours, 1) * 3_600_000);
  const [h, m] = time.split(':').map(Number);
  const allowed = days.length ? days : [0, 1, 2, 3, 4, 5, 6];
  for (let i = 0; i <= 7; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (d > from && allowed.includes(d.getDay())) return d;
  }
  throw new Error('Agenda sem dia válido.');
}

const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const sat = new Date(2026, 9, 31, 14, 0); // sábado 31/10/2026 14:00
const cases = [
  [nextRun('daily', [1, 2, 3, 4, 5], '08:00', 0, sat), '2026-11-02 08:00'], // dia útil → segunda
  [nextRun('daily', [], '15:30', 0, sat), '2026-10-31 15:30'],              // todo dia, ainda hoje
  [nextRun('daily', [], '09:00', 0, sat), '2026-11-01 09:00'],              // já passou → amanhã
  [nextRun('daily', [6], '14:00', 0, sat), '2026-11-07 14:00'],             // mesmo horário de agora → semana que vem
  [nextRun('interval', [], '', 6, sat), '2026-10-31 20:00'],
];
for (const [got, want] of cases) if (fmt(got) !== want) throw new Error(`esperado ${want}, veio ${fmt(got)}`);
console.log('ok');

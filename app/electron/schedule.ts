/** Agenda das rotinas (puro: o teste importa sem o Electron). */
/**
 * Próxima execução depois de `from`.
 * daily: nos dias da semana listados (0 = domingo) às HH:MM, no horário local.
 * interval: de N em N horas a partir de `from`.
 */
export function nextRun(kind: 'daily' | 'interval', days: number[], time: string, hours: number, from: Date, minutes: number | null = null): Date {
  // intervalo em minutos (mínimo 5) tem prioridade sobre o em horas
  if (kind === 'interval') return new Date(from.getTime() + (minutes ? Math.max(minutes, 5) * 60_000 : Math.max(hours, 1) * 3_600_000));
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

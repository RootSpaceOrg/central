import { Pipe, PipeTransform } from '@angular/core';

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' });

/** "agora", "há 5 min", "há 3 h", "ontem", "há 4 dias", "12 de out." */
export function ago(d: Date | null): string {
  if (!d) return '';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const days = Math.floor(s / 86400);
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  return dateFmt.format(d);
}

@Pipe({ name: 'ago' })
export class AgoPipe implements PipeTransform {
  transform(d: Date | null): string { return ago(d); }
}

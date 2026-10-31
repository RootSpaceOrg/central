// Self-check da comparação de versões do atualizador: `node electron/updater.check.mjs`
// (compareVersions é copiado de electron/updater.ts; mudou lá, mude aqui.)
function compareVersions(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0) ? 1 : -1;
  return 0;
}

const cases = [['0.3.2', '0.3.1', 1], ['0.3.10', '0.3.9', 1], ['1.0.0', '0.9.9', 1], ['0.3.1', '0.3.1', 0], ['0.2.9', '0.3.0', -1]];
for (const [a, b, want] of cases) if (compareVersions(a, b) !== want) throw new Error(`${a} vs ${b}`);
console.log('ok');

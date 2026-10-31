// Self-check: o manifesto gerado resolve ícones como o VS Code. `node scripts/file-icons.check.mjs`
// (resolveIcon é copiado de src/app/modules/project/services/file-icons/file-icons.ts; mudou lá, mude aqui.)
import { readFileSync } from 'node:fs';

const m = JSON.parse(readFileSync(new URL('../public/file-icons/manifest.json', import.meta.url)));

function resolveIcon(m, name, dir, open = false) {
  const n = name.toLowerCase();
  if (dir) return (open ? m.folderNamesExpanded[n] : m.folderNames[n]) ?? (open ? m.folderExpanded : m.folder);
  if (m.fileNames[n]) return m.fileNames[n];
  const parts = n.split('.');
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.');
    if (m.fileExtensions[ext]) return m.fileExtensions[ext];
  }
  return m.file;
}

const cases = [
  ['package.json', false, false, 'nodejs'],
  ['app.component.ts', false, false, 'angular-component.clone'],
  ['foo.spec.ts', false, false, 'test-ts'],
  ['main.ts', false, false, 'typescript'],
  ['README.md', false, false, 'readme'],
  ['notes.md', false, false, 'markdown'],
  ['main.tf', false, false, 'terraform'],
  ['handler.py', false, false, 'python'],
  ['styles.css', false, false, 'css'],
  ['coisa.desconhecida', false, false, 'file'],
  ['src', true, false, 'folder-src'],
  ['src', true, true, 'folder-src-open'],
  ['minha-pasta', true, false, 'folder'],
  ['node_modules', true, true, 'folder-node-open'],
];
for (const [name, dir, open, want] of cases) {
  const got = resolveIcon(m, name, dir, open);
  if (got !== want) throw new Error(`${name}: esperado ${want}, veio ${got}`);
}
console.log('ok');

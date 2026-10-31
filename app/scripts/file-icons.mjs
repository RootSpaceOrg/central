// Gera public/file-icons/manifest.json a partir do Material Icon Theme (PKief), no formato que o explorador usa:
// cada mapa aponta direto para o nome do SVG em node_modules/material-icon-theme/icons (copiados no build).
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { generateManifest } = createRequire(import.meta.url)('material-icon-theme');
const m = generateManifest();
const svg = id => basename(m.iconDefinitions[id].iconPath, '.svg');
const map = obj => Object.fromEntries(Object.entries(obj ?? {}).map(([k, id]) => [k.toLowerCase(), svg(id)]));

// Extensões que o VS Code resolve por linguagem embutida (não aparecem em fileExtensions).
const EXT_LANGUAGE = {
  json: 'json', jsonc: 'jsonc', md: 'markdown', html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascriptreact', ts: 'typescript', tsx: 'typescriptreact',
  py: 'python', yaml: 'yaml', yml: 'yaml', xml: 'xml', sql: 'sql', sh: 'shellscript', bash: 'shellscript',
  ps1: 'powershell', bat: 'bat', cmd: 'bat', java: 'java', go: 'go', rs: 'rust', php: 'php', rb: 'ruby', c: 'c',
  cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp', vue: 'vue', svelte: 'svelte', dart: 'dart', kt: 'kotlin',
  swift: 'swift', lua: 'lua', r: 'r', tf: 'terraform', hcl: 'terraform', ini: 'ini', toml: 'toml', txt: 'plaintext',
  csv: 'csv', log: 'log', dockerfile: 'dockerfile',
};
const languages = map(m.languageIds);
const byLanguage = Object.fromEntries(Object.entries(EXT_LANGUAGE).filter(([, lang]) => languages[lang]).map(([ext, lang]) => [ext, languages[lang]]));

const manifest = {
  file: svg(m.file),
  folder: svg(m.folder),
  folderExpanded: svg(m.folderExpanded),
  fileNames: map(m.fileNames),
  fileExtensions: { ...byLanguage, ...map(m.fileExtensions) },
  folderNames: map(m.folderNames),
  folderNamesExpanded: map(m.folderNamesExpanded),
};

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'file-icons');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest));
console.log(`file-icons: ${Object.keys(manifest.fileNames).length} nomes, ${Object.keys(manifest.fileExtensions).length} extensões, ${Object.keys(manifest.folderNames).length} pastas`);

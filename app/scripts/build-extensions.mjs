// Empacota cada extensão (extensions/<id>/index.mjs) num arquivo só e grava o hash no catálogo que vai dentro do app
// (electron/ext-catalog.json): a Central só roda o arquivo baixado se o hash bater.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const out = join(root, 'dist-ext');
mkdirSync(out, { recursive: true });
const catalog = {};
for (const id of readdirSync(join(root, 'extensions'))) {
  const manifest = JSON.parse(readFileSync(join(root, 'extensions', id, 'manifest.json'), 'utf8'));
  const file = `${id}-${manifest.version}.mjs`;
  await build({
    entryPoints: [join(root, 'extensions', id, 'index.mjs')], bundle: true, platform: 'node', format: 'esm', target: 'node22',
    outfile: join(out, file), logLevel: 'error', legalComments: 'none',
    // mídia (imagem, áudio, prévia de link) fica de fora: a extensão trabalha com texto
    external: ['sharp', 'jimp', 'link-preview-js', 'audio-decode'],
    banner: { js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" },
  });
  const sha256 = createHash('sha256').update(readFileSync(join(out, file))).digest('hex');
  catalog[id] = { ...manifest, file, sha256 };
  console.log(`${file} ${sha256.slice(0, 12)}`);
}
writeFileSync(join(root, 'electron', 'ext-catalog.json'), JSON.stringify(catalog, null, 2) + '\n');

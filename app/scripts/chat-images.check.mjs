// Imagens nos chats: marcador vira bloco de imagem, e só vale o que está na pasta de anexos.
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'img-'));
await build({ entryPoints: [join(root, 'electron/chat-images.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(dir, 'f.js'), logLevel: 'error' });
const f = createRequire(import.meta.url)(join(dir, 'f.js'));
const ok = (c, m) => { if (!c) throw new Error(m); };

const media = join(dir, 'chat-media');
mkdirSync(media);
const png = join(media, 'a.png');
writeFileSync(png, Buffer.from([137, 80, 78, 71]));
const outside = join(dir, 'segredo.png');
writeFileSync(outside, 'x');

ok(f.inside(media, png), 'imagem da pasta vale');
ok(!f.inside(media, outside), 'fora da pasta não vale');
ok(!f.inside(media, join(media, '..', 'segredo.png')), '.. não escapa');
ok(!f.inside(media, join(media, 'notas.txt')), 'só imagem');

const s = f.splitImages(`olha isso\n[[img:${png}]]\n[[img:${outside}]]`, media);
ok(s.text === 'olha isso' && s.images.length === 1 && s.images[0] === png, 'separa texto e só a imagem permitida');
ok(f.userContent('só texto', media) === 'só texto', 'sem imagem: texto puro');
const c = f.userContent(`[[img:${png}]]`, media);
ok(Array.isArray(c) && c[0].type === 'image' && c[0].source.media_type === 'image/png' && c[1].text === 'Veja a imagem.', 'imagem sozinha vira bloco + texto padrão');

rmSync(dir, { recursive: true, force: true });
console.log('chat-images ok');

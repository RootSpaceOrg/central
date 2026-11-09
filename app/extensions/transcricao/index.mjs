/**
 * Extensão Transcrição da Central: áudio vira texto e vídeo vira quadros + fala, para os agentes entenderem.
 * - Motor local: whisper.cpp (roda no PC, sem nuvem e sem gastar cota) + ffmpeg para converter áudio e tirar quadros.
 *   Windows: os programas e o modelo são baixados na primeira vez (com hash conferido) para a pasta da extensão.
 *   Mac: whisper-cli e ffmpeg vêm do Homebrew (instala sozinho se faltar); o modelo é baixado igual.
 * - Motor OpenAI (opcional): gpt-4o-transcribe pela API, com a chave que você cadastrar (a Central manda a chave em
 *   cada pedido; a extensão não guarda).
 * Mensagens: Central → { id, call: 'status' | 'setup' | 'transcribe' | 'video', args } ; extensão → { id, result | error }
 * ou { event: 'status' | 'log', data }.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';

const port = process.parentPort;
const dataDir = process.argv[2] ?? process.env.CENTRAL_EXT_DATA;
const bin = join(dataDir, 'bin');
const tmp = join(dataDir, 'tmp');
mkdirSync(bin, { recursive: true });
mkdirSync(tmp, { recursive: true });
const run = promisify(execFile);
const emit = (event, data) => port.postMessage({ event, data });
const TAR = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');

/** o que é baixado na preparação (versões fixas; o hash precisa bater) */
const ASSETS = {
  whisper: { url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip', sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb', size: 8_928_640, extract: 'whisper' },
  ffmpeg: { url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.7z', sha256: '4705843ccaaf54257c16ad90f3e952ece33c17df964ecf7bfdbb0f49c7171077', size: 35_430_500, extract: 'ffmpeg' },
  small: { url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin', sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b', size: 487_601_967, file: 'ggml-small.bin' },
  base: { url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin', sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe', size: 147_951_465, file: 'ggml-base.bin' },
};
const WIN = process.platform === 'win32';
/** Mac/Linux: programa instalado no sistema (Homebrew em /opt/homebrew ou /usr/local, ou no PATH) */
const sysBin = name => [...(process.env.PATH ?? '').split(':'), '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean)
  .map(d => join(d, name)).find(p => existsSync(p)) ?? join('/opt/homebrew/bin', name);
const BREW = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find(p => existsSync(p)) ?? null;
const paths = WIN ? {
  whisper: join(bin, 'whisper', 'Release', 'whisper-cli.exe'),
  ffmpeg: join(bin, 'ffmpeg', 'ffmpeg-9.0.2-essentials_build', 'bin', 'ffmpeg.exe'),
  ffprobe: join(bin, 'ffmpeg', 'ffmpeg-9.0.2-essentials_build', 'bin', 'ffprobe.exe'),
  model: m => join(bin, ASSETS[m].file),
} : {
  get whisper() { return sysBin('whisper-cli'); },
  get ffmpeg() { return sysBin('ffmpeg'); },
  get ffprobe() { return sysBin('ffprobe'); },
  model: m => join(bin, ASSETS[m].file),
};
const have = { whisper: () => existsSync(paths.whisper), ffmpeg: () => existsSync(paths.ffmpeg), model: m => existsSync(paths.model(m)) };

let progress = null; // { name, done, total }
let setupError = null;
let setting = null;
const status = () => ({ whisper: have.whisper(), ffmpeg: have.ffmpeg(), models: { small: have.model('small'), base: have.model('base') }, progress, error: setupError });
const push = () => emit('status', status());

async function sha256(path) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
}

async function download(key) {
  const a = ASSETS[key];
  const out = join(tmp, `${key}.part`);
  progress = { name: key, done: 0, total: a.size };
  push();
  const res = await fetch(a.url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download de ${key} falhou (${res.status}).`);
  const f = await open(out, 'w');
  let done = 0, last = 0;
  try {
    for await (const chunk of res.body) {
      await f.write(chunk);
      done += chunk.length;
      if (Date.now() - last > 400) { last = Date.now(); progress = { name: key, done, total: a.size }; push(); }
    }
  } finally { await f.close(); }
  if (await sha256(out) !== a.sha256) { rmSync(out, { force: true }); throw new Error(`O arquivo de ${key} não confere; não foi instalado.`); }
  if (a.extract) {
    const dir = join(bin, a.extract);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const ext = a.url.endsWith('.7z') ? '.7z' : '.zip';
    renameSync(out, out + ext);
    await run(TAR, ['-xf', out + ext, '-C', dir], { windowsHide: true });
    rmSync(out + ext, { force: true });
  } else renameSync(out, join(bin, a.file));
}

/** Mac: instala pelo Homebrew o que ainda não existe (total 0 = a tela mostra "instalando", sem MB) */
async function brewInstall(formulas) {
  const need = formulas.filter(f => !(f === 'ffmpeg' ? have.ffmpeg() : have.whisper()));
  if (!need.length) return;
  if (!BREW) throw new Error(`Falta ${need.join(' e ')}. Instale o Homebrew (brew.sh) e clique em Preparar de novo, ou rode: brew install ${need.join(' ')}`);
  progress = { name: 'brew', done: 0, total: 0 };
  push();
  await run(BREW, ['install', ...need], { maxBuffer: 16 * 1024 * 1024, env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1' } })
    .catch(e => { throw new Error(`brew install ${need.join(' ')} falhou: ${String(e.stderr || e.message).trim().split('\n').slice(-2).join(' ')}`); });
}

/** Prepara o motor local: baixa o que falta (programas + o modelo escolhido). Pode rodar de novo para trocar de modelo. */
async function setup({ model = 'small', only } = {}) {
  if (only !== 'ffmpeg' && !ASSETS[model]?.file) throw new Error('Modelo inválido: small ou base.');
  if (setting) return setting;
  setupError = null;
  setting = (async () => {
    try {
      if (!WIN) await brewInstall(only === 'ffmpeg' ? ['ffmpeg'] : ['whisper-cpp', 'ffmpeg']);
      else {
        if (only !== 'ffmpeg' && !have.whisper()) await download('whisper');
        if (!have.ffmpeg()) await download('ffmpeg');
      }
      if (only !== 'ffmpeg' && !have.model(model)) await download(model);
      return status();
    } catch (e) { setupError = e.message; throw e; }
    finally { progress = null; setting = null; push(); }
  })();
  return setting;
}

const seconds = async file => {
  if (!have.ffmpeg()) return null;
  const { stdout } = await run(paths.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { windowsHide: true }).catch(() => ({ stdout: '' }));
  const s = Number(stdout.trim());
  return Number.isFinite(s) ? Math.round(s) : null;
};

/** áudio (qualquer formato que o ffmpeg abre) → texto */
async function transcribe({ path, engine = 'local', model = 'small', language = 'pt', apiKey, openaiModel = 'gpt-4o-transcribe' }) {
  if (!path || !existsSync(path)) throw new Error('Arquivo de áudio não encontrado.');
  const dur = await seconds(path);
  if (engine === 'openai') {
    if (!apiKey) throw new Error('Cadastre a chave da OpenAI em Extensões → Transcrição.');
    let file = path;
    // a API aceita até 25 MB: maior que isso, comprime para voz (mono, 16 kHz) antes
    if (statSync(path).size > 24 * 1024 * 1024) {
      if (!have.ffmpeg()) throw new Error('Áudio grande demais para a API sem o ffmpeg: prepare o motor local primeiro.');
      file = join(tmp, `${Date.now()}.ogg`);
      await run(paths.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '24k', file], { windowsHide: true });
    }
    const form = new FormData();
    form.append('model', openaiModel);
    form.append('language', language);
    form.append('file', new Blob([readFileSync(file)]), basename(file));
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
    if (file !== path) rmSync(file, { force: true });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`OpenAI: ${body?.error?.message ?? res.status}`);
    return { text: String(body.text ?? '').trim(), seconds: dur, engine: 'openai' };
  }
  if (!have.whisper() || !have.ffmpeg() || !have.model(model)) throw new Error('O motor local ainda não está pronto: em Extensões → Transcrição, clique em Preparar.');
  const wav = join(tmp, `${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  try {
    await run(paths.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { windowsHide: true });
    const { stdout } = await run(paths.whisper, ['-m', paths.model(model), '-f', wav, '-l', language, '-nt', '-np', '-t', String(Math.max(2, Math.min(8, (await import('node:os')).cpus().length - 1)))], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    return { text: stdout.replace(/\s+/g, ' ').trim(), seconds: dur, engine: 'local' };
  } finally { rmSync(wav, { force: true }); }
}

/** vídeo → alguns quadros (imagens que o agente vê) + a fala transcrita */
async function video({ path, out, frames = 8, engine, model, apiKey, openaiModel }) {
  if (!have.ffmpeg()) throw new Error('Para vídeo, prepare o motor local (ffmpeg) em Extensões → Transcrição.');
  if (!path || !existsSync(path)) throw new Error('Vídeo não encontrado.');
  const dur = (await seconds(path)) ?? 0;
  const dir = out ?? join(tmp, `v${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  // quadros espalhados pelo vídeo (1 a cada ~5 s, no máximo N), largura 768 (bom para o agente ver e leve)
  const n = Math.max(1, Math.min(frames, Math.ceil(dur / 5) || 1));
  const rate = dur > 0 ? n / dur : 1;
  const stem = basename(path, extname(path));
  await run(paths.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-vf', `fps=${rate.toFixed(4)},scale=768:-2`, '-frames:v', String(n), '-q:v', '4', join(dir, `${stem}-%02d.jpg`)], { windowsHide: true });
  const list = readdirSync(dir).filter(f => f.startsWith(`${stem}-`) && f.endsWith('.jpg')).sort().map(f => join(dir, f));
  let speech = '';
  try { speech = (await transcribe({ path, engine, model, apiKey, openaiModel })).text; } catch { /* vídeo sem áudio ou motor sem modelo: só os quadros */ }
  return { frames: list, transcript: speech, seconds: dur };
}

const calls = { status: async () => status(), setup, transcribe, video };
port.on('message', async e => {
  const { id, call, args } = e.data ?? {};
  try { port.postMessage({ id, result: await calls[call](args ?? {}) }); }
  catch (err) { port.postMessage({ id, error: err?.message ?? String(err) }); }
});
push();

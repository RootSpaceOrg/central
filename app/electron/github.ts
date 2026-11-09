/**
 * Versões publicadas da Central no GitHub (repositório público): lista e baixa direto por HTTPS, sem login.
 * Se o HTTPS falhar (rede, limite da API, repositório privado), cai para o `gh` logado.
 */
import { execFile } from 'node:child_process';
import { createWriteStream, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

export const REPO = 'RootSpaceOrg/central';
const API = `https://api.github.com/repos/${REPO}`;
const HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'central-app' };
const execFileP = promisify(execFile);

export interface Release { tag: string; publishedAt: string; assets: { name: string; url: string }[] }

export async function listReleases(): Promise<Release[]> {
  try {
    const r = await fetch(`${API}/releases?per_page=30`, { headers: HEADERS });
    if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`);
    return ((await r.json()) as { tag_name: string; published_at: string; draft: boolean; assets: { name: string; browser_download_url: string }[] }[])
      .filter(x => !x.draft).map(x => ({ tag: x.tag_name, publishedAt: x.published_at, assets: x.assets.map(a => ({ name: a.name, url: a.browser_download_url })) }));
  } catch {
    const { stdout } = await execFileP('gh', ['release', 'list', '-R', REPO, '--limit', '30', '--json', 'tagName,publishedAt'], { windowsHide: true });
    return (JSON.parse(stdout) as { tagName: string; publishedAt: string }[]).map(x => ({ tag: x.tagName, publishedAt: x.publishedAt, assets: [] }));
  }
}

/**
 * Baixa da versão `tag` (null = a mais recente) o primeiro arquivo cujo nome passa em `match`, para `dir`.
 * Devolve o caminho do arquivo baixado.
 */
export async function downloadAsset(tag: string | null, match: (name: string) => boolean, dir: string, ghPattern: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  try {
    const list = await listReleases();
    const rel = tag ? list.find(r => r.tag === tag) : list[0];
    const asset = rel?.assets.find(a => match(a.name));
    if (!asset) throw new Error('arquivo não está nessa versão');
    const r = await fetch(asset.url, { headers: { 'User-Agent': HEADERS['User-Agent'] }, redirect: 'follow' });
    if (!r.ok || !r.body) throw new Error(`download respondeu ${r.status}`);
    const file = join(dir, asset.name);
    await pipeline(Readable.fromWeb(r.body as never), createWriteStream(file));
    return file;
  } catch {
    // sem HTTPS: o gh logado (repositório privado, rede corporativa…)
    await execFileP('gh', ['release', 'download', ...(tag ? [tag] : []), '-R', REPO, '-p', ghPattern, '-D', dir, '--clobber'], { windowsHide: true });
    const got = readdirSync(dir).find(match);
    if (!got) throw new Error('O download não trouxe o arquivo.');
    return join(dir, got);
  }
}

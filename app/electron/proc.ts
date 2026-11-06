/**
 * Processos dos agentes (claude via shell) em Windows e macOS/Linux. No Windows, o taskkill /T derruba a árvore. Fora dele,
 * o processo nasce num grupo próprio (detached) e o grupo inteiro é encerrado (o shell e o claude dentro dele).
 */
import { execFile, execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';

/**
 * macOS: aberto pelo Finder ou pelo Dock, o app não herda o PATH do terminal (claude, git, gh, brew ficam em
 * /opt/homebrew/bin, ~/.local/bin…). Pega o PATH do shell de login do usuário; se falhar, acrescenta os lugares de sempre.
 */
export function fixPath(): void {
  if (IS_WIN) return;
  const usual = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local/bin'), join(homedir(), '.npm-global/bin')];
  try {
    const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__PATH__%s" "$PATH"'], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
    const shellPath = out.split('__PATH__').pop()?.trim();
    if (shellPath) process.env.PATH = [shellPath, ...usual].join(':');
  } catch {
    process.env.PATH = [process.env.PATH, ...usual].filter(Boolean).join(':');
  }
}

/** opções de spawn para dar para encerrar a árvore depois */
export const treeSpawn = IS_WIN ? {} : { detached: true };

export function killTree(pid: number | undefined, sync = false): void {
  if (!pid) return;
  if (IS_WIN) {
    if (sync) { try { execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* já saiu */ } }
    else execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {});
    return;
  }
  // grupo (-pid); se não for líder de grupo, o próprio processo
  const sig = sync ? 'SIGKILL' : 'SIGTERM';
  try { process.kill(-pid, sig); } catch { try { process.kill(pid, sig); } catch { /* já saiu */ } }
}

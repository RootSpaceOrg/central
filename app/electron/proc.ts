/**
 * Processos dos agentes (claude via shell) em Windows e macOS/Linux. No Windows, o taskkill /T derruba a árvore. Fora dele,
 * o processo nasce num grupo próprio (detached) e o grupo inteiro é encerrado (o shell e o claude dentro dele).
 */
import { execFile, execFileSync } from 'node:child_process';

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';

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

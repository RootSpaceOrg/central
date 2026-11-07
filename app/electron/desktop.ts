/**
 * Integração com o Windows: ícone na bandeja (fechar a janela não encerra, para rotinas e agentes seguirem
 * rodando), iniciar com o Windows (minimizado na bandeja) e notificações que levam à tela certa.
 */
import { BrowserWindow, Menu, Notification, Tray, app, nativeImage } from 'electron';
import { join } from 'node:path';

import type { Prefs } from '../src/app/shared/contract';
import { getSetting, setSetting } from './backlog';
import { NotifKind, NotifPrefs, parseNotif, shouldNotify } from './notif';

export const getNotif = () => parseNotif(getSetting('pref:notif'));
export function setNotif(patch: Partial<NotifPrefs>): NotifPrefs {
  const n = { ...getNotif(), ...patch };
  setSetting('pref:notif', JSON.stringify(n));
  return n;
}

const ICON = join(__dirname, '..', 'build', 'icon.png');
let tray: Tray | null = null;
let quitting = false;

export function getPrefs(): Prefs {
  return {
    tray: getSetting('pref:tray') !== '0',
    autostart: getSetting('pref:autostart') === '1',
    notify: getSetting('pref:notify') !== '0',
  };
}

export function setPrefs(patch: Partial<Prefs>, win: () => BrowserWindow | null, navigate: (route: string) => void): Prefs {
  if (patch.tray !== undefined) setSetting('pref:tray', patch.tray ? '1' : '0');
  if (patch.notify !== undefined) setSetting('pref:notify', patch.notify ? '1' : '0');
  if (patch.autostart !== undefined) {
    setSetting('pref:autostart', patch.autostart ? '1' : '0');
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: patch.autostart, args: ['--hidden'] });
  }
  const prefs = getPrefs();
  if (prefs.tray) setupTray(win, navigate);
  else { tray?.destroy(); tray = null; }
  return prefs;
}

export const markQuitting = () => { quitting = true; };

function show(win: BrowserWindow | null): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

export function setupTray(win: () => BrowserWindow | null, navigate: (route: string) => void): void {
  if (tray || !getPrefs().tray) return;
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Central');
  const go = (route: string) => () => { show(win()); navigate(route); };
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir a Central', click: () => show(win()) },
    { type: 'separator' },
    { label: 'Triagem', click: go('/triagem') },
    { label: 'Agentes', click: go('/agentes') },
    { label: 'Execuções', click: go('/execucoes') },
    { label: 'Rotinas', click: go('/rotinas') },
    { type: 'separator' },
    { label: 'Sair (para rotinas e agentes)', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => show(win()));
}

/** Com a bandeja ligada, fechar a janela só a esconde: rotinas e agentes continuam. */
export function keepAliveOnClose(win: BrowserWindow): void {
  win.on('close', e => {
    if (quitting || !getPrefs().tray || !tray) return;
    e.preventDefault();
    win.hide();
    if (!getSetting('tray:hinted')) {
      setSetting('tray:hinted', '1');
      notify('A Central continua rodando', 'Rotinas e agentes seguem trabalhando. Clique no ícone da bandeja para abrir, ou "Sair" no menu dele.', null, () => win, () => {});
    }
  });
}

/** kind e ok decidem se avisa (Preferências → Notificações); o som próprio toca na tela, o do sistema vem com o aviso */
export function notify(title: string, body: string, route: string | null, win: () => BrowserWindow | null, navigate: (route: string) => void,
  kind: NotifKind = 'system', ok = true): void {
  if (!getPrefs().notify || !Notification.isSupported()) return;
  const p = getNotif();
  if (!shouldNotify(p, kind, ok, new Date())) return;
  const n = new Notification({ title, body: body.slice(0, 220), icon: nativeImage.createFromPath(ICON), silent: p.sound !== 'system' });
  n.on('click', () => { show(win()); if (route) navigate(route); });
  n.show();
  if (p.sound !== 'system' && p.sound !== 'none') win()?.webContents.send('notify:sound', p.sound);
}

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { installBridge, isRemote, paired } from './app/mobile/bridge';

// no Electron: a Central completa. No navegador (o celular, pelo Tailscale): o app do celular, falando com o PC.
if (!isRemote()) {
  bootstrapApplication(App, appConfig).catch(err => console.error(err));
} else {
  const toPair = () => { if (!location.hash.startsWith('#/parear')) location.hash = '#/parear'; };
  installBridge(toPair);
  // instalável como app (o Chrome só aceita com cadeado: endereço https do Tailscale)
  if (isSecureContext && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  Promise.all([import('./app/mobile/mobile-app'), import('./app/mobile/mobile.config'), paired()]).then(([{ MobileApp }, { mobileConfig }, ok]) => {
    if (!ok) toPair();
    return bootstrapApplication(MobileApp, mobileConfig);
  }).catch(err => console.error(err));
}

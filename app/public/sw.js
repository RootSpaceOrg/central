// Service worker mínimo do app do celular: só o que o Chrome exige para instalar. Não guarda nada em cache
// (os dados vêm sempre do PC, ao vivo); sem conexão, mostra a mensagem do navegador.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

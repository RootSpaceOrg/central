import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { Routes, provideRouter, withComponentInputBinding, withHashLocation } from '@angular/router';

/** rotas do celular (só o que se resolve fora do PC) */
const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home-page').then(m => m.HomePage) },
  { path: 'para-voce', loadComponent: () => import('./pages/for-you-page').then(m => m.ForYouPage) },
  { path: 'um-a-um/:id', loadComponent: () => import('./pages/one-on-one-page').then(m => m.OneOnOnePage) },
  { path: 'conversas', loadComponent: () => import('./pages/chats-page').then(m => m.ChatsPage) },
  { path: 'conversas/novo/:agentId', loadComponent: () => import('./pages/chats-page').then(m => m.ChatPage) },
  { path: 'conversas/:id', loadComponent: () => import('./pages/chats-page').then(m => m.ChatPage) },
  { path: 'parear', loadComponent: () => import('./pages/pair-page').then(m => m.PairPage) },
  { path: 'parear/:code', loadComponent: () => import('./pages/pair-page').then(m => m.PairPage) },
  { path: '**', redirectTo: '' },
];

export const mobileConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners(), provideRouter(routes, withHashLocation(), withComponentInputBinding())],
};

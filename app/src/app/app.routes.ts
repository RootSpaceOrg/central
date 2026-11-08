import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', title: 'Início', loadComponent: () => import('./modules/home/pages/home-page/home-page').then(m => m.HomePage) },
  {
    path: 'visao-geral',
    title: 'Visão geral',
    loadComponent: () => import('./modules/overview/pages/overview-page/overview-page').then(m => m.OverviewPage),
  },
  { path: 'triagem', title: 'Triagem', loadComponent: () => import('./modules/inbox/pages/inbox-page/inbox-page').then(m => m.InboxPage) },
  { path: 'decisoes', redirectTo: 'triagem' },
  { path: 'ideias', title: 'Ideias', loadComponent: () => import('./modules/ideas/pages/ideas-page/ideas-page').then(m => m.IdeasPage) },
  { path: 'backlog', title: 'Backlog', loadComponent: () => import('./modules/backlog/pages/backlog-page/backlog-page').then(m => m.BacklogPage) },
  { path: 'agentes', title: 'Agentes', loadComponent: () => import('./modules/agents/pages/agents-page/agents-page').then(m => m.AgentsPage) },
  { path: 'execucoes', title: 'Execuções', loadComponent: () => import('./modules/runs/pages/runs-page/runs-page').then(m => m.RunsPage) },
  { path: 'extensoes', title: 'Extensões', loadComponent: () => import('./modules/extensions/pages/extensions-page/extensions-page').then(m => m.ExtensionsPage) },
  { path: 'extensoes/:id', title: 'Extensão', loadComponent: () => import('./modules/extensions/pages/extension-page/extension-page').then(m => m.ExtensionPage) },
  { path: 'guiar', title: 'Guiar', data: { kind: 'rumo' }, loadComponent: () => import('./modules/guide/pages/guide-page/guide-page').then(m => m.GuidePage) },
  { path: 'agencia', title: 'Agência', data: { kind: 'agencia' }, loadComponent: () => import('./modules/guide/pages/guide-page/guide-page').then(m => m.GuidePage) },
  { path: 'revisao', title: 'Revisão', loadComponent: () => import('./modules/review/pages/review-page/review-page').then(m => m.ReviewPage) },
  { path: 'rotinas', title: 'Rotinas', loadComponent: () => import('./modules/routines/pages/routines-page/routines-page').then(m => m.RoutinesPage) },
  {
    path: 'projetos/:slug',
    title: 'Projeto',
    loadComponent: () => import('./modules/project/pages/project-page/project-page').then(m => m.ProjectPage),
  },
  { path: 'quadros', title: 'Quadros', loadComponent: () => import('./modules/boards/pages/boards-page/boards-page').then(m => m.BoardsPage) },
  { path: 'quadros/:id', title: 'Quadro', loadComponent: () => import('./modules/boards/pages/board-page/board-page').then(m => m.BoardPage) },
  { path: 'escritorio', title: 'Escritório', loadComponent: () => import('./modules/office/pages/office-page/office-page').then(m => m.OfficePage) },
  { path: 'grade', title: 'Grade', loadComponent: () => import('./modules/grid/pages/grid-page/grid-page').then(m => m.GridPage) },
  { path: '**', redirectTo: '' },
];

import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'live-tracking',
    loadComponent: () =>
      import('./pages/live-tracking/live-tracking.component').then((m) => m.LiveTrackingComponent),
  },
  {
    path: 'analytics',
    loadComponent: () =>
      import('./pages/analytics/analytics.component').then((m) => m.AnalyticsComponent),
  },
  {
    path: 'reviews',
    loadComponent: () =>
      import('./pages/reviews/reviews.component').then((m) => m.ReviewsComponent),
  },
  {
    path: 'alerts',
    loadComponent: () =>
      import('./pages/alerts/alerts.component').then((m) => m.AlertsComponent),
  },
  {
    path: 'map',
    loadComponent: () =>
      import('./pages/map/map.component').then((m) => m.MapComponent),
  },
];

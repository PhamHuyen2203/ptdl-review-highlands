import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ThemeService } from '../../services/theme.service';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.css',
})
export class SidebarComponent {
  protected theme = inject(ThemeService);

  navItems: NavItem[] = [
    { path: '/dashboard', label: 'Tổng quan', icon: 'bi-grid-1x2-fill' },
    { path: '/live-tracking', label: 'Live Tracking', icon: 'bi-broadcast' },
    { path: '/analytics', label: 'Phân tích', icon: 'bi-bar-chart-line-fill' },
    { path: '/reviews', label: 'Đánh giá', icon: 'bi-chat-left-text-fill' },
    { path: '/alerts', label: 'Cảnh báo', icon: 'bi-bell-fill' },
    { path: '/map', label: 'Bản đồ', icon: 'bi-map-fill' },
  ];

  toggleTheme(): void {
    this.theme.toggle();
  }
}

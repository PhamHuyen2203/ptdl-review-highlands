import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, ReviewRecord, ReviewFilters } from '../../services/api.service';

@Component({
  selector: 'app-alerts',
  imports: [CommonModule, FormsModule, DecimalPipe],
  templateUrl: './alerts.component.html',
  styleUrl: './alerts.component.css',
})
export class AlertsComponent implements OnInit {
  private api = inject(ApiService);
  private cdr = inject(ChangeDetectorRef);

  alerts: ReviewRecord[] = [];
  filters: ReviewFilters = { districts: [], branches: [] };
  totalUnresponded = 0;
  topDistricts: { district: string; count: number }[] = [];
  loading = false;

  levelFilter = 'all';  // all | critical | warning
  districtFilter = 'all';

  ngOnInit(): void {
    this.api.getFilters().subscribe((f) => (this.filters = f));
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api
      .getAlerts({ level: this.levelFilter, district: this.districtFilter })
      .subscribe({
        next: (res) => {
          this.alerts = res.alerts;
          this.totalUnresponded = res.totalUnresponded;
          this.topDistricts = res.topDistricts;
          this.loading = false;
          this.cdr.detectChanges();
        },
        error: () => {
          this.loading = false;
          this.cdr.detectChanges();
        },
      });
  }

  stars(n: number): string {
    const r = Math.round(n);
    return '★'.repeat(r) + '☆'.repeat(5 - r);
  }

  urgencyLevel(r: ReviewRecord): 'critical' | 'high' | 'medium' {
    if (r.rating === 1) return 'critical';
    if (r.rating <= 2) return 'high';
    return 'medium';
  }

  urgencyLabel(r: ReviewRecord): string {
    const u = this.urgencyLevel(r);
    if (u === 'critical') return 'Khẩn cấp';
    if (u === 'high') return 'Cao';
    return 'Trung bình';
  }

  featList(r: ReviewRecord): string[] {
    const f: string[] = [];
    if (r.feat_staff) f.push('Nhân viên');
    if (r.feat_waiting) f.push('Chờ lâu');
    if (r.feat_quality) f.push('Đồ uống');
    if (r.feat_ambience) f.push('Không gian');
    if (r.feat_cleanliness) f.push('Vệ sinh');
    return f;
  }

  get criticalCount(): number {
    return this.alerts.filter((a) => a.rating === 1).length;
  }

  get highCount(): number {
    return this.alerts.filter((a) => a.rating === 2).length;
  }

  get mediumCount(): number {
    return this.alerts.filter((a) => a.rating === 3).length;
  }
}

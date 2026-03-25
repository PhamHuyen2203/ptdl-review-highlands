import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, ReviewRecord, ReviewFilters } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import {
  sentimentBadgeClass,
  sentimentPair,
  sentimentVn,
  starSentimentIcon,
  type SentKind,
} from '../../shared/sentiment-helpers';

@Component({
  selector: 'app-live-tracking',
  imports: [CommonModule, FormsModule, DecimalPipe],
  templateUrl: './live-tracking.component.html',
  styleUrl: './live-tracking.component.css',
})
export class LiveTrackingComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);

  reviews: ReviewRecord[] = [];
  filters: ReviewFilters = { districts: [], branches: [] };
  loading = false;
  /** Làm mới bảng (giữ dữ liệu cũ) thay vì ẩn cả bảng mỗi lần lọc. */
  tableLoading = false;
  total = 0;
  page = 1;
  limit = 50;

  // Filter state
  sentiment = 'all';
  district = 'all';
  branch = 'all';
  q = '';
  startDate = '';
  endDate = '';

  // Filtered branches based on selected district
  get filteredBranches() {
    if (this.district === 'all') return this.filters.branches;
    return this.filters.branches.filter((b) => b.district === this.district);
  }

  get totalPages(): number {
    return Math.ceil(this.total / this.limit);
  }

  get pages(): number[] {
    const total = this.totalPages;
    const cur = this.page;
    const pages: number[] = [];
    const start = Math.max(1, cur - 2);
    const end = Math.min(total, cur + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }

  ngOnInit(): void {
    this.api.getFilters().subscribe((f) => {
      this.filters = f;
    });
    this.load();
  }

  load(): void {
    const hasRows = this.reviews.length > 0;
    if (hasRows) this.tableLoading = true;
    else this.loading = true;
    const params: Record<string, string | number> = {
      page: this.page,
      limit: this.limit,
      sentiment: this.sentiment,
      district: this.district,
      branch: this.branch,
      q: this.q,
      startDate: this.startDate,
      endDate: this.endDate,
    };
    this.api.getReviews(params).subscribe({
      next: (res) => {
        this.reviews = res.data;
        this.total = res.total;
        this.loading = false;
        this.tableLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loading = false;
        this.tableLoading = false;
        this.cdr.detectChanges();
      },
    });
  }

  applyFilters(): void {
    this.page = 1;
    this.load();
  }

  onDistrictChange(): void {
    this.branch = 'all';
    this.page = 1;
    this.load();
  }

  goPage(p: number): void {
    if (p < 1 || p > this.totalPages) return;
    this.page = p;
    this.load();
  }

  reset(): void {
    this.sentiment = 'all';
    this.district = 'all';
    this.branch = 'all';
    this.q = '';
    this.startDate = '';
    this.endDate = '';
    this.page = 1;
    this.load();
  }

  exportCsv(): void {
    if (!this.reviews.length) {
      this.toast.show('Không có dòng nào để xuất.', 'warning');
      return;
    }
    const headers = [
      'Tên', 'Nội dung', 'Rating', 'Sao/Chữ', 'Chi nhánh', 'Quận', 'Thời gian', 'Owner phản hồi',
    ];
    const rows = this.reviews.map((r) => {
      const sp = sentimentPair(r);
      const sentCsv = `Sao:${sentimentVn(sp.star)}/Chữ:${sentimentVn(sp.text)}`;
      return [
      `"${(r.name || '').replace(/"/g, '""')}"`,
      `"${(r.review_text || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
      r.rating,
      sentCsv,
      `"${(r.title || r.branch_code || '').replace(/"/g, '""')}"`,
      r.district_folder,
      r.review_time,
      r.has_owner_response ? 'Có' : 'Không',
    ];
    });
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reviews_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast.success(`Đã xuất ${this.reviews.length} dòng ra CSV.`);
  }

  sentimentUi(r: ReviewRecord) {
    return sentimentPair(r);
  }

  sentimentVnLabel(kind: Parameters<typeof sentimentVn>[0]): string {
    return sentimentVn(kind);
  }

  sentimentBadge(kind: Parameters<typeof sentimentBadgeClass>[0]): string {
    return sentimentBadgeClass(kind);
  }

  starIcon(kind: SentKind): string {
    return starSentimentIcon(kind);
  }

  stars(n: number): string {
    const r = Math.round(n);
    return '★'.repeat(r) + '☆'.repeat(5 - r);
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
}

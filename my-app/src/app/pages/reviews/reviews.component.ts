import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, ReviewRecord, ReviewFilters } from '../../services/api.service';
import {
  sentimentBadgeClass,
  sentimentPair,
  sentimentVn,
  starSentimentIcon,
  type SentKind,
} from '../../shared/sentiment-helpers';

@Component({
  selector: 'app-reviews',
  imports: [CommonModule, FormsModule, DecimalPipe],
  templateUrl: './reviews.component.html',
  styleUrl: './reviews.component.css',
})
export class ReviewsComponent implements OnInit {
  private api = inject(ApiService);
  private cdr = inject(ChangeDetectorRef);

  reviews: ReviewRecord[] = [];
  filters: ReviewFilters = { districts: [], branches: [] };
  loading = false;
  tableLoading = false;
  total = 0;
  page = 1;
  limit = 20;

  // Filter state
  ratingFilter = 0; // 0 = all
  sentimentFilter = 'all';
  districtFilter = 'all';
  branchFilter = 'all';
  mismatchOnly = false;
  q = '';

  expandedId: string | null = null;

  get filteredBranches() {
    if (this.districtFilter === 'all') return this.filters.branches;
    return this.filters.branches.filter((b) => b.district === this.districtFilter);
  }

  get totalPages(): number {
    return Math.ceil(this.total / this.limit);
  }

  get pages(): number[] {
    const pages: number[] = [];
    const start = Math.max(1, this.page - 2);
    const end = Math.min(this.totalPages, this.page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }

  ngOnInit(): void {
    this.api.getFilters().subscribe((f) => (this.filters = f));
    this.load();
  }

  load(): void {
    if (this.reviews.length > 0) this.tableLoading = true;
    else this.loading = true;
    const params: Record<string, string | number> = {
      page: this.page,
      limit: this.limit,
      sentiment: this.sentimentFilter,
      district: this.districtFilter,
      branch: this.branchFilter,
      q: this.q,
    };
    if (this.ratingFilter > 0) params['rating'] = this.ratingFilter;
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
    this.branchFilter = 'all';
    this.applyFilters();
  }

  goPage(p: number): void {
    if (p < 1 || p > this.totalPages) return;
    this.page = p;
    this.load();
  }

  reset(): void {
    this.ratingFilter = 0;
    this.sentimentFilter = 'all';
    this.districtFilter = 'all';
    this.branchFilter = 'all';
    this.mismatchOnly = false;
    this.q = '';
    this.page = 1;
    this.load();
  }

  toggle(id: string): void {
    this.expandedId = this.expandedId === id ? null : id;
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

  ratingStars = [1, 2, 3, 4, 5];

  featList(r: ReviewRecord): string[] {
    const f: string[] = [];
    if (r.feat_staff) f.push('👤 Nhân viên');
    if (r.feat_waiting) f.push('⏱ Chờ lâu');
    if (r.feat_quality) f.push('☕ Đồ uống');
    if (r.feat_ambience) f.push('🏠 Không gian');
    if (r.feat_cleanliness) f.push('🧹 Vệ sinh');
    return f;
  }

  dayOfWeek(d: number): string {
    return ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][d] ?? '?';
  }
}

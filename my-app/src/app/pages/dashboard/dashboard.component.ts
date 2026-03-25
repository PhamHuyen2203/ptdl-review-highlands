import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ElementRef,
  inject,
  effect,
  DestroyRef,
  ChangeDetectorRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, DecimalPipe } from '@angular/common';
import { Chart } from 'chart.js/auto';
import { Subject, switchMap, startWith, catchError, finalize, EMPTY, tap } from 'rxjs';
import {
  ApiService,
  OverviewStats,
  TrendPoint,
  BranchRank,
  DistrictRank,
  PeriodPreset,
} from '../../services/api.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, DecimalPipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('trendChart') trendRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('ratingDistChart') ratingDistRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('districtChart') districtRef!: ElementRef<HTMLCanvasElement>;

  private api = inject(ApiService);
  private themeSvc = inject(ThemeService);
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);
  private readonly load$ = new Subject<void>();
  private charts: Chart[] = [];

  loading = true;
  preset: PeriodPreset = 'month';
  periodLabel = '';
  stats: OverviewStats | null = null;
  insights: string[] = [];
  branchRanking: BranchRank[] = [];
  districtRanking: DistrictRank[] = [];
  trendData: TrendPoint[] = [];
  ratingDist: { _id: number; count: number }[] = [];
  districtRisk: DistrictRank[] = [];
  branchSort: 'asc' | 'desc' = 'desc';

  readonly presets: { id: PeriodPreset; label: string }[] = [
    { id: 'month', label: 'Tháng' },
    { id: 'year', label: 'Năm' },
    { id: 'all', label: 'Tất cả' },
  ];

  private chartsReady = false;

  constructor() {
    effect(() => {
      this.themeSvc.mode();
      queueMicrotask(() => {
        if (this.chartsReady) this.redrawCharts();
      });
    });
  }

  ngOnInit(): void {
    this.load$
      .pipe(
        startWith(undefined),
        switchMap(() => {
          this.loading = true;
          return this.api.getDashboard(this.preset, this.branchSort).pipe(
            tap((d) => {
              this.periodLabel = d.period?.label ?? '';
              this.insights = d.insights ?? [];
              this.branchRanking = d.branchRanking ?? [];
              this.districtRanking = d.districtRanking ?? [];
              this.trendData = d.trend ?? [];
              this.ratingDist = d.ratingDist ?? [];
              this.districtRisk = d.districtRisk ?? [];
              this.stats =
                d.stats && typeof d.stats.totalReviews === 'number' && d.stats.totalReviews > 0
                  ? d.stats
                  : null;
            }),
            catchError(() => EMPTY),
            finalize(() => {
              this.loading = false;
              // Force change detection immediately so the @if(!loading) in template 
              // renders the canvas elements before we try to draw the charts.
              this.cdr.detectChanges();
              this.redrawCharts();
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  ngAfterViewInit(): void {
    this.chartsReady = true;
    this.redrawCharts();
  }

  ngOnDestroy(): void {
    this.charts.forEach((c) => c.destroy());
  }

  setPreset(p: PeriodPreset): void {
    if (this.preset === p) return;
    this.preset = p;
    this.load$.next();
  }

  toggleBranchSort(): void {
    this.branchSort = this.branchSort === 'desc' ? 'asc' : 'desc';
    this.load$.next();
  }

  private redrawCharts(): void {
    if (!this.chartsReady) return;
    if (this.trendData.length) this.renderTrendChart(this.trendData);
    this.renderRatingDistChart(this.ratingDist);
    if (this.districtRisk.length) this.renderDistrictChart(this.districtRisk);
  }

  private cssVar(name: string, fallback: string): string {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  private renderTrendChart(data: TrendPoint[]): void {
    const el = this.trendRef?.nativeElement;
    if (!el) return;
    this.charts.find((c) => c.canvas === el)?.destroy();
    this.charts = this.charts.filter((c) => c.canvas !== el);

    const tick = this.cssVar('--chart-text', '#95a5a6');
    const grid = this.cssVar('--chart-grid', '#1e1e3a');

    const chart = new Chart(el, {
      type: 'line',
      data: {
        labels: data.map((d) => d.label),
        datasets: [
          {
            label: 'Tỷ lệ tiêu cực (%)',
            data: data.map((d) => d.negRate),
            borderColor: '#e74c3c',
            backgroundColor: 'rgba(231,76,60,0.12)',
            fill: true,
            tension: 0.35,
            pointRadius: data.length > 20 ? 0 : 3,
            pointHoverRadius: 5,
            borderWidth: 2,
          },
          {
            label: 'Đánh giá TB',
            data: data.map((d) => d.avgRating),
            borderColor: '#f39c12',
            backgroundColor: 'rgba(243,156,18,0.06)',
            fill: false,
            tension: 0.35,
            pointRadius: data.length > 20 ? 0 : 3,
            yAxisID: 'y2',
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: tick, font: { size: 11 } } },
        },
        scales: {
          x: { ticks: { color: tick, maxRotation: 45, minRotation: 0, font: { size: 10 } }, grid: { color: grid } },
          y: {
            ticks: { color: tick, font: { size: 10 } },
            grid: { color: grid },
            title: { display: true, text: '% Tiêu cực', color: tick, font: { size: 10 } },
          },
          y2: {
            position: 'right',
            ticks: { color: tick, font: { size: 10 } },
            grid: { display: false },
            title: { display: true, text: 'Rating', color: tick, font: { size: 10 } },
            min: 0,
            max: 5,
          },
        },
      },
    });
    this.charts.push(chart);
  }

  private renderRatingDistChart(raw: { _id: number; count: number }[]): void {
    const el = this.ratingDistRef?.nativeElement;
    if (!el) return;
    this.charts.find((c) => c.canvas === el)?.destroy();
    this.charts = this.charts.filter((c) => c.canvas !== el);

    const tick = this.cssVar('--chart-text', '#95a5a6');
    const grid = this.cssVar('--chart-grid', '#1e1e3a');

    const stars = [1, 2, 3, 4, 5];
    const byStar = new Map<number, number>();
    raw.forEach((r) => byStar.set(Number(r._id), r.count));
    const counts = stars.map((s) => byStar.get(s) ?? 0);
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    let run = 0;
    const cumulativePct = counts.map((c) => {
      run += (c / total) * 100;
      return Math.round(run * 10) / 10;
    });

    const barColors = ['#c0392b', '#e67e22', '#95a5a6', '#2ecc71', '#27ae60'];
    const labels = stars.map((s) => `${s}★`);

    const chart = new Chart(el, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Số đánh giá',
            data: counts,
            backgroundColor: barColors,
            borderRadius: 6,
            borderSkipped: false,
          },
          {
            type: 'line',
            label: 'Tỷ lệ lũy kế (%)',
            data: cumulativePct,
            borderColor: '#3498db',
            backgroundColor: 'rgba(52,152,219,0.1)',
            yAxisID: 'y1',
            tension: 0.35,
            pointRadius: 3,
            pointBackgroundColor: '#3498db',
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: tick, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed.y;
                if (v == null) return '';
                if (ctx.datasetIndex === 0) return ` ${Number(v).toLocaleString()} đánh giá`;
                return ` Đã tích lũy ${v}% tổng số đánh giá`;
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: tick, font: { size: 11 } }, grid: { color: grid } },
          y: {
            beginAtZero: true,
            ticks: { color: tick, font: { size: 10 } },
            grid: { color: grid },
            title: { display: true, text: 'Số lượng', color: tick, font: { size: 10 } },
          },
          y1: {
            position: 'right',
            min: 0,
            max: 100,
            grid: { drawOnChartArea: false },
            ticks: { color: tick, font: { size: 10 } },
            title: { display: true, text: 'Lũy kế %', color: tick, font: { size: 10 } },
          },
        },
      },
    });
    this.charts.push(chart);
  }

  private renderDistrictChart(data: DistrictRank[]): void {
    const el = this.districtRef?.nativeElement;
    if (!el) return;
    this.charts.find((c) => c.canvas === el)?.destroy();
    this.charts = this.charts.filter((c) => c.canvas !== el);

    const tick = this.cssVar('--chart-text', '#95a5a6');
    const grid = this.cssVar('--chart-grid', '#1e1e3a');

    const chart = new Chart(el, {
      type: 'bar',
      data: {
        labels: data.map((d) => d.district),
        datasets: [
          {
            label: '% Tiêu cực',
            data: data.map((d) => d.negRate),
            backgroundColor: data.map((d) =>
              d.negRate > 20 ? 'rgba(231,76,60,0.85)' : d.negRate > 10 ? 'rgba(243,156,18,0.8)' : 'rgba(39,174,96,0.75)'
            ),
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.parsed.x}% tiêu cực`,
            },
          },
        },
        scales: {
          x: { ticks: { color: tick, font: { size: 10 } }, grid: { color: grid } },
          y: { ticks: { color: tick, font: { size: 10 } }, grid: { display: false } },
        },
      },
    });
    this.charts.push(chart);
  }

  getHealthColor(score: number): string {
    if (score >= 70) return 'var(--success)';
    if (score >= 50) return 'var(--warning)';
    return 'var(--accent)';
  }

  getRateColor(rate: number): string {
    if (rate < 10) return 'var(--success)';
    if (rate < 20) return 'var(--warning)';
    return 'var(--accent)';
  }

  stars(n: number): string {
    return '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
  }
}

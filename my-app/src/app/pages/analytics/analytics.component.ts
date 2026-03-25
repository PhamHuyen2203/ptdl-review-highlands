import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ElementRef,
  inject,
  DestroyRef,
  ChangeDetectorRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, DecimalPipe } from '@angular/common';
import { Chart } from 'chart.js/auto';
import { Subject, forkJoin, switchMap, startWith, catchError, finalize, EMPTY, tap, timeout, of, Observable } from 'rxjs';
import {
  ApiService,
  TrendPoint,
  KeywordCount,
  HeatmapPoint,
  ShiftData,
  DistrictRank,
  PeriodPreset,
} from '../../services/api.service';

@Component({
  selector: 'app-analytics',
  imports: [CommonModule, DecimalPipe],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.css',
})
export class AnalyticsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('trendChart') trendRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('keywordChart') keywordRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('shiftChart') shiftRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('districtRiskChart') districtRiskRef!: ElementRef<HTMLCanvasElement>;

  private api = inject(ApiService);
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);
  private readonly load$ = new Subject<void>();
  private charts: Chart[] = [];

  loading = true;
  hasLoadedOnce = false;
  preset: PeriodPreset = 'month';
  periodLabel = '';
  districtRisk: DistrictRank[] = [];
  heatmapData: number[][] = []; // [hour][day]
  heatmapMax = 1;
  insights: string[] = [];
  shiftData: ShiftData[] = [];

  readonly presets: { id: PeriodPreset; label: string }[] = [
    { id: 'month', label: 'Tháng' },
    { id: 'year', label: 'Năm' },
    { id: 'all', label: 'Tất cả' },
  ];

  private chartsReady = false;
  private pendingRenders: { key: string; fn: () => void }[] = [];
  private readonly requestTimeoutMs = 25000;

  private withTimeout<T>(obs: Observable<T>, fallback: T): Observable<T> {
    return obs.pipe(
      timeout(this.requestTimeoutMs),
      catchError(() => of(fallback))
    );
  }

  ngOnInit(): void {
    this.load$
      .pipe(
        startWith(undefined),
        switchMap(() => {
          this.loading = true;
          return forkJoin({
            insights: this.withTimeout(this.api.getInsights(this.preset), []),
            trend: this.withTimeout(this.api.getAnalyticsTrend(this.preset), []),
            keywords: this.withTimeout(this.api.getKeywords(this.preset), []),
            heatmap: this.withTimeout(this.api.getHeatmap(this.preset), []),
            shift: this.withTimeout(this.api.getShift(this.preset), []),
            districtRisk: this.withTimeout(this.api.getDistrictRisk(this.preset), []),
          }).pipe(
            tap((r) => {
              const labels: Record<PeriodPreset, string> = {
                month: '30 ngày qua',
                year: '12 tháng qua',
                all: 'Toàn thời gian',
              };
              this.periodLabel = labels[this.preset];
              this.insights = r.insights;
              this.buildHeatmap(r.heatmap);
              this.shiftData = r.shift;
              this.districtRisk = r.districtRisk.slice(0, 10);
              this.schedule('trend', () => this.renderTrend(r.trend));
              this.schedule('keyword', () => this.renderKeywords(r.keywords));
              this.schedule('shift', () => this.renderShift(r.shift));
              this.schedule('district', () => this.renderDistrictRisk(this.districtRisk));
              this.hasLoadedOnce = true;
            }),
            catchError(() => EMPTY),
            finalize(() => {
              this.loading = false;
              this.cdr.detectChanges();
              // Re-run scheduled renders now that the DOM is ready (loading=false)
              if (this.chartsReady) {
                this.pendingRenders.forEach((r) => r.fn());
                this.pendingRenders = [];
              }
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  ngAfterViewInit(): void {
    this.chartsReady = true;
    this.pendingRenders.forEach((r) => r.fn());
    this.pendingRenders = [];
  }

  ngOnDestroy(): void {
    this.charts.forEach((c) => c.destroy());
  }

  private schedule(key: string, fn: () => void): void {
    if (this.chartsReady) fn();
    else {
      const idx = this.pendingRenders.findIndex((r) => r.key === key);
      if (idx >= 0) this.pendingRenders[idx] = { key, fn };
      else this.pendingRenders.push({ key, fn });
    }
  }

  setPreset(p: PeriodPreset): void {
    if (this.preset === p) return;
    this.preset = p;
    this.load$.next();
  }

  private buildHeatmap(raw: HeatmapPoint[]): void {
    // 24 hours x 7 days
    const grid: number[][] = Array.from({ length: 24 }, () => new Array(7).fill(0));
    raw.forEach((p) => {
      const h = Math.floor(p.hour ?? 0);
      const d = Math.floor(p.day ?? 0);
      if (h >= 0 && h < 24 && d >= 0 && d < 7) grid[h][d] = p.count;
    });
    this.heatmapMax = Math.max(1, ...grid.flat());
    this.heatmapData = grid;
  }

  heatmapColor(val: number): string {
    const ratio = val / this.heatmapMax;
    if (ratio === 0) return 'rgba(26,26,46,0.5)';
    const r = Math.round(40 + ratio * 195);
    const g = Math.round(174 - ratio * 120);
    const b = Math.round(60 - ratio * 60);
    return `rgba(${r},${g},${b},${0.3 + ratio * 0.7})`;
  }

  heatmapTitle(hour: number, day: number): string {
    const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    return `${days[day]} ${hour}:00 — ${this.heatmapData[hour]?.[day] ?? 0} đánh giá tiêu cực`;
  }

  private renderTrend(data: TrendPoint[]): void {
    const el = this.trendRef?.nativeElement;
    if (!el) return;
    this.charts.find((c) => c.canvas === el)?.destroy();
    const chart = new Chart(el, {
      type: 'line',
      data: {
        labels: data.map((d) => d.label),
        datasets: [
          {
            label: '% Tiêu cực',
            data: data.map((d) => d.negRate),
            borderColor: '#e74c3c',
            backgroundColor: 'rgba(231,76,60,0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 3,
          },
          {
            label: '% Tích cực',
            data: data.map((d) => d.posRate ?? 0),
            borderColor: '#27ae60',
            backgroundColor: 'rgba(39,174,96,0.08)',
            fill: false,
            tension: 0.4,
            pointRadius: 3,
          },
          {
            label: 'Tổng',
            data: data.map((d) => d.total),
            borderColor: '#3498db',
            fill: false,
            tension: 0.4,
            pointRadius: 2,
            borderDash: [4, 4],
            yAxisID: 'y2',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#95a5a6', font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#606880', font: { size: 10 } }, grid: { color: '#1e1e3a' } },
          y: {
            ticks: { color: '#606880', font: { size: 10 } },
            grid: { color: '#1e1e3a' },
            title: { display: true, text: '%', color: '#606880' },
          },
          y2: {
            position: 'right',
            ticks: { color: '#606880', font: { size: 10 } },
            grid: { display: false },
            title: { display: true, text: 'Tổng', color: '#606880' },
          },
        },
      },
    });
    this.charts.push(chart);
  }

  private renderKeywords(data: KeywordCount[]): void {
    const el = this.keywordRef?.nativeElement;
    if (!el) return;
    this.charts.find((c) => c.canvas === el)?.destroy();
    const chart = new Chart(el, {
      type: 'bar',
      data: {
        labels: data.map((d) => d.label),
        datasets: [
          {
            label: 'Số lượt đề cập',
            data: data.map((d) => d.count),
            backgroundColor: ['#e74c3c', '#e67e22', '#f1c40f', '#3498db', '#9b59b6'].slice(
              0,
              data.length
            ),
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#606880', font: { size: 10 } }, grid: { color: '#1e1e3a' } },
          y: { ticks: { color: '#95a5a6', font: { size: 11 } }, grid: { display: false } },
        },
      },
    });
    this.charts.push(chart);
  }

  private renderShift(data: ShiftData[]): void {
    const el = this.shiftRef?.nativeElement;
    if (!el) return;
    this.charts.find((c) => c.canvas === el)?.destroy();
    const chart = new Chart(el, {
      type: 'bar',
      data: {
        labels: data.map((d) => d._id),
        datasets: [
          {
            label: 'Tổng đánh giá',
            data: data.map((d) => d.total),
            backgroundColor: 'rgba(52,152,219,0.6)',
            borderRadius: 4,
          },
          {
            label: 'Tiêu cực',
            data: data.map((d) => d.negative),
            backgroundColor: 'rgba(231,76,60,0.8)',
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#95a5a6', font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#95a5a6', font: { size: 10 } }, grid: { color: '#1e1e3a' } },
          y: { ticks: { color: '#606880', font: { size: 10 } }, grid: { color: '#1e1e3a' } },
        },
      },
    });
    this.charts.push(chart);
  }

  private renderDistrictRisk(data: DistrictRank[]): void {
    const el = this.districtRiskRef?.nativeElement;
    if (!el) return;
    this.charts.find((c) => c.canvas === el)?.destroy();
    const chart = new Chart(el, {
      type: 'bar',
      data: {
        labels: data.map((d) => d.district),
        datasets: [
          {
            label: '% Tiêu cực',
            data: data.map((d) => d.negRate),
            backgroundColor: data.map((d) =>
              d.negRate > 25
                ? 'rgba(231,76,60,0.9)'
                : d.negRate > 15
                  ? 'rgba(243,156,18,0.8)'
                  : 'rgba(39,174,96,0.7)'
            ),
            borderRadius: 5,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${c.parsed.x}% tiêu cực` } },
        },
        scales: {
          x: { ticks: { color: '#606880', font: { size: 10 } }, grid: { color: '#1e1e3a' } },
          y: { ticks: { color: '#95a5a6', font: { size: 10 } }, grid: { display: false } },
        },
      },
    });
    this.charts.push(chart);
  }

  hours = Array.from({ length: 24 }, (_, i) => i);
  days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  getRateColor(rate: number): string {
    if (rate < 10) return 'var(--success)';
    if (rate < 20) return 'var(--warning)';
    return 'var(--accent-light)';
  }
}

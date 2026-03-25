import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

const BASE = 'http://localhost:3000/api';

export interface OverviewStats {
  totalReviews: number;
  avgRating: number;
  sentimentScore: number;
  negativeRate: number;
  responseRate: number;
  healthyScore: number;
  totalBranches: number;
  totalDistricts: number;
}

export interface TrendPoint {
  label: string;
  total: number;
  negative: number;
  positive: number;
  avgRating: number;
  negRate: number;
  posRate: number;
}

export interface BranchRank {
  branch_code: string;
  title: string;
  district: string;
  total: number;
  negative: number;
  avgRating: number;
  negRate: number;
}

export interface DistrictRank {
  district: string;
  total: number;
  negative: number;
  branchCount: number;
  avgRating: number;
  negRate: number;
}

export interface ReviewRecord {
  _id: string;
  name: string;
  review_text: string;
  texttranslated: string;
  rating: number;
  sentiment_label: string;
  sentiment_score: number;
  /** Cảm xúc suy ra từ số sao */
  rating_sentiment?: string;
  is_negative_review: number;
  has_owner_response: number;
  owner_response: string;
  district_folder: string;
  branch_code: string;
  title: string;
  review_time: string;
  review_hour: number;
  review_dayofweek: number;
  feat_staff: boolean;
  feat_waiting: boolean;
  feat_quality: boolean;
  feat_ambience: boolean;
  feat_cleanliness: boolean;
  rating_text_mismatch_flag: number;
}

export interface ReviewsResponse {
  data: ReviewRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface ReviewFilters {
  districts: string[];
  branches: { _id: string; title: string; district: string }[];
}

export interface KeywordCount {
  label: string;
  count: number;
}

export interface HeatmapPoint {
  hour: number;
  day: number;
  count: number;
}

export interface ShiftData {
  _id: string;
  total: number;
  negative: number;
}

export interface AlertsResponse {
  alerts: ReviewRecord[];
  totalUnresponded: number;
  topDistricts: { district: string; count: number }[];
}

export interface MapDistrict {
  district: string;
  total: number;
  negative: number;
  branchCount: number;
  avgRating: number;
  avgLat: number;
  avgLng: number;
  negRate: number;
}

export interface MapBranch {
  branch_code: string;
  title: string;
  district: string;
  lat: number;
  lng: number;
  total: number;
  negative: number;
  avgRating: number;
  negRate: number;
  totalscore: number;
}

export type PeriodPreset = 'all' | 'month' | 'year';

export interface DashboardPeriod {
  preset: PeriodPreset;
  label: string;
  from: string | null;
  to: string | null;
}

export interface DashboardBundle {
  stats: OverviewStats;
  trend: TrendPoint[];
  /** Số đánh giá theo mức sao 1–5 (rating làm tròn). */
  ratingDist: { _id: number; count: number }[];
  branchRanking: BranchRank[];
  districtRanking: DistrictRank[];
  districtRisk: DistrictRank[];
  insights: string[];
  period: DashboardPeriod;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  /** Một request — tải nhanh trang Tổng quan */
  getDashboard(preset: PeriodPreset, sort: 'asc' | 'desc' = 'desc'): Observable<DashboardBundle> {
    return this.http.get<DashboardBundle>(`${BASE}/overview/dashboard`, {
      params: { preset, sort },
    });
  }

  // Overview (từng phần — có thể truyền preset)
  getStats(preset: PeriodPreset = 'all'): Observable<OverviewStats> {
    return this.http.get<OverviewStats>(`${BASE}/overview/stats`, { params: { preset } });
  }

  getTrend(preset: PeriodPreset = 'all'): Observable<TrendPoint[]> {
    return this.http.get<TrendPoint[]>(`${BASE}/overview/trend`, { params: { preset } });
  }

  getSentimentDist(preset: PeriodPreset = 'all'): Observable<{ _id: number; count: number }[]> {
    return this.http.get<{ _id: number; count: number }[]>(`${BASE}/overview/sentiment-dist`, {
      params: { preset },
    });
  }

  getBranchRanking(sort: 'asc' | 'desc' = 'desc', preset: PeriodPreset = 'all'): Observable<BranchRank[]> {
    return this.http.get<BranchRank[]>(`${BASE}/overview/branch-ranking`, {
      params: { sort, preset },
    });
  }

  getDistrictRanking(preset: PeriodPreset = 'all'): Observable<DistrictRank[]> {
    return this.http.get<DistrictRank[]>(`${BASE}/overview/district-ranking`, { params: { preset } });
  }

  getInsights(preset: PeriodPreset = 'all'): Observable<string[]> {
    return this.http.get<string[]>(`${BASE}/overview/insights`, { params: { preset } });
  }

  // Reviews
  getReviews(params: Record<string, string | number>): Observable<ReviewsResponse> {
    let p = new HttpParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') p = p.set(k, String(v));
    });
    return this.http.get<ReviewsResponse>(`${BASE}/reviews`, { params: p });
  }

  getFilters(): Observable<ReviewFilters> {
    return this.http.get<ReviewFilters>(`${BASE}/reviews/filters`);
  }

  // Analytics (preset = all | month | year)
  getAnalyticsTrend(preset: PeriodPreset = 'all'): Observable<TrendPoint[]> {
    return this.http.get<TrendPoint[]>(`${BASE}/analytics/trend`, { params: { preset } });
  }

  getKeywords(preset: PeriodPreset = 'all'): Observable<KeywordCount[]> {
    return this.http.get<KeywordCount[]>(`${BASE}/analytics/keywords`, { params: { preset } });
  }

  getHeatmap(preset: PeriodPreset = 'all'): Observable<HeatmapPoint[]> {
    return this.http.get<HeatmapPoint[]>(`${BASE}/analytics/heatmap`, { params: { preset } });
  }

  getShift(preset: PeriodPreset = 'all'): Observable<ShiftData[]> {
    return this.http.get<ShiftData[]>(`${BASE}/analytics/shift`, { params: { preset } });
  }

  getDistrictRisk(preset: PeriodPreset = 'all'): Observable<DistrictRank[]> {
    return this.http.get<DistrictRank[]>(`${BASE}/analytics/district-risk`, { params: { preset } });
  }

  // Alerts
  getAlerts(params: Record<string, string>): Observable<AlertsResponse> {
    let p = new HttpParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) p = p.set(k, v);
    });
    return this.http.get<AlertsResponse>(`${BASE}/alerts`, { params: p });
  }

  // Map
  getMapData(): Observable<MapDistrict[]> {
    return this.http.get<MapDistrict[]>(`${BASE}/map/data`);
  }

  getMapBranches(): Observable<MapBranch[]> {
    return this.http.get<MapBranch[]>(`${BASE}/map/branches`);
  }
}

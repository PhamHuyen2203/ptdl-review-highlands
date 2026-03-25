import { Component, OnInit, OnDestroy, AfterViewInit, inject, effect, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, MapDistrict, MapBranch } from '../../services/api.service';
import { ThemeService } from '../../services/theme.service';

declare const L: any;

const DISTRICT_COORDS: Record<string, [number, number]> = {
  'Quận 1': [10.7731, 106.697],
  'Quận 2': [10.7961, 106.7451],
  'Quận 3': [10.7797, 106.6912],
  'Quận 4': [10.757, 106.7036],
  'Quận 5': [10.7549, 106.6668],
  'Quận 6': [10.7479, 106.6369],
  'Quận 7': [10.7325, 106.7222],
  'Quận 8': [10.723, 106.6689],
  'Quận 9': [10.8441, 106.786],
  'Quận 10': [10.7752, 106.6671],
  'Quận 11': [10.7661, 106.6578],
  'Quận 12': [10.8637, 106.6652],
  'Bình Chánh': [10.6851, 106.596],
  'Bình Tân': [10.7656, 106.6113],
  'Bình Thạnh': [10.8119, 106.7092],
  'Gò Vấp': [10.8381, 106.6655],
  'Hóc Môn': [10.8886, 106.5948],
  'Nhà Bè': [10.6882, 106.7388],
  'Thủ Đức': [10.8567, 106.751],
  'Tân Bình': [10.8022, 106.6529],
  'Tân Phú': [10.7874, 106.6249],
  'Củ Chi': [11.0174, 106.4947],
};

@Component({
  selector: 'app-map',
  imports: [CommonModule, FormsModule, DecimalPipe],
  templateUrl: './map.component.html',
  styleUrl: './map.component.css',
})
export class MapComponent implements OnInit, AfterViewInit, OnDestroy {
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  private cdr = inject(ChangeDetectorRef);

  private map: any;
  private districtLayer: any;
  private branchLayer: any;
  private markersMap: Record<string, any> = {};

  districts: MapDistrict[] = [];
  branches: MapBranch[] = [];
  selectedDistrict: MapDistrict | null = null;
  districtBranches: MapBranch[] = [];

  viewMode: 'district' | 'branch' = 'district';
  loading = true;

  constructor() {
    effect(() => {
      this.theme.mode();
      queueMicrotask(() => this.applyMapTileTheme());
    });
  }

  ngOnInit(): void {
    this.loadData();
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    if (this.map) this.map.remove();
  }

  private initMap(): void {
    this.map = L.map('leaflet-map').setView([10.78, 106.66], 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(this.map);

    this.applyMapTileTheme();
  }

  private applyMapTileTheme(): void {
    const tiles = document.querySelector('#leaflet-map .leaflet-tile-pane') as HTMLElement | null;
    if (!tiles) return;
    tiles.style.filter =
      this.theme.mode() === 'dark'
        ? 'invert(90%) hue-rotate(200deg) brightness(0.85) saturate(0.9)'
        : 'none';
  }

  private loadData(): void {
    Promise.all([
      new Promise<void>((resolve) => {
        this.api.getMapData().subscribe((d) => {
          this.districts = d;
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        this.api.getMapBranches().subscribe((b) => {
          this.branches = b;
          resolve();
        });
      }),
    ]).then(() => {
      this.loading = false;
      this.cdr.detectChanges();
      this.renderDistrictMarkers();
    });
  }

  private renderDistrictMarkers(): void {
    if (!this.map) return;
    if (this.districtLayer) this.districtLayer.remove();
    this.districtLayer = L.layerGroup().addTo(this.map);

    this.districts.forEach((d) => {
      const coords = DISTRICT_COORDS[d.district] ?? [d.avgLat, d.avgLng];
      if (!coords || !coords[0]) return;

      const radius = Math.max(800, Math.min(3000, d.total * 2));
      const color = this.negRateColor(d.negRate);

      const circle = L.circle(coords, {
        color,
        fillColor: color,
        fillOpacity: 0.35,
        weight: 2,
        radius,
      }).addTo(this.districtLayer);

      circle.bindPopup(this.districtPopup(d));
      circle.on('click', () => this.selectDistrict(d));

      const label = L.divIcon({
        className: '',
        html: `<div class="map-label">${d.district}<br><small>${d.negRate}%</small></div>`,
        iconAnchor: [40, 10],
      });
      L.marker(coords, { icon: label }).addTo(this.districtLayer);
    });
  }

  private renderBranchMarkers(): void {
    if (!this.map) return;
    if (this.branchLayer) this.branchLayer.remove();
    this.branchLayer = L.layerGroup().addTo(this.map);

    this.branches.forEach((b) => {
      if (!b.lat || !b.lng) return;
      const color = this.negRateColor(b.negRate);
      const marker = L.circleMarker([b.lat, b.lng], {
        radius: 7,
        color,
        fillColor: color,
        fillOpacity: 0.8,
        weight: 2,
      }).addTo(this.branchLayer);

      marker.bindPopup(`
        <div style="font-family:sans-serif;min-width:180px">
          <strong>${b.title || b.branch_code}</strong><br>
          <small style="color:#888">${b.district}</small><br><br>
          <b>Rating:</b> ${b.avgRating} ★<br>
          <b>Tổng reviews:</b> ${b.total}<br>
          <b>% Tiêu cực:</b> <span style="color:${color}">${b.negRate}%</span>
        </div>
      `);
    });
  }

  private districtPopup(d: MapDistrict): string {
    const color = this.negRateColor(d.negRate);
    return `
      <div style="font-family:sans-serif;min-width:200px">
        <strong style="font-size:1rem">${d.district}</strong><br><br>
        <b>Chi nhánh:</b> ${d.branchCount}<br>
        <b>Tổng reviews:</b> ${d.total}<br>
        <b>Rating TB:</b> ${d.avgRating} ★<br>
        <b>Tiêu cực:</b> <span style="color:${color};font-weight:700">${d.negRate}%</span><br>
        <b>Mức rủi ro:</b> ${d.negRate > 25 ? '🔴 Cao' : d.negRate > 15 ? '🟡 Trung bình' : '🟢 Thấp'}
      </div>
    `;
  }

  selectDistrict(d: MapDistrict): void {
    this.selectedDistrict = d;
    this.districtBranches = this.branches.filter((b) => b.district === d.district);
    const coords = DISTRICT_COORDS[d.district] ?? [d.avgLat, d.avgLng];
    if (coords && coords[0]) this.map.flyTo(coords, 13, { duration: 0.8 });
  }

  clearSelection(): void {
    this.selectedDistrict = null;
    this.map.setView([10.78, 106.66], 11);
  }

  toggleMode(mode: 'district' | 'branch'): void {
    this.viewMode = mode;
    if (mode === 'branch') {
      if (this.districtLayer) this.districtLayer.remove();
      this.renderBranchMarkers();
    } else {
      if (this.branchLayer) this.branchLayer.remove();
      this.renderDistrictMarkers();
    }
  }

  private negRateColor(rate: number): string {
    if (rate > 25) return '#e74c3c';
    if (rate > 15) return '#e67e22';
    if (rate > 8) return '#f1c40f';
    return '#27ae60';
  }

  negRateColorCss(rate: number): string {
    return this.negRateColor(rate);
  }

  getRiskLabel(rate: number): string {
    if (rate > 25) return 'Cao';
    if (rate > 15) return 'Trung bình';
    return 'Thấp';
  }
}

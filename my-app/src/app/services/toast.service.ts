import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 0;
  readonly items = signal<ToastItem[]>([]);

  show(message: string, type: ToastType = 'info', durationMs = 5000): void {
    const id = ++this.nextId;
    this.items.update((list) => [...list, { id, message, type }]);
    if (durationMs > 0) {
      setTimeout(() => this.dismiss(id), durationMs);
    }
  }

  success(msg: string): void {
    this.show(msg, 'success');
  }

  error(msg: string): void {
    this.show(msg, 'error', 7000);
  }

  dismiss(id: number): void {
    this.items.update((list) => list.filter((t) => t.id !== id));
  }
}

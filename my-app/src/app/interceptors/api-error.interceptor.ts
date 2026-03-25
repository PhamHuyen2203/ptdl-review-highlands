import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../services/toast.service';

export const apiErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService);
  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (req.url.includes('/api/')) {
        const body = err.error as { error?: string } | undefined;
        const msg =
          body?.error ||
          (typeof err.error === 'string' ? err.error : null) ||
          err.message ||
          'Không thể kết nối máy chủ';
        if (err.status === 0) {
          toast.error('Mất kết nối API. Hãy chạy backend (my-server) và kiểm tra MongoDB.');
        } else if (err.status >= 400) {
          toast.error(msg);
        }
      }
      return throwError(() => err);
    })
  );
};

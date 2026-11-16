import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface SnipLink {
  code: string;
  url: string;
  shortUrl: string;
  hits: number;
  createdAt: string;
}
export interface ApiError { error: string; }

@Injectable({ providedIn: 'root' })
export class LinkService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = '/api/links';

  list(): Observable<SnipLink[]> {
    return this.http.get<SnipLink[]>(this.endpoint);
  }
  create(url: string): Observable<SnipLink> {
    return this.http.post<SnipLink>(this.endpoint, { url });
  }
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'Cannot reach Snip. Check the backend connection and try again.';
    const body = error.error as Partial<ApiError> | null;
    if (body && typeof body.error === 'string' && body.error.trim()) return body.error;
  }
  return fallback;
}

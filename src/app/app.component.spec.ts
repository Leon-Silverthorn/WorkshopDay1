import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { SnipLink } from './link.service';

describe('Snip frontend', () => {
  let fixture: ComponentFixture<AppComponent>;
  let app: AppComponent;
  let http: HttpTestingController;
  const link: SnipLink = {
    code: 'Ab12Cd', url: 'https://example.com/a-long-path',
    shortUrl: 'http://localhost:3000/Ab12Cd', hits: 0, createdAt: '2026-11-16T00:00:00.000Z'
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();
    fixture = TestBed.createComponent(AppComponent);
    app = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });
  afterEach(() => {
    http.verify();
    fixture.destroy();
  });
  function initialList(links: SnipLink[] = []): void {
    http.expectOne({ method: 'GET', url: '/api/links' }).flush(links);
    fixture.detectChanges();
  }
  function text(): string { return fixture.nativeElement.textContent; }
  function input(): HTMLInputElement { return fixture.nativeElement.querySelector('#url'); }

  it('shows loading then an accessible empty state', () => {
    expect(text()).toContain('Loading links');
    initialList();
    expect(text()).toContain('A fresh start.');
    expect(input().getAttribute('aria-describedby')).toContain('url-error');
    expect(fixture.nativeElement.querySelector('label').htmlFor).toBe('url');
    expect(app.loading()).toBeFalse();
  });

  it('rejects empty, malformed, and non-HTTP(S) input without posting', () => {
    initialList();
    for (const value of ['', '  ', 'example.com', 'https://', 'javascript:alert(1)', 'ftp://example.com']) {
      app.form.controls.url.setValue(value);
      app.submit();
      expect(app.form.invalid).withContext(value).toBeTrue();
      expect(app.urlError).withContext(value).toBeTruthy();
    }
    fixture.detectChanges();
    expect(input().getAttribute('aria-invalid')).toBe('true');
    http.expectNone(req => req.method === 'POST');
    for (const value of ['http://example.com', '  https://example.com/a?q=1#hash  ']) {
      app.form.controls.url.setValue(value);
      expect(app.form.valid).withContext(value).toBeTrue();
    }
  });

  it('posts a trimmed URL once, locks controls, shows the returned link and refreshes rows', () => {
    initialList();
    app.form.controls.url.setValue('  ' + link.url + '  ');
    app.submit();
    app.submit();
    fixture.detectChanges();
    expect(app.submitting()).toBeTrue();
    expect(input().disabled).toBeTrue();
    expect((fixture.nativeElement.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBeTrue();
    const request = http.expectOne({ method: 'POST', url: '/api/links' });
    expect(request.request.body).toEqual({ url: link.url });
    request.flush(link, { status: 201, statusText: 'Created' });
    http.expectOne({ method: 'GET', url: '/api/links' }).flush([link]);
    fixture.detectChanges();
    expect(app.submitting()).toBeFalse();
    expect(input().disabled).toBeFalse();
    expect(app.form.controls.url.value).toBe('');
    expect(text()).toContain('Ready to share');
    const anchor = fixture.nativeElement.querySelector('.short-link') as HTMLAnchorElement;
    expect(anchor.href).toBe(link.shortUrl);
    expect(anchor.rel).toContain('noopener');
    expect(text()).toContain(link.url);
    expect(fixture.nativeElement.querySelector('td.hits').textContent.trim()).toBe('0');
  });

  it('cancels a stale initial list before reloading after creation', () => {
    const stale = http.expectOne({ method: 'GET', url: '/api/links' });
    app.form.controls.url.setValue(link.url);
    app.submit();
    http.expectOne({ method: 'POST', url: '/api/links' }).flush(link);
    expect(stale.cancelled).toBeTrue();
    http.expectOne({ method: 'GET', url: '/api/links' }).flush([link]);
    expect(app.links()).toEqual([link]);
    expect(app.loading()).toBeFalse();
  });

  it('shows a server validation error beside the input and allows correction', () => {
    initialList();
    app.form.controls.url.setValue(link.url);
    app.submit();
    http.expectOne({ method: 'POST', url: '/api/links' })
      .flush({ error: 'url must be a valid HTTP or HTTPS URL' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(text()).toContain('url must be a valid HTTP or HTTPS URL');
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(app.form.controls.url.value).toBe(link.url);
    expect(app.submitting()).toBeFalse();
    app.form.controls.url.setValue('https://example.org');
    expect(app.fieldError()).toBeNull();
  });

  it('keeps the URL and unlocks submission after a network failure, then permits retry', () => {
    initialList();
    app.form.controls.url.setValue(link.url);
    app.submit();
    http.expectOne({ method: 'POST', url: '/api/links' }).error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(text()).toContain('Cannot reach Snip');
    expect(app.form.controls.url.value).toBe(link.url);
    expect(app.submitting()).toBeFalse();
    app.submit();
    http.expectOne({ method: 'POST', url: '/api/links' }).flush(link);
    http.expectOne({ method: 'GET', url: '/api/links' }).flush([link]);
    expect(app.created()).toEqual(link);
  });

  it('handles a non-JSON server failure with a useful fallback', () => {
    initialList();
    app.form.controls.url.setValue(link.url);
    app.submit();
    http.expectOne({ method: 'POST', url: '/api/links' })
      .flush('Gateway failure', { status: 502, statusText: 'Bad Gateway' });
    fixture.detectChanges();
    expect(text()).toContain('Could not shorten this URL');
    expect(app.submitting()).toBeFalse();
  });

  it('shows initial list failure without a misleading empty message and recovers', () => {
    http.expectOne({ method: 'GET', url: '/api/links' })
      .flush({ error: 'Temporarily unavailable' }, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(text()).toContain('Temporarily unavailable');
    expect(text()).not.toContain('A fresh start.');
    expect(app.loading()).toBeFalse();
    app.refresh();
    http.expectOne({ method: 'GET', url: '/api/links' }).flush([link]);
    expect(app.listError()).toBeNull();
    expect(app.links()).toEqual([link]);
  });

  it('preserves rows when refresh fails and updates hit counts when focus returns', () => {
    initialList([link]);
    app.refresh();
    http.expectOne({ method: 'GET', url: '/api/links' }).error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(text()).toContain(link.url);
    expect(text()).toContain('Previously loaded links may be out of date.');
    app.onWindowFocus();
    http.expectOne({ method: 'GET', url: '/api/links' }).flush([{ ...link, hits: 1 }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('td.hits').textContent.trim()).toBe('1');
  });
});

import { Component, DestroyRef, HostListener, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Subscription, finalize } from 'rxjs';
import { LinkService, SnipLink, apiErrorMessage } from './link.service';
import { httpUrlValidator } from './http-url.validator';

@Component({
  selector: 'app-root',
  imports: [ReactiveFormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  private readonly api = inject(LinkService);
  private readonly destroyRef = inject(DestroyRef);
  private listRequest?: Subscription;

  readonly form = new FormGroup({
    url: new FormControl('', { nonNullable: true, validators: [httpUrlValidator] })
  });
  readonly links = signal<SnipLink[]>([]);
  readonly loading = signal(false);
  readonly listError = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly fieldError = signal<string | null>(null);
  readonly submitError = signal<string | null>(null);
  readonly created = signal<SnipLink | null>(null);

  constructor() {
    this.form.controls.url.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.fieldError.set(null);
      this.submitError.set(null);
    });
  }
  ngOnInit(): void { this.refresh(); }

  get urlError(): string | null {
    if (this.fieldError()) return this.fieldError();
    const control = this.form.controls.url;
    if (!control.touched || control.valid) return null;
    return control.hasError('required')
      ? 'Paste a URL to shorten.'
      : 'Enter a complete HTTP or HTTPS URL, such as https://example.com.';
  }

  refresh(): void {
    // Supersede any list request started before a successful POST.
    this.listRequest?.unsubscribe();
    this.loading.set(true);
    this.listError.set(null);
    this.listRequest = this.api.list().pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: links => this.links.set(links),
      error: error => this.listError.set(apiErrorMessage(error, 'Could not load your links. Try refreshing.'))
    });
  }

  @HostListener('window:focus')
  onWindowFocus(): void {
    if (!this.loading() && !this.submitting()) this.refresh();
  }

  submit(): void {
    if (this.submitting()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const url = this.form.controls.url.value.trim();
    this.submitting.set(true);
    this.fieldError.set(null);
    this.submitError.set(null);
    this.created.set(null);
    this.form.disable({ emitEvent: false });
    this.api.create(url).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => {
        this.form.enable({ emitEvent: false });
        this.submitting.set(false);
      })
    ).subscribe({
      next: link => {
        this.created.set(link);
        this.form.reset();
        this.refresh();
      },
      error: error => {
        const message = apiErrorMessage(error, 'Could not shorten this URL. Please try again.');
        if (error instanceof HttpErrorResponse && error.status === 400) {
          this.fieldError.set(message);
        } else {
          this.submitError.set(message);
        }
      }
    });
  }
}

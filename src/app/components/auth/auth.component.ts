import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { signIn, signUp, confirmSignUp, resetPassword, confirmResetPassword } from 'aws-amplify/auth';

type AuthStep = 'SIGN_IN' | 'SIGN_UP' | 'CONFIRM_SIGN_UP' | 'RESET_PASSWORD' | 'CONFIRM_RESET_PASSWORD';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="auth-container">
      <div class="auth-card">

        <!-- Logo -->
        <div class="auth-logo">
          <div class="logo-mark">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          </div>
          <span class="logo-name">DocAssistant</span>
        </div>

        <!-- Title -->
        <div class="auth-title-block">
          <h1>{{ getTitle() }}</h1>
          <p class="auth-subtitle">{{ getSubtitle() }}</p>
        </div>

        <!-- Alerts -->
        <div *ngIf="errorMessage()" class="auth-alert auth-alert-error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {{ errorMessage() }}
        </div>
        <div *ngIf="successMessage()" class="auth-alert auth-alert-success">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          {{ successMessage() }}
        </div>

        <form (ngSubmit)="onSubmit()" #authForm="ngForm" autocomplete="off">

          <!-- EMAIL -->
          <div *ngIf="step() !== 'CONFIRM_SIGN_UP' && step() !== 'CONFIRM_RESET_PASSWORD'" class="field-group">
            <label class="field-label">Email</label>
            <input
              type="email"
              name="email"
              class="field-input"
              placeholder="ban@email.com"
              [(ngModel)]="email"
              required
              email
              autocomplete="email"
            />
          </div>

          <!-- PASSWORD -->
          <div *ngIf="step() === 'SIGN_IN' || step() === 'SIGN_UP' || step() === 'CONFIRM_RESET_PASSWORD'" class="field-group">
            <label class="field-label">Mật khẩu</label>
            <div class="password-wrapper">
              <input
                [type]="showPassword() ? 'text' : 'password'"
                name="password"
                class="field-input password-input"
                placeholder="Tối thiểu 8 ký tự"
                [(ngModel)]="password"
                required
                minlength="8"
                autocomplete="current-password"
              />
              <button type="button" class="eye-btn" (click)="togglePassword()" [attr.aria-label]="showPassword() ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'">
                <svg *ngIf="!showPassword()" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                <svg *ngIf="showPassword()" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- CONFIRM PASSWORD (sign up only) -->
          <div *ngIf="step() === 'SIGN_UP'" class="field-group">
            <label class="field-label">Xác nhận mật khẩu</label>
            <div class="password-wrapper">
              <input
                [type]="showConfirmPassword() ? 'text' : 'password'"
                name="confirmPassword"
                class="field-input password-input"
                placeholder="Nhập lại mật khẩu"
                [(ngModel)]="confirmPassword"
                required
                autocomplete="new-password"
              />
              <button type="button" class="eye-btn" (click)="toggleConfirmPassword()" [attr.aria-label]="showConfirmPassword() ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'">
                <svg *ngIf="!showConfirmPassword()" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                <svg *ngIf="showConfirmPassword()" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              </button>
            </div>
            <!-- Password strength indicator -->
            <div *ngIf="password.length > 0" class="strength-bar-container">
              <div class="strength-bar">
                <div class="strength-fill" [class]="getPasswordStrengthClass()" [style.width]="getPasswordStrengthWidth()"></div>
              </div>
              <span class="strength-label" [class]="getPasswordStrengthClass()">{{ getPasswordStrengthLabel() }}</span>
            </div>
          </div>

          <!-- OTP CODE -->
          <div *ngIf="step() === 'CONFIRM_SIGN_UP' || step() === 'CONFIRM_RESET_PASSWORD'" class="field-group">
            <label class="field-label">Mã xác thực (OTP)</label>
            <input
              type="text"
              name="code"
              class="field-input otp-input"
              placeholder="• • • • • •"
              [(ngModel)]="code"
              required
              maxlength="6"
              autocomplete="one-time-code"
              inputmode="numeric"
            />
            <p class="field-hint">Kiểm tra hộp thư đến (và thư mục spam) để lấy mã 6 chữ số.</p>
          </div>

          <!-- Forgot password link inline -->
          <div *ngIf="step() === 'SIGN_IN'" class="forgot-row">
            <a href="javascript:void(0)" (click)="setStep('RESET_PASSWORD')">Quên mật khẩu?</a>
          </div>

          <button type="submit" class="submit-btn" [disabled]="loading() || !authForm.form.valid">
            <span *ngIf="loading()" class="btn-spinner"></span>
            <span>{{ getSubmitBtnText() }}</span>
          </button>
        </form>

        <!-- Footer links -->
        <div class="auth-footer">
          <span *ngIf="step() === 'SIGN_IN'">Chưa có tài khoản? <a href="javascript:void(0)" (click)="setStep('SIGN_UP')">Đăng ký</a></span>
          <span *ngIf="step() === 'SIGN_UP'">Đã có tài khoản? <a href="javascript:void(0)" (click)="setStep('SIGN_IN')">Đăng nhập</a></span>
          <span *ngIf="step() !== 'SIGN_IN' && step() !== 'SIGN_UP'">
            <a href="javascript:void(0)" (click)="setStep('SIGN_IN')">← Quay lại đăng nhập</a>
          </span>
        </div>

      </div>
    </div>
  `,
  styles: [`
    .auth-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 1.5rem;
    }

    .auth-card {
      width: 100%;
      max-width: 420px;
      background: var(--surface-color);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border-color);
      border-radius: var(--border-radius-lg);
      box-shadow: var(--shadow-lg);
      padding: 2.5rem 2.25rem;
    }

    .auth-logo {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-bottom: 1.75rem;
    }
    .logo-mark {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, var(--primary), var(--primary-hover));
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      flex-shrink: 0;
    }
    .logo-name {
      font-size: 1.1rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text-primary);
    }

    .auth-title-block {
      margin-bottom: 1.75rem;
    }
    .auth-title-block h1 {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 0.25rem;
      letter-spacing: -0.03em;
    }
    .auth-subtitle {
      font-size: 0.875rem;
      color: var(--text-muted);
    }

    .auth-alert {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-radius: var(--border-radius-sm);
      font-size: 0.875rem;
      line-height: 1.5;
      margin-bottom: 1.25rem;
    }
    .auth-alert svg { flex-shrink: 0; margin-top: 1px; }
    .auth-alert-error {
      background: var(--error-bg);
      color: var(--error);
      border: 1px solid rgba(239,68,68,0.2);
    }
    .auth-alert-success {
      background: var(--success-bg);
      color: var(--success);
      border: 1px solid rgba(16,185,129,0.2);
    }

    .field-group {
      margin-bottom: 1.1rem;
    }
    .field-label {
      display: block;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--text-secondary);
      margin-bottom: 0.4rem;
    }
    .field-input {
      width: 100%;
      padding: 0.7rem 0.9rem;
      font-size: 0.9375rem;
      font-family: var(--font-sans);
      color: var(--text-primary);
      background: var(--input-bg);
      border: 1px solid var(--border-color);
      border-radius: var(--border-radius-sm);
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .field-input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--primary-glow);
    }
    .field-hint {
      font-size: 0.78rem;
      color: var(--text-muted);
      margin-top: 0.4rem;
    }

    .password-wrapper {
      position: relative;
    }
    .password-input {
      padding-right: 2.8rem;
    }
    .eye-btn {
      position: absolute;
      right: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      padding: 0.2rem;
      display: flex;
      align-items: center;
      transition: color 0.15s;
    }
    .eye-btn:hover { color: var(--text-secondary); }

    .otp-input {
      font-size: 1.25rem;
      letter-spacing: 0.35em;
      text-align: center;
      font-weight: 600;
    }

    .strength-bar-container {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-top: 0.5rem;
    }
    .strength-bar {
      flex: 1;
      height: 4px;
      background: var(--border-color);
      border-radius: 2px;
      overflow: hidden;
    }
    .strength-fill {
      height: 100%;
      border-radius: 2px;
      transition: width 0.3s ease, background-color 0.3s ease;
    }
    .strength-fill.weak   { background-color: var(--error); }
    .strength-fill.fair   { background-color: var(--warning); }
    .strength-fill.good   { background-color: var(--info); }
    .strength-fill.strong { background-color: var(--success); }
    .strength-label {
      font-size: 0.75rem;
      font-weight: 600;
      white-space: nowrap;
    }
    .strength-label.weak   { color: var(--error); }
    .strength-label.fair   { color: var(--warning); }
    .strength-label.good   { color: var(--info); }
    .strength-label.strong { color: var(--success); }

    .forgot-row {
      text-align: right;
      margin-top: -0.5rem;
      margin-bottom: 1.25rem;
    }
    .forgot-row a {
      font-size: 0.8125rem;
      color: var(--text-muted);
    }
    .forgot-row a:hover { color: var(--primary); }

    .submit-btn {
      width: 100%;
      padding: 0.75rem;
      font-size: 0.9375rem;
      font-weight: 600;
      font-family: var(--font-sans);
      color: #fff;
      background: linear-gradient(135deg, var(--primary), var(--primary-hover));
      border: none;
      border-radius: var(--border-radius-sm);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      transition: filter 0.2s, box-shadow 0.2s, transform 0.1s;
      margin-top: 0.25rem;
    }
    .submit-btn:hover:not(:disabled) {
      filter: brightness(1.07);
      box-shadow: var(--shadow-md), var(--shadow-glow);
    }
    .submit-btn:active:not(:disabled) { transform: scale(0.985); }
    .submit-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .btn-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.35);
      border-radius: 50%;
      border-top-color: #fff;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .auth-footer {
      margin-top: 1.5rem;
      text-align: center;
      font-size: 0.875rem;
      color: var(--text-muted);
    }
    .auth-footer a {
      color: var(--primary);
      font-weight: 500;
    }
    .auth-footer a:hover { color: var(--primary-hover); }
  `]
})
export class AuthComponent {
  step = signal<AuthStep>('SIGN_IN');
  loading = signal<boolean>(false);
  errorMessage = signal<string>('');
  successMessage = signal<string>('');

  showPassword = signal<boolean>(false);
  showConfirmPassword = signal<boolean>(false);

  email = '';
  password = '';
  confirmPassword = '';
  code = '';

  constructor(private router: Router) {}

  togglePassword() { this.showPassword.update(v => !v); }
  toggleConfirmPassword() { this.showConfirmPassword.update(v => !v); }

  setStep(newStep: AuthStep) {
    this.step.set(newStep);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.showPassword.set(false);
    this.showConfirmPassword.set(false);
  }

  getTitle(): string {
    switch (this.step()) {
      case 'SIGN_IN': return 'Đăng nhập';
      case 'SIGN_UP': return 'Tạo tài khoản';
      case 'CONFIRM_SIGN_UP': return 'Xác thực email';
      case 'RESET_PASSWORD': return 'Quên mật khẩu';
      case 'CONFIRM_RESET_PASSWORD': return 'Đặt mật khẩu mới';
    }
  }

  getSubtitle(): string {
    switch (this.step()) {
      case 'SIGN_IN': return 'Chào mừng quay trở lại';
      case 'SIGN_UP': return 'Điền thông tin để bắt đầu';
      case 'CONFIRM_SIGN_UP': return 'Nhập mã OTP được gửi tới email của bạn';
      case 'RESET_PASSWORD': return 'Nhập email để nhận mã đặt lại mật khẩu';
      case 'CONFIRM_RESET_PASSWORD': return 'Nhập mã OTP và mật khẩu mới';
    }
  }

  getSubmitBtnText(): string {
    if (this.loading()) return 'Đang xử lý...';
    switch (this.step()) {
      case 'SIGN_IN': return 'Đăng nhập';
      case 'SIGN_UP': return 'Tạo tài khoản';
      case 'CONFIRM_SIGN_UP': return 'Xác nhận';
      case 'RESET_PASSWORD': return 'Gửi mã xác thực';
      case 'CONFIRM_RESET_PASSWORD': return 'Đặt lại mật khẩu';
    }
  }

  getPasswordStrengthScore(): number {
    const p = this.password;
    if (p.length === 0) return 0;
    let score = 0;
    if (p.length >= 8) score++;
    if (p.length >= 12) score++;
    if (/[A-Z]/.test(p)) score++;
    if (/[0-9]/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    return score;
  }

  getPasswordStrengthClass(): string {
    const score = this.getPasswordStrengthScore();
    if (score <= 1) return 'weak';
    if (score === 2) return 'fair';
    if (score === 3) return 'good';
    return 'strong';
  }

  getPasswordStrengthWidth(): string {
    const score = this.getPasswordStrengthScore();
    return `${Math.min(score * 20, 100)}%`;
  }

  getPasswordStrengthLabel(): string {
    switch (this.getPasswordStrengthClass()) {
      case 'weak': return 'Yếu';
      case 'fair': return 'Trung bình';
      case 'good': return 'Khá';
      case 'strong': return 'Mạnh';
      default: return '';
    }
  }

  async onSubmit() {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.loading.set(true);

    try {
      if (this.step() === 'SIGN_IN') {
        const result = await signIn({ username: this.email, password: this.password });
        if (result.nextStep.signInStep === 'CONFIRM_SIGN_UP') {
          this.setStep('CONFIRM_SIGN_UP');
        } else {
          this.router.navigate(['/']);
        }
      }
      else if (this.step() === 'SIGN_UP') {
        if (this.password !== this.confirmPassword) {
          this.errorMessage.set('Mật khẩu xác nhận không khớp.');
          return;
        }
        await signUp({
          username: this.email,
          password: this.password,
          options: {
            userAttributes: {
              email: this.email,
            }
          }
        });
        this.successMessage.set('Đăng ký thành công! Kiểm tra email để nhận mã OTP.');
        this.setStep('CONFIRM_SIGN_UP');
      }
      else if (this.step() === 'CONFIRM_SIGN_UP') {
        await confirmSignUp({ username: this.email, confirmationCode: this.code });
        this.successMessage.set('Xác thực thành công! Bạn có thể đăng nhập.');
        this.setStep('SIGN_IN');
      }
      else if (this.step() === 'RESET_PASSWORD') {
        await resetPassword({ username: this.email });
        this.successMessage.set('Mã xác thực đã được gửi tới email của bạn.');
        this.setStep('CONFIRM_RESET_PASSWORD');
      }
      else if (this.step() === 'CONFIRM_RESET_PASSWORD') {
        await confirmResetPassword({ username: this.email, confirmationCode: this.code, newPassword: this.password });
        this.successMessage.set('Đặt lại mật khẩu thành công! Hãy đăng nhập.');
        this.setStep('SIGN_IN');
      }
    } catch (err: any) {
      console.error('Auth error:', err);
      this.errorMessage.set(err.message || 'Có lỗi xảy ra, vui lòng thử lại.');
    } finally {
      this.loading.set(false);
    }
  }
}

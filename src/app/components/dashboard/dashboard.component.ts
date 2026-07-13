import { Component, OnInit, OnDestroy, signal, computed, NgZone, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { signOut, getCurrentUser, fetchUserAttributes, updateUserAttributes } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/data';
import { uploadData, getUrl, remove, downloadData } from 'aws-amplify/storage';

const client: any = generateClient();

interface Quota {
  owner: string;
  uploadedCount: number;
  maxUploads: number;
}

interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface ConfirmState {
  title: string;
  message: string;
  type: 'warn' | 'delete';
  okText?: string;
  cancelText?: string;
  resolve: (result: boolean) => void;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="db-root">

  <!-- TOP BAR -->
  <header class="topbar">
    <div class="topbar-left">
      <div class="topbar-logo">
        <div class="logo-mark">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        </div>
        <span class="logo-text">DocAssistant</span>
      </div>
    </div>
    <div class="topbar-right">
      <button (click)="toggleTheme()" class="icon-btn" [title]="isDarkTheme() ? 'Chuyển sang sáng' : 'Chuyển sang tối'" aria-label="Toggle theme">
        <svg *ngIf="!isDarkTheme()" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        <svg *ngIf="isDarkTheme()" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
      </button>
      <div class="user-chip">
        <!-- Normal display -->
        <ng-container *ngIf="!editingName()">
          <span class="user-email">{{ userName() || userEmail() }}</span>
          <button class="edit-name-btn" (click)="startEditName()" title="Chỉnh sửa tên" aria-label="Chỉnh sửa tên hiển thị">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </ng-container>
        <!-- Inline edit -->
        <ng-container *ngIf="editingName()">
          <input
            class="edit-name-input"
            type="text"
            [(ngModel)]="nameInput"
            (keydown.enter)="confirmEditName()"
            (keydown.escape)="cancelEditName()"
            maxlength="50"
            placeholder="Nhập tên..."
            #nameEditInput
          />
          <button class="edit-name-confirm" (click)="confirmEditName()" [disabled]="savingName()" title="Lưu">
            <svg *ngIf="!savingName()" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            <span *ngIf="savingName()" class="row-spinner" style="width:11px;height:11px"></span>
          </button>
          <button class="edit-name-cancel" (click)="cancelEditName()" title="Hủy">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </ng-container>
        <button (click)="onLogout()" class="logout-btn">Đăng xuất</button>
      </div>
    </div>
  </header>

  <div class="db-body">

    <!-- SIDEBAR -->
    <aside class="sidebar">

      <!-- Quota -->
      <div class="card">
        <div class="card-label">Hạn mức</div>
        <div class="quota-numbers">
          <span class="quota-used">{{ quota()?.uploadedCount ?? 0 }}</span>
          <span class="quota-sep">/</span>
          <span class="quota-max">{{ quota()?.maxUploads ?? 50 }}</span>
          <span class="quota-unit">tài liệu</span>
        </div>
        <div class="quota-bar">
          <div class="quota-fill"
            [style.width.%]="getQuotaPercent()"
            [class.warn]="getQuotaPercent() >= 80"
            [class.danger]="getQuotaPercent() >= 95">
          </div>
        </div>
        <div *ngIf="isQuotaFull()" class="quota-full-msg">
          Đã đầy — xóa tài liệu cũ để tải thêm.
        </div>
      </div>

      <!-- Upload -->
      <div class="card">
        <div class="card-label">Tải lên</div>
        <div class="drop-zone"
          [class.over]="isDragOver()"
          [class.disabled]="isQuotaFull() || uploading()"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave($event)"
          (drop)="onDrop($event)"
          (click)="fileInput.click()"
          role="button"
          tabindex="0"
          aria-label="Kéo thả hoặc click để chọn file"
          (keydown.enter)="fileInput.click()">
          <input type="file" #fileInput style="display:none"
            (change)="onFileSelected($event)"
            accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png"
            [disabled]="isQuotaFull() || uploading()" />
          <svg class="drop-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
            <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
          </svg>
          <p class="drop-text">Kéo thả hoặc <span class="drop-link">chọn file</span></p>
          <p class="drop-formats">PDF · Word · PowerPoint · Ảnh &nbsp;·&nbsp; Tối đa 10MB</p>
        </div>

        <!-- Upload progress -->
        <div *ngIf="uploading()" class="upload-progress">
          <div class="upload-progress-meta">
            <span class="upload-filename">{{ uploadingFileName() }}</span>
            <span>{{ uploadProgress() }}%</span>
          </div>
          <div class="quota-bar">
            <div class="quota-fill" [style.width.%]="uploadProgress()"></div>
          </div>
        </div>

        <!-- Upload error -->
        <div *ngIf="uploadError()" class="upload-error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {{ uploadError() }}
        </div>
      </div>

    </aside>

    <!-- MAIN -->
    <main class="main">
      <div class="card doc-card">
        <div class="doc-header">
          <h2>Tài liệu</h2>
          <button (click)="loadDocuments(true)" class="icon-btn-text" [disabled]="loadingList()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Làm mới
          </button>
        </div>

        <!-- Search + Filter bar -->
        <div class="search-filter-bar">
          <div class="search-wrap">
            <svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              type="text"
              class="search-input"
              placeholder="Tìm theo tên file..."
              [(ngModel)]="searchQuery"
              (ngModelChange)="onSearchChange()"
              autocomplete="off"
            />
            <button *ngIf="searchQuery" class="search-clear" (click)="clearSearch()" aria-label="Xóa tìm kiếm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="filter-chips">
            <button *ngFor="let f of filterOptions" class="chip" [class.chip-active]="activeFilter() === f.value" (click)="setFilter(f.value)">
              {{ f.label }}
            </button>
          </div>
        </div>

        <!-- Skeleton -->
        <div *ngIf="loadingList() && documents().length === 0" class="skeleton-rows">
          <div *ngFor="let i of [1,2,3]" class="skeleton-row skeleton"></div>
        </div>

        <!-- Empty — chưa có document nào -->
        <div *ngIf="!loadingList() && documents().length === 0" class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" class="empty-icon"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <p class="empty-title">Chưa có tài liệu nào</p>
          <p class="empty-sub">Tải lên tài liệu đầu tiên để AI bắt đầu phân tích.</p>
        </div>

        <!-- Empty — có document nhưng filter/search không khớp -->
        <div *ngIf="!loadingList() && documents().length > 0 && filteredDocuments().length === 0" class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" class="empty-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <p class="empty-title">Không tìm thấy kết quả</p>
          <p class="empty-sub">Thử thay đổi từ khóa hoặc bộ lọc.</p>
          <button class="icon-btn-text" style="margin-top:0.5rem" (click)="clearSearch(); setFilter('all')">Xóa bộ lọc</button>
        </div>

        <!-- Table -->
        <div *ngIf="filteredDocuments().length > 0" class="table-wrap">
          <table class="doc-table">
            <thead>
              <tr>
                <th>Tên tệp</th>
                <th>Loại</th>
                <th>Kích thước</th>
                <th>Trạng thái</th>
                <th>Phân loại</th>
                <th>Ngày tạo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let doc of filteredDocuments()" class="doc-row" (click)="openPreview(doc)">
                <td class="td-name">{{ doc.fileName }}</td>
                <td><span class="type-badge">{{ doc.fileType | uppercase }}</span></td>
                <td class="td-dim">{{ formatFileSize(doc.fileSize) }}</td>
                <td>
                  <span class="status-dot" [class]="'status-' + doc.status"></span>
                  <span class="status-label">{{ getStatusLabel(doc.status) }}</span>
                </td>
                <td>
                  <span *ngIf="doc.category" class="cat-badge">{{ doc.category }}</span>
                  <span *ngIf="!doc.category" class="td-dim">—</span>
                </td>
                <td class="td-dim">{{ doc.createdAt | date:'dd/MM/yy HH:mm' }}</td>
                <td class="td-actions" (click)="$event.stopPropagation()">
                  <!-- Nút phân tích: hiện khi text đã extracted, chưa chọn mode -->
                  <button *ngIf="doc.status === 'text_extracted' && !doc.analysisMode"
                    (click)="showAnalysisPrompt(doc)"
                    class="row-btn row-btn-analyze"
                    title="Chọn chế độ phân tích" aria-label="Phân tích">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                  </button>
                  <!-- Nút retry: hiện khi error -->
                  <button *ngIf="doc.status === 'error'"
                    (click)="onRetry(doc)"
                    class="row-btn row-btn-retry"
                    [class.retrying]="retryingId() === doc.id"
                    [disabled]="retryingId() === doc.id"
                    title="Thử lại" aria-label="Thử lại xử lý">
                    <svg *ngIf="retryingId() !== doc.id" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4"/></svg>
                    <span *ngIf="retryingId() === doc.id" class="row-spinner"></span>
                  </button>
                  <button (click)="onDownload(doc)" class="row-btn" title="Tải xuống" aria-label="Tải xuống">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  </button>
                  <button (click)="onDelete(doc)" class="row-btn row-btn-del" title="Xóa" aria-label="Xóa">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Load more -->
        <div *ngIf="hasMore()" class="load-more">
          <button (click)="loadDocuments()" class="icon-btn-text" [disabled]="loadingList()">
            {{ loadingList() ? 'Đang tải...' : 'Tải thêm' }}
          </button>
        </div>
      </div>
    </main>
  </div>

  <!-- PREVIEW MODAL -->
  <div class="modal-bg" *ngIf="previewDoc()" (click)="closePreview()" role="dialog" aria-modal="true">
    <div class="modal" (click)="$event.stopPropagation()">

      <div class="modal-header">
        <span class="modal-title">{{ previewDoc()?.fileName }}</span>
        <button class="modal-close" (click)="closePreview()" aria-label="Đóng">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="modal-body">
        <!-- Viewer -->
        <div class="modal-viewer">
          <div *ngIf="isImageFile(previewDoc()?.fileType)" class="viewer-img">
            <img [src]="previewFileUrl()" alt="Xem trước" loading="lazy" />
          </div>
          <div *ngIf="previewDoc()?.fileType === 'pdf'" class="viewer-pdf">
            <iframe [src]="previewFileSafeUrl()" title="PDF preview"></iframe>
          </div>
          <div *ngIf="!isImageFile(previewDoc()?.fileType) && previewDoc()?.fileType !== 'pdf'" class="viewer-fallback">
            <!-- Nếu có extractedText thì render luôn trong viewer -->
            <ng-container *ngIf="previewDoc()?.extractedText; else noPreview">
              <div class="viewer-text-doc">
                <div class="viewer-text-header">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  <span>{{ previewDoc()?.fileType | uppercase }} · {{ formatFileSize(previewDoc()?.fileSize) }}</span>
                </div>
                <pre class="viewer-text-body">{{ previewDoc()?.extractedText }}</pre>
              </div>
            </ng-container>
            <ng-template #noPreview>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <p>Xem trước không khả dụng cho định dạng <strong>{{ previewDoc()?.fileType | uppercase }}</strong></p>
              <button (click)="onDownload(previewDoc()!)" class="btn-dl">Tải về để xem</button>
            </ng-template>
          </div>
        </div>

        <!-- Sidebar -->
        <div class="modal-sidebar">
          <div class="msec">
            <div class="msec-label">Tóm tắt (AI)</div>
            <div *ngIf="previewDoc()?.status === 'processing'" class="skeleton skeleton-text-sm"></div>
            <p *ngIf="previewDoc()?.status === 'uploaded'" class="msec-pending">Đang chuẩn bị xử lý...</p>
            <div *ngIf="previewDoc()?.status === 'text_extracted'" class="text-extracted-prompt">
              <p class="msec-pending">Văn bản đã được trích xuất. Chọn chế độ phân tích để tiếp tục.</p>
              <button class="retry-btn" style="margin-top:0.5rem" (click)="showAnalysisPrompt(previewDoc()!); closePreview()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                Phân tích ngay
              </button>
            </div>
            <div *ngIf="previewDoc()?.status === 'error'" class="error-block">
              <div class="error-block-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </div>
              <p class="error-block-msg">Xử lý thất bại — AI không thể phân tích tài liệu này.</p>
              <button class="retry-btn"
                (click)="onRetry(previewDoc()!); closePreview()"
                [disabled]="retryingId() === previewDoc()?.id">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4"/></svg>
                Thử lại
              </button>
            </div>
            <p *ngIf="previewDoc()?.status === 'done'" class="msec-body">{{ previewDoc()?.summary }}</p>
          </div>

          <div class="msec">
            <div class="msec-label">Phân loại</div>
            <div *ngIf="previewDoc()?.status === 'processing'" class="skeleton skeleton-badge"></div>
            <span *ngIf="previewDoc()?.status === 'done' && previewDoc()?.category" class="cat-badge cat-badge-lg">{{ previewDoc()?.category }}</span>
            <span *ngIf="previewDoc()?.status === 'done' && !previewDoc()?.category" class="td-dim">Chưa xác định</span>
          </div>

          <div class="msec msec-scroll">
            <div class="msec-label">Văn bản trích xuất</div>
            <div *ngIf="previewDoc()?.status === 'processing'" class="skeleton skeleton-block"></div>
            <pre *ngIf="previewDoc()?.status === 'done' && previewDoc()?.extractedText" class="extracted-text">{{ previewDoc()?.extractedText }}</pre>
            <p *ngIf="previewDoc()?.status === 'done' && previewDoc()?.processedS3Key && !previewDoc()?.extractedText" class="msec-muted">Văn bản quá dài, đã lưu trên S3. Tải về để xem đầy đủ.</p>
            <p *ngIf="previewDoc()?.status === 'done' && !previewDoc()?.extractedText && !previewDoc()?.processedS3Key" class="msec-muted">Không tìm thấy nội dung.</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- TOAST STACK -->
  <div class="toast-stack" aria-live="polite">
    <div *ngFor="let t of toasts()" class="toast" [class]="'toast-' + t.type">
      <svg *ngIf="t.type==='success'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      <svg *ngIf="t.type==='error'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <svg *ngIf="t.type==='info'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      <span>{{ t.message }}</span>
      <button class="toast-close" (click)="dismissToast(t.id)" aria-label="Đóng">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  </div>

  <!-- CONFIRM DIALOG -->
  <div class="confirm-bg" *ngIf="confirmState()" role="alertdialog" aria-modal="true">
    <div class="confirm-card">
      <div class="confirm-icon" [class]="'confirm-icon-' + (confirmState()?.type || 'warn')">
        <svg *ngIf="confirmState()?.type !== 'delete'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <svg *ngIf="confirmState()?.type === 'delete'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </div>
      <h3 class="confirm-title">{{ confirmState()?.title }}</h3>
      <p class="confirm-msg">{{ confirmState()?.message }}</p>
      <div class="confirm-actions">
        <button class="confirm-cancel" (click)="resolveConfirm(false)">{{ confirmState()?.cancelText || 'Hủy' }}</button>
        <button class="confirm-ok" [class.confirm-ok-danger]="confirmState()?.type === 'delete'" (click)="resolveConfirm(true)">{{ confirmState()?.okText || 'Xác nhận' }}</button>
      </div>
    </div>
  </div>

  <!-- NAME PROMPT POPUP -->
  <div class="name-prompt-bg" *ngIf="showNamePrompt()" role="dialog" aria-modal="true" aria-labelledby="name-prompt-title">
    <div class="name-prompt-card">
      <div class="name-prompt-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      </div>
      <h2 id="name-prompt-title">Chúng tôi nên gọi bạn là gì?</h2>
      <p class="name-prompt-sub">Nhập tên hiển thị để chúng tôi cá nhân hóa trải nghiệm của bạn.</p>
      <div class="name-prompt-field">
        <input
          type="text"
          class="name-prompt-input"
          placeholder="Nhập tên của bạn..."
          [(ngModel)]="nameInput"
          (keydown.enter)="saveDisplayName()"
          maxlength="50"
          autofocus
        />
      </div>
      <div class="name-prompt-actions">
        <button class="name-prompt-skip" (click)="skipNamePrompt()">Bỏ qua</button>
        <button class="name-prompt-save" (click)="saveDisplayName()" [disabled]="!nameInput.trim() || savingName()">
          <span *ngIf="savingName()" class="row-spinner" style="border-top-color:#fff;border-color:rgba(255,255,255,0.3);"></span>
          <span>{{ savingName() ? 'Đang lưu...' : 'Xác nhận' }}</span>
        </button>
      </div>
    </div>
  </div>

</div>
  `,
  styles: [`
    .db-root { display: flex; flex-direction: column; min-height: 100vh; }

    /* TOPBAR */
    .topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 1.5rem; height: 56px;
      border-bottom: 1px solid var(--border-color);
      background: var(--surface-color);
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      position: sticky; top: 0; z-index: 100;
    }
    .topbar-left, .topbar-right { display: flex; align-items: center; gap: 0.75rem; }
    .topbar-logo { display: flex; align-items: center; gap: 0.5rem; }
    .logo-mark {
      width: 30px; height: 30px;
      background: linear-gradient(135deg, var(--primary), var(--primary-hover));
      border-radius: 8px; display: flex; align-items: center; justify-content: center;
      color: #fff; flex-shrink: 0;
    }
    .logo-text { font-size: 0.9375rem; font-weight: 700; letter-spacing: -0.02em; }
    .icon-btn {
      background: none; border: 1px solid var(--border-color);
      border-radius: var(--border-radius-sm); padding: 0.4rem;
      cursor: pointer; color: var(--text-muted); display: flex; align-items: center;
      transition: color 0.15s, border-color 0.15s;
    }
    .icon-btn:hover { color: var(--text-primary); border-color: var(--border-hover); }
    .user-chip {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.3rem 0.75rem; border: 1px solid var(--border-color);
      border-radius: 50px; font-size: 0.8125rem;
    }
    .user-email { color: var(--text-secondary); max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .edit-name-btn {
      background: none; border: none; cursor: pointer; color: var(--text-muted);
      padding: 0.15rem; display: flex; align-items: center; border-radius: 4px;
      transition: color 0.15s;
    }
    .edit-name-btn:hover { color: var(--primary); }
    .edit-name-input {
      width: 120px; padding: 0.2rem 0.5rem;
      font-size: 0.8125rem; font-family: var(--font-sans);
      color: var(--text-primary); background: var(--input-bg);
      border: 1px solid var(--primary); border-radius: 6px; outline: none;
      box-shadow: 0 0 0 2px var(--primary-glow);
    }
    .edit-name-confirm, .edit-name-cancel {
      background: none; border: none; cursor: pointer; padding: 0.15rem;
      display: flex; align-items: center; border-radius: 4px; transition: color 0.15s;
    }
    .edit-name-confirm { color: var(--success); }
    .edit-name-confirm:hover:not(:disabled) { color: hsl(142,72%,22%); }
    .edit-name-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
    .edit-name-cancel { color: var(--text-muted); }
    .edit-name-cancel:hover { color: var(--error); }
    .logout-btn {
      background: none; border: none; color: var(--text-muted);
      font-size: 0.8125rem; font-family: var(--font-sans); cursor: pointer; padding: 0;
      transition: color 0.15s;
    }
    .logout-btn:hover { color: var(--error); }

    /* BODY */
    .db-body {
      display: flex; flex: 1; gap: 1.25rem;
      padding: 1.25rem 1.5rem; max-width: 1400px; width: 100%;
      margin: 0 auto; align-items: flex-start;
    }

    /* SIDEBAR */
    .sidebar {
      width: 280px; flex-shrink: 0; display: flex; flex-direction: column;
      gap: 1rem; position: sticky; top: 70px;
    }

    /* CARD */
    .card {
      background: var(--surface-color);
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--border-color);
      border-radius: var(--border-radius-md); padding: 1.25rem;
    }
    .card-label {
      font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.07em; color: var(--text-muted); margin-bottom: 0.875rem;
    }

    /* QUOTA */
    .quota-numbers { display: flex; align-items: baseline; gap: 0.2rem; margin-bottom: 0.75rem; }
    .quota-used { font-size: 1.75rem; font-weight: 700; letter-spacing: -0.03em; color: var(--text-primary); }
    .quota-sep { color: var(--text-muted); font-size: 1.1rem; margin: 0 0.1rem; }
    .quota-max { font-size: 1rem; color: var(--text-secondary); }
    .quota-unit { font-size: 0.8125rem; color: var(--text-muted); margin-left: 0.3rem; }
    .quota-bar { height: 4px; background: var(--border-color); border-radius: 2px; overflow: hidden; }
    .quota-fill { height: 100%; background: var(--primary); border-radius: 2px; transition: width 0.35s ease; }
    .quota-fill.warn { background: var(--warning); }
    .quota-fill.danger { background: var(--error); }
    .quota-full-msg { margin-top: 0.6rem; font-size: 0.78rem; color: var(--error); }

    /* DROP ZONE */
    .drop-zone {
      border: 1.5px dashed var(--border-color); border-radius: var(--border-radius-sm);
      padding: 1.75rem 1rem; text-align: center; cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
    }
    .drop-zone:hover:not(.disabled), .drop-zone.over { border-color: var(--primary); background: var(--primary-glow); }
    .drop-zone.disabled { cursor: not-allowed; opacity: 0.55; }
    .drop-icon { color: var(--text-muted); margin-bottom: 0.6rem; display: block; margin-left: auto; margin-right: auto; }
    .drop-text { font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 0.3rem; }
    .drop-link { color: var(--primary); font-weight: 500; }
    .drop-formats { font-size: 0.75rem; color: var(--text-muted); }
    .upload-progress { margin-top: 1rem; }
    .upload-progress-meta {
      display: flex; justify-content: space-between;
      font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.4rem;
    }
    .upload-filename { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px; }
    .upload-error {
      display: flex; align-items: flex-start; gap: 0.4rem;
      margin-top: 0.75rem; font-size: 0.8rem; color: var(--error); line-height: 1.4;
    }
    .upload-error svg { flex-shrink: 0; margin-top: 1px; }

    /* MAIN */
    .main { flex: 1; min-width: 0; }
    .doc-card { display: flex; flex-direction: column; min-height: 400px; }
    .doc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; }
    .doc-header h2 { font-size: 1rem; font-weight: 600; margin-bottom: 0; }
    .icon-btn-text {
      display: inline-flex; align-items: center; gap: 0.35rem;
      background: none; border: 1px solid var(--border-color);
      border-radius: var(--border-radius-sm); padding: 0.35rem 0.75rem;
      font-size: 0.8125rem; font-family: var(--font-sans); color: var(--text-secondary);
      cursor: pointer; transition: border-color 0.15s, color 0.15s;
    }
    .icon-btn-text:hover:not(:disabled) { color: var(--text-primary); border-color: var(--border-hover); }
    .icon-btn-text:disabled { opacity: 0.5; cursor: not-allowed; }

    /* TABLE */
    .table-wrap { overflow-x: auto; }
    .doc-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    .doc-table th {
      text-align: left; padding: 0.5rem 0.875rem;
      font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--text-muted);
      border-bottom: 1px solid var(--border-color);
    }
    .doc-table td {
      padding: 0.875rem 0.875rem; border-bottom: 1px solid var(--border-color);
      color: var(--text-secondary); vertical-align: middle;
    }
    .doc-row { cursor: pointer; transition: background 0.15s; }
    .doc-row:hover { background: var(--primary-glow); }
    .doc-row:last-child td { border-bottom: none; }

    /* SEARCH + FILTER */
    .search-filter-bar {
      display: flex; align-items: center; gap: 0.75rem;
      margin-bottom: 1rem; flex-wrap: wrap;
    }
    .search-wrap {
      position: relative; flex: 1; min-width: 180px;
    }
    .search-icon {
      position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%);
      color: var(--text-muted); pointer-events: none;
    }
    .search-input {
      width: 100%; padding: 0.55rem 2.25rem 0.55rem 2.25rem;
      font-size: 0.875rem; font-family: var(--font-sans);
      color: var(--text-primary); background: var(--input-bg);
      border: 1px solid var(--border-color); border-radius: var(--border-radius-sm);
      outline: none; transition: border-color 0.2s, box-shadow 0.2s;
    }
    .search-input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--primary-glow);
    }
    .search-input::placeholder { color: var(--text-muted); }
    .search-clear {
      position: absolute; right: 0.6rem; top: 50%; transform: translateY(-50%);
      background: none; border: none; cursor: pointer; color: var(--text-muted);
      padding: 0.15rem; display: flex; align-items: center;
      border-radius: 4px; transition: color 0.15s;
    }
    .search-clear:hover { color: var(--text-primary); }
    .filter-chips {
      display: flex; gap: 0.4rem; flex-wrap: wrap;
    }
    .chip {
      padding: 0.35rem 0.8rem; font-size: 0.78rem; font-weight: 500;
      font-family: var(--font-sans); color: var(--text-muted);
      background: none; border: 1px solid var(--border-color);
      border-radius: 50px; cursor: pointer; white-space: nowrap;
      transition: color 0.15s, border-color 0.15s, background 0.15s;
    }
    .chip:hover { color: var(--text-secondary); border-color: var(--border-hover); }
    .chip-active {
      color: var(--primary); border-color: var(--primary);
      background: var(--primary-glow); font-weight: 600;
    }
    .td-name { color: var(--text-primary); font-weight: 500; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .td-dim { color: var(--text-muted); font-size: 0.8125rem; }
    .type-badge {
      background: var(--border-color); color: var(--text-muted);
      font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em;
      padding: 0.2rem 0.5rem; border-radius: 4px;
    }
    .status-dot {
      display: inline-block; width: 6px; height: 6px; border-radius: 50%;
      margin-right: 0.45rem; vertical-align: middle; position: relative; top: -1px;
    }
    .status-dot.status-uploaded  { background: var(--info); }
    .status-dot.status-processing { background: var(--warning); animation: pulse 1.4s infinite; }
    .status-dot.status-text_extracted { background: var(--primary); animation: pulse 1.4s infinite; }
    .status-dot.status-done  { background: var(--success); }
    .status-dot.status-error { background: var(--error); }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 2px rgba(245,158,11,0.25); }
      50%       { box-shadow: 0 0 0 4px rgba(245,158,11,0.1); }
    }
    .status-label { font-size: 0.8125rem; color: var(--text-secondary); }
    .cat-badge {
      display: inline-block; padding: 0.2rem 0.6rem;
      background: rgba(16,185,129,0.12); color: var(--success);
      font-size: 0.75rem; font-weight: 600; border-radius: 4px;
    }
    .td-actions { display: flex; gap: 0.35rem; justify-content: flex-end; }
    .row-btn {
      background: none; border: 1px solid var(--border-color); border-radius: 6px;
      padding: 0.35rem; cursor: pointer; color: var(--text-muted);
      display: flex; align-items: center; transition: color 0.15s, border-color 0.15s, background 0.15s;
    }
    .row-btn:hover { color: var(--text-primary); border-color: var(--border-hover); }
    .row-btn-del:hover { color: var(--error); border-color: var(--error); background: var(--error-bg); }
    .row-btn-retry { color: var(--warning); border-color: rgba(245,158,11,0.4); }
    .row-btn-retry:hover:not(:disabled) { color: var(--warning); border-color: var(--warning); background: var(--warning-bg); }
    .row-btn-retry:disabled { opacity: 0.7; cursor: not-allowed; }
    .row-btn-analyze { color: var(--primary); border-color: rgba(99,102,241,0.4); }
    .row-btn-analyze:hover { color: var(--primary); border-color: var(--primary); background: var(--primary-glow); }
    .row-spinner {
      display: inline-block; width: 13px; height: 13px;
      border: 2px solid rgba(245,158,11,0.3); border-radius: 50%;
      border-top-color: var(--warning); animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* EMPTY / SKELETON */
    .skeleton-rows { display: flex; flex-direction: column; gap: 0.75rem; }
    .skeleton-row { height: 44px; width: 100%; border-radius: var(--border-radius-sm); }
    .empty-state {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 4rem 2rem; gap: 0.5rem; flex: 1;
    }
    .empty-icon { color: var(--border-hover); margin-bottom: 0.5rem; }
    .empty-title { font-size: 0.9375rem; font-weight: 600; color: var(--text-secondary); }
    .empty-sub { font-size: 0.8125rem; color: var(--text-muted); }
    .load-more { display: flex; justify-content: center; padding-top: 1.25rem; }

    /* MODAL */
    .modal-bg {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      z-index: 200; padding: 1.5rem;
    }
    .modal {
      width: 100%; max-width: 1100px; height: 80vh;
      background: var(--surface-solid); border: 1px solid var(--border-color);
      border-radius: var(--border-radius-lg); display: flex; flex-direction: column;
      overflow: hidden; box-shadow: var(--shadow-lg);
      animation: fadeUp 0.25s cubic-bezier(0.16,1,0.3,1);
    }
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(12px) scale(0.98); }
      to   { opacity: 1; transform: none; }
    }
    .modal-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1rem 1.5rem; border-bottom: 1px solid var(--border-color); flex-shrink: 0;
    }
    .modal-title {
      font-size: 0.9375rem; font-weight: 600; color: var(--text-primary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      max-width: calc(100% - 3rem);
    }
    .modal-close {
      background: none; border: none; cursor: pointer; color: var(--text-muted);
      padding: 0.3rem; display: flex; align-items: center;
      border-radius: 6px; transition: color 0.15s, background 0.15s;
    }
    .modal-close:hover { color: var(--text-primary); background: var(--border-color); }
    .modal-body { display: flex; flex: 1; overflow: hidden; }
    .modal-viewer {
      flex: 3; background: #0d1117; display: flex; align-items: center;
      justify-content: center; overflow: hidden;
      border-right: 1px solid var(--border-color);
    }
    .viewer-img { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .viewer-img img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; }
    .viewer-pdf { width: 100%; height: 100%; }
    .viewer-pdf iframe { width: 100%; height: 100%; border: none; }
    .viewer-fallback {
      display: flex; flex-direction: column; align-items: center;
      gap: 0.75rem; color: #64748b; padding: 2rem; text-align: center; width: 100%; height: 100%;
    }
    /* Text document viewer (DOCX/PPTX) */
    .viewer-text-doc {
      width: 100%; height: 100%; display: flex; flex-direction: column;
      overflow: hidden;
    }
    .viewer-text-header {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.6rem 1rem; border-bottom: 1px solid rgba(255,255,255,0.07);
      font-size: 0.75rem; color: #64748b; font-weight: 500; flex-shrink: 0;
    }
    .viewer-text-body {
      flex: 1; overflow-y: auto; padding: 1.25rem 1.5rem;
      font-size: 0.8rem; line-height: 1.7; color: #cbd5e1;
      font-family: ui-monospace, 'Cascadia Code', monospace;
      white-space: pre-wrap; word-break: break-word; margin: 0;
    }
    .viewer-text-body::-webkit-scrollbar { width: 6px; }
    .viewer-text-body::-webkit-scrollbar-track { background: transparent; }
    .viewer-text-body::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
    .viewer-fallback p { font-size: 0.875rem; }
    .btn-dl {
      margin-top: 0.25rem; padding: 0.5rem 1.25rem;
      background: var(--primary); color: #fff; border: none;
      border-radius: var(--border-radius-sm); font-size: 0.875rem;
      font-family: var(--font-sans); cursor: pointer; transition: filter 0.15s;
    }
    .btn-dl:hover { filter: brightness(1.1); }
    .modal-sidebar {
      flex: 1.8; min-width: 0; overflow-y: auto; padding: 1.5rem;
      display: flex; flex-direction: column; gap: 1.5rem;
    }
    .msec-label {
      font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.07em; color: var(--text-muted); margin-bottom: 0.6rem;
    }
    .msec-body { font-size: 0.9rem; line-height: 1.65; color: var(--text-primary); }
    .msec-pending { font-size: 0.875rem; color: var(--info); }
    .msec-error { font-size: 0.875rem; color: var(--error); }
    .msec-muted { font-size: 0.8125rem; color: var(--text-muted); }

    /* Error block with retry */
    .error-block {
      display: flex; flex-direction: column; align-items: flex-start;
      gap: 0.6rem; padding: 0.875rem 1rem;
      background: var(--error-bg); border: 1px solid rgba(239,68,68,0.2);
      border-radius: var(--border-radius-sm);
    }
    .error-block-icon { color: var(--error); display: flex; }
    .error-block-msg { font-size: 0.875rem; color: var(--error); line-height: 1.4; }
    .retry-btn {
      display: inline-flex; align-items: center; gap: 0.4rem;
      padding: 0.4rem 0.875rem; font-size: 0.8125rem; font-weight: 600;
      font-family: var(--font-sans); color: var(--warning);
      background: var(--warning-bg); border: 1px solid rgba(245,158,11,0.35);
      border-radius: var(--border-radius-sm); cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }
    .retry-btn:hover:not(:disabled) { border-color: var(--warning); background: rgba(245,158,11,0.15); }
    .retry-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .cat-badge-lg { font-size: 0.8125rem; padding: 0.3rem 0.875rem; }
    .extracted-text {
      font-size: 0.8rem; line-height: 1.5; color: var(--text-secondary);
      background: var(--input-bg); border: 1px solid var(--border-color);
      border-radius: var(--border-radius-sm); padding: 0.875rem;
      white-space: pre-wrap; max-height: 280px; overflow-y: auto;
      font-family: ui-monospace, 'Cascadia Code', monospace;
    }
    .skeleton-text-sm { height: 60px; width: 100%; border-radius: var(--border-radius-sm); }
    .skeleton-badge { height: 26px; width: 80px; border-radius: 4px; }
    .skeleton-block { height: 140px; width: 100%; border-radius: var(--border-radius-sm); }

    /* RESPONSIVE */
    @media (max-width: 900px) {
      .db-body { flex-direction: column; padding: 1rem; }
      .sidebar { width: 100%; position: static; }
      .modal-body { flex-direction: column; }
      .modal-viewer { flex: none; height: 40vh; border-right: none; border-bottom: 1px solid var(--border-color); }
      .modal-sidebar { flex: none; }
    }
    @media (max-width: 600px) {
      .doc-table th:nth-child(3), .doc-table td:nth-child(3),
      .doc-table th:nth-child(6), .doc-table td:nth-child(6) { display: none; }
    }

    /* TOAST */
    .toast-stack {
      position: fixed; bottom: 1.5rem; right: 1.5rem;
      display: flex; flex-direction: column; gap: 0.6rem;
      z-index: 500; pointer-events: none;
    }
    .toast {
      display: flex; align-items: center; gap: 0.6rem;
      padding: 0.75rem 1rem; border-radius: var(--border-radius-sm);
      font-size: 0.875rem; font-weight: 500; min-width: 260px; max-width: 360px;
      box-shadow: var(--shadow-lg);
      border: 1px solid transparent;
      pointer-events: all;
      animation: toastIn 0.25s cubic-bezier(0.16,1,0.3,1);
    }
    @keyframes toastIn {
      from { opacity: 0; transform: translateY(10px) scale(0.97); }
      to   { opacity: 1; transform: none; }
    }
    .toast-success { background: var(--success-bg); color: var(--success); border-color: rgba(16,185,129,0.25); }
    .toast-error   { background: var(--error-bg);   color: var(--error);   border-color: rgba(239,68,68,0.25); }
    .toast-info    { background: var(--info-bg);    color: var(--info);    border-color: rgba(14,165,233,0.25); }
    .toast span { flex: 1; line-height: 1.4; }
    .toast-close {
      background: none; border: none; cursor: pointer; color: inherit;
      opacity: 0.6; padding: 0.1rem; display: flex; align-items: center;
      flex-shrink: 0; transition: opacity 0.15s;
    }
    .toast-close:hover { opacity: 1; }

    /* CONFIRM DIALOG */
    .confirm-bg {
      position: fixed; inset: 0; z-index: 400;
      background: rgba(0,0,0,0.5);
      backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      padding: 1.5rem;
    }
    .confirm-card {
      width: 100%; max-width: 380px;
      background: var(--surface-solid);
      border: 1px solid var(--border-color);
      border-radius: var(--border-radius-lg);
      padding: 2rem 1.75rem;
      box-shadow: var(--shadow-lg);
      text-align: center;
      animation: fadeUp 0.2s cubic-bezier(0.16,1,0.3,1);
    }
    .confirm-icon {
      width: 48px; height: 48px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 1.1rem;
    }
    .confirm-icon-warn   { background: var(--warning-bg);  color: var(--warning); border: 1px solid rgba(245,158,11,0.2); }
    .confirm-icon-delete { background: var(--error-bg);    color: var(--error);   border: 1px solid rgba(239,68,68,0.2); }
    .confirm-title {
      font-size: 1.05rem; font-weight: 700;
      letter-spacing: -0.02em; margin-bottom: 0.5rem;
    }
    .confirm-msg {
      font-size: 0.875rem; color: var(--text-muted);
      line-height: 1.5; margin-bottom: 1.5rem;
    }
    .confirm-actions {
      display: flex; gap: 0.75rem; justify-content: center;
    }
    .confirm-cancel {
      padding: 0.6rem 1.25rem; font-size: 0.875rem; font-weight: 500;
      font-family: var(--font-sans); color: var(--text-secondary);
      background: none; border: 1px solid var(--border-color);
      border-radius: var(--border-radius-sm); cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    }
    .confirm-cancel:hover { color: var(--text-primary); border-color: var(--border-hover); }
    .confirm-ok {
      padding: 0.6rem 1.5rem; font-size: 0.875rem; font-weight: 600;
      font-family: var(--font-sans); color: #fff;
      background: linear-gradient(135deg, var(--primary), var(--primary-hover));
      border: none; border-radius: var(--border-radius-sm); cursor: pointer;
      transition: filter 0.15s, box-shadow 0.15s;
    }
    .confirm-ok:hover { filter: brightness(1.08); box-shadow: var(--shadow-md), var(--shadow-glow); }
    .confirm-ok-danger {
      background: linear-gradient(135deg, var(--error), hsl(0,84%,38%));
    }
    .confirm-ok-danger:hover { box-shadow: var(--shadow-md), 0 0 15px rgba(239,68,68,0.25); }

    /* NAME PROMPT */
    .name-prompt-bg {
      position: fixed; inset: 0; z-index: 300;
      background: rgba(0,0,0,0.45);
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      display: flex; align-items: center; justify-content: center;
      padding: 1.5rem;
    }
    .name-prompt-card {
      width: 100%; max-width: 400px;
      background: var(--surface-solid);
      border: 1px solid var(--border-color);
      border-radius: var(--border-radius-lg);
      padding: 2.25rem 2rem;
      box-shadow: var(--shadow-lg);
      text-align: center;
      animation: fadeUp 0.3s cubic-bezier(0.16,1,0.3,1);
    }
    .name-prompt-icon {
      width: 56px; height: 56px; border-radius: 50%;
      background: var(--primary-glow);
      border: 1px solid rgba(99,102,241,0.2);
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 1.25rem;
      color: var(--primary);
    }
    .name-prompt-card h2 {
      font-size: 1.2rem; font-weight: 700;
      letter-spacing: -0.02em; margin-bottom: 0.5rem;
    }
    .name-prompt-sub {
      font-size: 0.875rem; color: var(--text-muted);
      line-height: 1.5; margin-bottom: 1.5rem;
    }
    .name-prompt-field { margin-bottom: 1.25rem; }
    .name-prompt-input {
      width: 100%; padding: 0.75rem 1rem;
      font-size: 0.9375rem; font-family: var(--font-sans);
      color: var(--text-primary); background: var(--input-bg);
      border: 1px solid var(--border-color);
      border-radius: var(--border-radius-sm);
      outline: none; text-align: center;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .name-prompt-input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--primary-glow);
    }
    .name-prompt-input::placeholder { color: var(--text-muted); }
    .name-prompt-actions {
      display: flex; gap: 0.75rem; justify-content: center;
    }
    .name-prompt-skip {
      padding: 0.65rem 1.25rem; font-size: 0.875rem; font-weight: 500;
      font-family: var(--font-sans); color: var(--text-muted);
      background: none; border: 1px solid var(--border-color);
      border-radius: var(--border-radius-sm); cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
    }
    .name-prompt-skip:hover { color: var(--text-primary); border-color: var(--border-hover); }
    .name-prompt-save {
      padding: 0.65rem 1.5rem; font-size: 0.875rem; font-weight: 600;
      font-family: var(--font-sans); color: #fff;
      background: linear-gradient(135deg, var(--primary), var(--primary-hover));
      border: none; border-radius: var(--border-radius-sm); cursor: pointer;
      display: inline-flex; align-items: center; gap: 0.4rem;
      transition: filter 0.15s, box-shadow 0.15s;
    }
    .name-prompt-save:hover:not(:disabled) {
      filter: brightness(1.08);
      box-shadow: var(--shadow-md), var(--shadow-glow);
    }
    .name-prompt-save:disabled { opacity: 0.55; cursor: not-allowed; }

    /* ANALYSIS MODE POPUP */
    .mode-bg {
      position: fixed; inset: 0; z-index: 310;
      background: rgba(0,0,0,0.5);
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      display: flex; align-items: center; justify-content: center;
      padding: 1.5rem;
    }
    .mode-card {
      width: 100%; max-width: 480px;
      background: var(--surface-solid);
      border: 1px solid var(--border-color);
      border-radius: var(--border-radius-lg);
      padding: 1.75rem 1.75rem 1.5rem;
      box-shadow: var(--shadow-lg);
      animation: fadeUp 0.28s cubic-bezier(0.16,1,0.3,1);
    }
    .mode-header {
      display: flex; align-items: center; gap: 0.75rem;
      padding-bottom: 1.25rem; border-bottom: 1px solid var(--border-color);
      margin-bottom: 1.25rem;
    }
    .mode-file-icon {
      width: 40px; height: 40px; border-radius: 8px;
      background: var(--primary-glow); border: 1px solid rgba(99,102,241,0.2);
      display: flex; align-items: center; justify-content: center;
      color: var(--primary); flex-shrink: 0;
    }
    .mode-file-info { display: flex; flex-direction: column; min-width: 0; }
    .mode-file-name {
      font-size: 0.9rem; font-weight: 600; color: var(--text-primary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .mode-file-meta { font-size: 0.78rem; color: var(--text-muted); margin-top: 0.1rem; }
    .mode-title {
      font-size: 1.1rem; font-weight: 700; letter-spacing: -0.02em;
      margin-bottom: 0.35rem;
    }
    .mode-sub { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.25rem; }
    .mode-options { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.5rem; }
    .mode-option {
      display: flex; align-items: center; gap: 0.875rem;
      padding: 0.875rem 1rem; border-radius: var(--border-radius-sm);
      border: 1.5px solid var(--border-color); background: none;
      cursor: pointer; text-align: left; width: 100%;
      transition: border-color 0.15s, background 0.15s;
      font-family: var(--font-sans);
    }
    .mode-option:hover { border-color: var(--primary); background: var(--primary-glow); }
    .mode-option-selected { border-color: var(--primary) !important; background: var(--primary-glow) !important; }
    .mode-option-icon { font-size: 1.35rem; flex-shrink: 0; width: 28px; text-align: center; }
    .mode-option-body { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .mode-option-label { font-size: 0.9rem; font-weight: 600; color: var(--text-primary); }
    .mode-option-desc { font-size: 0.78rem; color: var(--text-muted); margin-top: 0.1rem; }
    .mode-option-check { color: var(--primary); flex-shrink: 0; }
    .mode-actions {
      display: flex; gap: 0.75rem; justify-content: flex-end;
      padding-top: 1rem; border-top: 1px solid var(--border-color);
    }
    .mode-cancel {
      padding: 0.6rem 1.1rem; font-size: 0.875rem; font-weight: 500;
      font-family: var(--font-sans); color: var(--text-muted);
      background: none; border: 1px solid var(--border-color);
      border-radius: var(--border-radius-sm); cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
    }
    .mode-cancel:hover { color: var(--text-primary); border-color: var(--border-hover); }
    .mode-confirm {
      padding: 0.6rem 1.4rem; font-size: 0.875rem; font-weight: 600;
      font-family: var(--font-sans); color: #fff;
      background: linear-gradient(135deg, var(--primary), var(--primary-hover));
      border: none; border-radius: var(--border-radius-sm); cursor: pointer;
      display: inline-flex; align-items: center; gap: 0.4rem;
      transition: filter 0.15s, box-shadow 0.15s;
    }
    .mode-confirm:hover:not(:disabled) { filter: brightness(1.08); box-shadow: var(--shadow-md), var(--shadow-glow); }
    .mode-confirm:disabled { opacity: 0.55; cursor: not-allowed; }
  `]
})
export class DashboardComponent implements OnInit, OnDestroy {
  documents = signal<any[]>([]);
  quota = signal<Quota>({ owner: '', uploadedCount: 0, maxUploads: 50 });
  userEmail = signal<string>('');
  userId = signal<string>('');

  loadingList = signal<boolean>(false);
  hasMore = signal<boolean>(false);
  nextToken: string | null = null;

  isDragOver = signal<boolean>(false);
  uploading = signal<boolean>(false);
  uploadProgress = signal<number>(0);
  uploadingFileName = signal<string>('');
  uploadError = signal<string>('');

  previewDoc = signal<any | null>(null);
  previewFileUrl = signal<any>(null);
  previewFileSafeUrl = signal<SafeResourceUrl | null>(null);

  retryingId = signal<string | null>(null);

  // Analysis mode popup
  analysisDoc = signal<any | null>(null);
  selectedMode = signal<string>('');
  submittingMode = signal<boolean>(false);

  readonly analysisOptions = [
    { value: 'summary_detailed', icon: '📋', label: 'Tóm tắt chi tiết', desc: 'Tóm tắt đầy đủ 6–10 câu, bao gồm các ý chính và kết luận' },
    { value: 'summary_short',    icon: '⚡', label: 'Tóm tắt ngắn gọn', desc: 'Tóm tắt nhanh 2–3 câu, chỉ nêu điểm quan trọng nhất' },
    { value: 'key_points',       icon: '🔑', label: 'Trích xuất điểm chính', desc: 'Liệt kê 3–5 điểm chính dưới dạng danh sách gạch đầu dòng' },
    { value: 'classify_only',    icon: '🏷️', label: 'Chỉ phân loại', desc: 'Xác định loại tài liệu: Hợp đồng, Hóa đơn, Báo cáo hoặc Khác' },
  ];

  // Search + Filter
  searchQuery = '';
  activeFilter = signal<string>('all');

  readonly filterOptions = [
    { label: 'Tất cả', value: 'all' },
    { label: 'Hợp đồng', value: 'Hợp đồng' },
    { label: 'Hóa đơn', value: 'Hóa đơn' },
    { label: 'Báo cáo', value: 'Báo cáo' },
    { label: 'Khác', value: 'Khác' },
    { label: 'Chờ phân tích', value: '__text_extracted' },
    { label: 'Đang xử lý', value: '__processing' },
    { label: 'Lỗi', value: '__error' },
  ];

  filteredDocuments = computed(() => {
    const q = this.searchQuery.toLowerCase().trim();
    const f = this.activeFilter();
    return this.documents().filter(doc => {
      const matchSearch = !q || doc.fileName?.toLowerCase().includes(q);
      const matchFilter =
        f === 'all'              ? true :
        f === '__processing'     ? (doc.status === 'processing' || doc.status === 'uploaded') :
        f === '__error'          ? doc.status === 'error' :
        f === '__text_extracted' ? (doc.status === 'text_extracted' && !doc.analysisMode) :
        doc.category === f;
      return matchSearch && matchFilter;
    });
  });

  toasts = signal<Toast[]>([]);
  confirmState = signal<ConfirmState | null>(null);
  private toastCounter = 0;

  isDarkTheme = signal<boolean>(false);

  showNamePrompt = signal<boolean>(false);
  userName = signal<string>('');
  nameInput = '';
  savingName = signal<boolean>(false);
  editingName = signal<boolean>(false);

  private pollingHandle: any = null;
  private readonly POLLING_INTERVAL_MS = 4000;

  constructor(
    private router: Router,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer
  ) {}

  async ngOnInit() {
    this.checkTheme();
    await this.loadUser();
    await this.loadQuota();
    await this.loadDocuments(true);
    this.startPolling();
  }

  ngOnDestroy() { this.stopPolling(); }

  startPolling() {
    this.stopPolling();
    this.pollingHandle = setInterval(() => this.pollPendingDocuments(), this.POLLING_INTERVAL_MS);
  }

  stopPolling() {
    if (this.pollingHandle) { clearInterval(this.pollingHandle); this.pollingHandle = null; }
  }

  async pollPendingDocuments() {
    const current = this.documents();
    const hasPending = current.some(d =>
      d.status === 'uploaded' || d.status === 'processing'
    );
    if (!hasPending) {
      // Kiểm tra xem có document text_extracted chưa được hỏi mode chưa
      const needsMode = current.find(d =>
        d.status === 'text_extracted' && !d.analysisMode && !this.analysisDoc()
      );
      if (needsMode) {
        this.ngZone.run(() => this.showAnalysisPrompt(needsMode));
      }
      return;
    }
    try {
      const response = await (client.models.Document as any).list({ limit: 10 });
      const latest: any[] = response.data || [];
      const updated = current.map(doc => {
        const fresh = latest.find((d: any) => d.id === doc.id);
        return fresh ? fresh : doc;
      });
      this.ngZone.run(() => {
        const justFinished = updated.some((d, i) =>
          d.status !== current[i]?.status && (d.status === 'done' || d.status === 'error')
        );
        this.documents.set(updated);
        const previewing = this.previewDoc();
        if (previewing) {
          const fresh = updated.find(d => d.id === previewing.id);
          if (fresh) this.previewDoc.set(fresh);
        }
        if (justFinished) this.loadQuota();
        this.cdr.detectChanges();
      });
    } catch (error) {
      console.error('Polling refresh failed:', error);
    }
  }

  async loadUser() {
    try {
      const user = await getCurrentUser();
      this.userId.set(user.userId);
      const attrs = await fetchUserAttributes();
      this.userEmail.set(attrs.email || user.username);
      if (attrs.name) {
        this.userName.set(attrs.name);
      } else {
        // User chưa có tên — hiện popup hỏi
        this.showNamePrompt.set(true);
      }
    } catch (error) {
      console.error('Error loading user:', error);
      this.router.navigate(['/auth']);
    }
  }

  async loadQuota() {
    try {
      // AppSync owner-filter không match format "sub::username" mà Lambda ghi vào DynamoDB
      // → list() UserQuota qua AppSync luôn trả về rỗng dù record tồn tại trong DB.
      // Giải pháp thực tế: đếm Document records của user (AppSync tự filter đúng).
      const response = await (client.models.Document as any).list({ limit: 1000 });
      const count = (response.data || []).length;
      this.quota.set({ owner: this.userEmail(), uploadedCount: count, maxUploads: 50 });
    } catch (error) {
      console.error('Error loading user quota:', error);
      this.quota.set({ owner: '', uploadedCount: 0, maxUploads: 50 });
    }
  }

  async loadDocuments(reset: boolean = false) {
    if (reset) { this.nextToken = null; this.hasMore.set(false); }
    this.loadingList.set(true);
    try {
      const response = await (client.models.Document as any).list({ limit: 1000, nextToken: this.nextToken });
      const items: any[] = (response.data || []).sort((a: any, b: any) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      this.nextToken = response.nextToken || null;
      this.hasMore.set(this.nextToken !== null);
      if (reset) {
        this.documents.set(items);
      } else {
        const existing = this.documents();
        const existingIds = new Set(existing.map((d: any) => d.id));
        this.documents.set([...existing, ...items.filter((d: any) => !existingIds.has(d.id))]);
      }
      // Cập nhật quota từ số lượng document thực tế
      this.quota.set({ owner: this.userEmail(), uploadedCount: this.documents().length, maxUploads: 50 });
    } catch (error) {
      console.error('Error loading documents:', error);
    } finally {
      this.loadingList.set(false);
    }
  }

  getQuotaPercent(): number {
    const q = this.quota();
    if (!q || q.maxUploads === 0) return 0;
    return Math.min(Math.round((q.uploadedCount / q.maxUploads) * 100), 100);
  }

  isQuotaFull(): boolean {
    const q = this.quota();
    if (!q) return false;
    return q.uploadedCount >= q.maxUploads;
  }

  onDragOver(e: DragEvent) { e.preventDefault(); if (this.isQuotaFull()) return; this.isDragOver.set(true); }
  onDragLeave(e: DragEvent) { e.preventDefault(); this.isDragOver.set(false); }
  onDrop(e: DragEvent) {
    e.preventDefault(); this.isDragOver.set(false);
    if (this.isQuotaFull() || this.uploading()) return;
    if (e.dataTransfer && e.dataTransfer.files.length > 0) this.handleUpload(e.dataTransfer.files[0]);
  }
  onFileSelected(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) this.handleUpload(target.files[0]);
  }

  async handleUpload(file: File) {
    this.uploadError.set('');
    const ext = file.name.split('.').pop()?.toLowerCase();
    const allowed = ['pdf', 'docx', 'pptx', 'jpg', 'jpeg', 'png'];
    if (!ext || !allowed.includes(ext)) {
      this.uploadError.set('Định dạng không được hỗ trợ. Hãy chọn PDF, Word, PowerPoint hoặc Ảnh.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.uploadError.set('Dung lượng file vượt quá giới hạn (tối đa 10MB).');
      return;
    }
    await this.loadQuota();
    if (this.isQuotaFull()) { this.uploadError.set('Đã hết hạn mức lưu trữ. Hãy xóa tệp cũ.'); return; }
    this.uploading.set(true);
    this.uploadProgress.set(0);
    this.uploadingFileName.set(file.name);
    try {
      const uploadResult = await uploadData({
        path: ({ identityId }) => `raw/${identityId}/${Date.now()}-${file.name}`,
        data: file,
        options: {
          onProgress: (progress) => {
            if (progress.totalBytes)
              this.uploadProgress.set(Math.round((progress.transferredBytes / progress.totalBytes) * 100));
          }
        }
      }).result;
      const docType = ext === 'jpeg' ? 'jpg' : ext;
      const response = await client.models.Document.create({
        fileName: file.name, fileType: docType, fileSize: file.size,
        s3Key: uploadResult.path, status: 'uploaded', createdAt: new Date().toISOString(),
      });
      if (response.data) this.documents.set([response.data, ...this.documents()]);
      this.uploadProgress.set(100);
      setTimeout(() => this.uploading.set(false), 900);
      this.quota.set({ owner: this.userEmail(), uploadedCount: this.documents().length, maxUploads: 50 });
      this.showToast(`Đã tải lên "${file.name}" thành công.`, 'success');
    } catch (err: any) {
      console.error('Upload failed:', err);
      this.uploadError.set(err.message || 'Tải lên thất bại. Vui lòng kiểm tra kết nối.');
      this.uploading.set(false);
    }
  }

  async onDownload(doc: any) {
    try {
      const result = await getUrl({ path: doc.s3Key, options: { expiresIn: 300, validateObjectExistence: true } });
      window.open(result.url.toString(), '_blank');
    } catch (error) {
      console.error('Error getting download URL:', error);
      this.showToast('Không thể tải tệp này. File có thể không còn tồn tại.', 'error');
    }
  }

  async onDelete(doc: any) {
    const confirmed = await this.showConfirm({
      title: 'Xóa tài liệu',
      message: `Bạn có chắc muốn xóa "${doc.fileName}"? Hành động này không thể hoàn tác.`,
      type: 'delete',
      okText: 'Xóa',
      cancelText: 'Hủy',
    });
    if (!confirmed) return;
    try {
      await remove({ path: doc.s3Key });
      if (doc.processedS3Key) await remove({ path: doc.processedS3Key });
      await client.models.Document.delete({ id: doc.id });
      const updated = this.documents().filter(d => d.id !== doc.id);
      this.documents.set(updated);
      this.quota.set({ owner: this.userEmail(), uploadedCount: updated.length, maxUploads: 50 });
      if (this.previewDoc()?.id === doc.id) this.closePreview();
      this.showToast('Đã xóa tài liệu thành công.', 'success');
    } catch (error) {
      console.error('Failed to delete document:', error);
      this.showToast('Đã xảy ra lỗi khi xóa tài liệu.', 'error');
    }
  }

  async onRetry(doc: any) {
    if (this.retryingId()) return; // tránh double-click
    this.retryingId.set(doc.id);

    try {
      // 1. Reset status về 'uploaded' trong DynamoDB qua AppSync
      await client.models.Document.update({ id: doc.id, status: 'uploaded' });

      // Cập nhật local state ngay để UI phản hồi nhanh
      this.documents.set(this.documents().map(d =>
        d.id === doc.id ? { ...d, status: 'processing', summary: null, category: null } : d
      ));
      if (this.previewDoc()?.id === doc.id) {
        this.previewDoc.set({ ...doc, status: 'processing', summary: null, category: null });
      }

      // 2. Download binary file từ S3, rồi re-upload về cùng key để trigger Lambda A
      const dlResult = await downloadData({ path: doc.s3Key }).result;
      const blob = await dlResult.body.blob();
      const file = new File([blob], doc.fileName, { type: blob.type || 'application/octet-stream' });

      await uploadData({
        path: doc.s3Key, // cùng key cũ → S3 overwrite → trigger S3 event mới → Lambda A
        data: file,
      }).result;

      console.log(`Retry triggered for document ${doc.id}, key: ${doc.s3Key}`);
      this.showToast('Đang xử lý lại tài liệu...', 'info');
    } catch (err: any) {
      console.error('Retry failed:', err);
      // Rollback local state về error
      this.documents.set(this.documents().map(d =>
        d.id === doc.id ? { ...d, status: 'error' } : d
      ));
      this.showToast('Không thể thử lại. Vui lòng kiểm tra kết nối.', 'error');
    } finally {
      this.retryingId.set(null);
    }
  }

  async openPreview(doc: any) {
    this.previewDoc.set(doc);
    this.previewFileUrl.set(null);
    this.previewFileSafeUrl.set(null);
    if (this.isImageFile(doc.fileType) || doc.fileType === 'pdf') {
      try {
        const result = await getUrl({ path: doc.s3Key, options: { expiresIn: 300 } });
        const url = result.url.toString();
        this.previewFileUrl.set(url);
        this.previewFileSafeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
      } catch (error) {
        console.error('Error generating preview URL:', error);
      }
    }
  }

  closePreview() {
    this.previewDoc.set(null); this.previewFileUrl.set(null); this.previewFileSafeUrl.set(null);
  }

  // ── ANALYSIS MODE ──────────────────────────────────────────────────────────
  showAnalysisPrompt(doc: any) {
    this.analysisDoc.set(doc);
    this.selectedMode.set('summary_detailed'); // default
  }

  dismissAnalysisPrompt() {
    this.analysisDoc.set(null);
    this.selectedMode.set('');
  }

  async confirmAnalysisMode() {
    const doc = this.analysisDoc();
    const mode = this.selectedMode();
    if (!doc || !mode) return;

    this.submittingMode.set(true);
    try {
      // Lưu analysisMode + set status = processing → DynamoDB Stream trigger Lambda B
      await client.models.Document.update({
        id: doc.id,
        analysisMode: mode,
        status: 'processing',
      });

      // Cập nhật local state ngay
      this.documents.set(this.documents().map(d =>
        d.id === doc.id ? { ...d, analysisMode: mode, status: 'processing' } : d
      ));

      this.dismissAnalysisPrompt();
      this.showToast('Đang phân tích tài liệu...', 'info');
    } catch (err: any) {
      console.error('Failed to submit analysis mode:', err);
      this.showToast('Không thể gửi yêu cầu phân tích.', 'error');
    } finally {
      this.submittingMode.set(false);
    }
  }

  isImageFile(type?: string): boolean {
    if (!type) return false;
    return ['jpg', 'png', 'jpeg'].includes(type.toLowerCase());
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  getStatusLabel(status: string): string {
    switch (status) {
      case 'uploaded': return 'Đã tải lên';
      case 'processing': return 'Đang xử lý';
      case 'text_extracted': return 'Chờ phân tích';
      case 'done': return 'Đã phân tích';
      case 'error': return 'Lỗi';
      default: return status;
    }
  }

  checkTheme() {
    const saved = localStorage.getItem('theme');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = saved === 'dark' || (!saved && systemDark);
    this.isDarkTheme.set(dark);
    this.applyTheme(dark);
  }

  toggleTheme() {
    const dark = !this.isDarkTheme();
    this.isDarkTheme.set(dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    this.applyTheme(dark);
  }

  applyTheme(dark: boolean) {
    document.body.classList.toggle('dark-theme', dark);
  }

  // ── SEARCH + FILTER ─────────────────────────────────────────────────────
  onSearchChange() { /* computed tự cập nhật — chỉ cần ngModel trigger */ }
  clearSearch() { this.searchQuery = ''; }
  setFilter(value: string) { this.activeFilter.set(value); }

  // ── TOAST HELPERS ───────────────────────────────────────────────────────
  showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
    const id = ++this.toastCounter;
    this.toasts.update(ts => [...ts, { id, type, message }]);
    setTimeout(() => this.dismissToast(id), 3500);
  }

  dismissToast(id: number) {
    this.toasts.update(ts => ts.filter(t => t.id !== id));
  }

  // ── CONFIRM DIALOG HELPERS ───────────────────────────────────────────────
  showConfirm(options: Omit<ConfirmState, 'resolve'>): Promise<boolean> {
    return new Promise(resolve => {
      this.confirmState.set({ ...options, resolve });
    });
  }

  resolveConfirm(result: boolean) {
    const state = this.confirmState();
    if (state) {
      this.confirmState.set(null);
      state.resolve(result);
    }
  }

  async onLogout() {
    try {
      await signOut();
      this.router.navigate(['/auth']);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  }

  async saveDisplayName() {
    const name = this.nameInput.trim();
    if (!name) return;
    this.savingName.set(true);
    try {
      await updateUserAttributes({ userAttributes: { name } });
      this.userName.set(name);
      this.showNamePrompt.set(false);
      this.nameInput = '';
    } catch (err: any) {
      console.error('Failed to save name:', err);
    } finally {
      this.savingName.set(false);
    }
  }

  startEditName() {
    this.nameInput = this.userName() || '';
    this.editingName.set(true);
  }

  cancelEditName() {
    this.editingName.set(false);
    this.nameInput = '';
  }

  async confirmEditName() {
    const name = this.nameInput.trim();
    if (!name) { this.cancelEditName(); return; }
    this.savingName.set(true);
    try {
      await updateUserAttributes({ userAttributes: { name } });
      this.userName.set(name);
      this.editingName.set(false);
      this.nameInput = '';
      this.showToast('Đã cập nhật tên hiển thị.', 'success');
    } catch (err: any) {
      console.error('Failed to update name:', err);
      this.showToast('Không thể cập nhật tên.', 'error');
    } finally {
      this.savingName.set(false);
    }
  }

  skipNamePrompt() {
    // Đặt tên tạm từ email prefix để không hỏi lại trong cùng session
    const emailPrefix = this.userEmail().split('@')[0];
    this.userName.set(emailPrefix);
    this.showNamePrompt.set(false);
  }
}
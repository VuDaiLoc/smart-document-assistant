// Định nghĩa type Schema cho phía frontend
// Sử dụng interface thủ công thay vì import trực tiếp từ amplify/data/resource.ts
// Vì Angular compiler không nên biên dịch thư mục amplify/ backend

export interface Document {
  id: string;
  owner?: string | null;
  fileName: string;
  fileType: string;
  fileSize: number;
  s3Key: string;
  status?: 'uploaded' | 'processing' | 'text_extracted' | 'done' | 'error' | null;
  summary?: string | null;
  category?: string | null;
  textractJobId?: string | null;
  extractedText?: string | null;
  processedS3Key?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface UserQuota {
  owner: string;
  uploadedCount?: number | null;
  maxUploads?: number | null;
}

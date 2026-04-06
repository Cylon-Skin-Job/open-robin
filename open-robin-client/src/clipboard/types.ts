/**
 * @module clipboard/types
 * @role Type definitions for clipboard manager
 */

export interface ClipboardEntry {
  id: number;
  text: string;
  type: string;
  preview: string;
  created_at: number;
  last_used_at: number;
  source?: string;
}

export type BubbleState = 'CLOSED' | 'PREVIEW' | 'LOCKED' | 'LEAVING';

export interface ClipboardListResponse {
  items: ClipboardEntry[];
  total: number;
  offset: number;
  limit: number;
}

export interface ClipboardAppendResponse {
  item?: ClipboardEntry;
  error?: string;
}

export interface ClipboardTouchResponse {
  item?: ClipboardEntry;
  error?: string;
}

export interface ClipboardClearResponse {
  deleted: number;
  error?: string;
}

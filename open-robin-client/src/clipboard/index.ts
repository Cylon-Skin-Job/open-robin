/**
 * @module clipboard/index
 * @role Public exports for clipboard module
 */

export { ClipboardTrigger } from './ClipboardTrigger';
export { ClipboardPopover } from './ClipboardPopover';
export { useClipboardStore } from './clipboard-store';
export { writeAndRecord, listPage, touchEntry, clearHistory, copyFromHistory, startClipboardMonitor, stopClipboardMonitor } from './clipboard-api';
export {
  getClipboardController,
  attachClipboardController,
  detachClipboardController,
  subscribeClipboardController,
} from './interaction-controller';
export type {
  ClipboardEntry,
  BubbleState,
  ClipboardListResponse,
  ClipboardAppendResponse,
  ClipboardTouchResponse,
  ClipboardClearResponse,
} from './types';

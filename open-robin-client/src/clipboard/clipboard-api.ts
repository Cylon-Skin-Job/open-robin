/**
 * @module clipboard/clipboard-api
 * @role Public API for clipboard operations — uses ws-client for transport
 */

import { sendRobinMessage, onRobinMessage } from '../lib/ws-client';
import { showToast } from '../lib/toast';
import type {
  ClipboardEntry,
  ClipboardListResponse,
  ClipboardAppendResponse,
  ClipboardTouchResponse,
  ClipboardClearResponse,
} from './types';

// Clipboard monitoring state
let lastClipboardText = '';
let monitorInterval: ReturnType<typeof setInterval> | null = null;
const MONITOR_INTERVAL_MS = 1000; // Check every second

/**
 * Start monitoring the system clipboard for new content.
 * Requires clipboard read permission.
 */
export function startClipboardMonitor(): void {
  if (monitorInterval) return; // Already running
  
  // Check if we have clipboard read permission
  if (!navigator.clipboard || !navigator.clipboard.readText) {
    console.log('[Clipboard] Clipboard reading not supported');
    return;
  }
  
  monitorInterval = setInterval(async () => {
    try {
      const text = await navigator.clipboard.readText();
      
      // Only record if text changed and not empty
      if (text && text !== lastClipboardText) {
        lastClipboardText = text;
        
        // Check if this text is already in our history (avoid duplicates)
        const { items } = await listPage(0, 10);
        const exists = items.some(item => item.text === text);
        
        if (!exists) {
          // Silently record without showing toast for auto-captured items
          sendRobinMessage({ 
            type: 'clipboard:append', 
            text, 
            itemType: 'text', 
            source: 'auto' 
          });
        }
      }
    } catch (err) {
      // Permission denied or other error - silently ignore
      // This is expected if user hasn't granted clipboard permission
    }
  }, MONITOR_INTERVAL_MS);
  
  console.log('[Clipboard] Monitor started');
}

/**
 * Stop monitoring the clipboard.
 */
export function stopClipboardMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('[Clipboard] Monitor stopped');
  }
}

/**
 * Write text to system clipboard and record in history.
 */
export async function writeAndRecord(text: string, itemType: string = 'text'): Promise<ClipboardEntry | null> {
  try {
    // Write to system clipboard
    await navigator.clipboard.writeText(text);

    // Send to server
    return new Promise((resolve, reject) => {
      const unsubscribe = onRobinMessage('clipboard:append', (msg: ClipboardAppendResponse) => {
        unsubscribe();
        if (msg.error) {
          reject(new Error(msg.error));
        } else if (msg.item) {
          showToast('Copied to clipboard');
          resolve(msg.item);
        } else {
          reject(new Error('Unknown error'));
        }
      });

      sendRobinMessage({ type: 'clipboard:append', text, itemType, source: 'user' });

      // Timeout after 5 seconds
      setTimeout(() => {
        unsubscribe();
        reject(new Error('Timeout waiting for clipboard:append'));
      }, 5000);
    });
  } catch (err) {
    console.error('[Clipboard] writeAndRecord error:', err);
    showToast('Failed to copy to clipboard');
    return null;
  }
}

/**
 * List clipboard items with pagination.
 */
export async function listPage(offset: number = 0, limit: number = 50): Promise<ClipboardListResponse> {
  return new Promise((resolve, reject) => {
    const unsubscribe = onRobinMessage('clipboard:list', (msg: ClipboardListResponse & { error?: string }) => {
      unsubscribe();
      if (msg.error) {
        reject(new Error(msg.error));
      } else {
        resolve(msg);
      }
    });

    sendRobinMessage({ type: 'clipboard:list', offset, limit });

    setTimeout(() => {
      unsubscribe();
      reject(new Error('Timeout waiting for clipboard:list'));
    }, 5000);
  });
}

/**
 * Touch an entry (update last_used_at, move to front).
 */
export async function touchEntry(id: number): Promise<ClipboardEntry | null> {
  return new Promise((resolve, reject) => {
    const unsubscribe = onRobinMessage('clipboard:touch', (msg: ClipboardTouchResponse) => {
      unsubscribe();
      if (msg.error) {
        reject(new Error(msg.error));
      } else {
        resolve(msg.item || null);
      }
    });

    sendRobinMessage({ type: 'clipboard:touch', id });

    setTimeout(() => {
      unsubscribe();
      reject(new Error('Timeout waiting for clipboard:touch'));
    }, 5000);
  });
}

/**
 * Clear all clipboard history.
 */
export async function clearHistory(): Promise<number> {
  return new Promise((resolve, reject) => {
    const unsubscribe = onRobinMessage('clipboard:clear', (msg: ClipboardClearResponse) => {
      unsubscribe();
      if (msg.error) {
        reject(new Error(msg.error));
      } else {
        showToast('Clipboard history cleared');
        resolve(msg.deleted);
      }
    });

    sendRobinMessage({ type: 'clipboard:clear' });

    setTimeout(() => {
      unsubscribe();
      reject(new Error('Timeout waiting for clipboard:clear'));
    }, 5000);
  });
}

/**
 * Copy an entry to system clipboard and touch it.
 */
export async function copyFromHistory(entry: ClipboardEntry): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(entry.text);
    await touchEntry(entry.id);
    showToast('Copied to clipboard');
    return true;
  } catch (err) {
    console.error('[Clipboard] copyFromHistory error:', err);
    showToast('Failed to copy');
    return false;
  }
}

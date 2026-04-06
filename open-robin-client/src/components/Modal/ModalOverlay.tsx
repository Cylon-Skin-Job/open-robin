/**
 * @module ModalOverlay
 * @role React mount point for trigger-driven modal overlays
 *
 * The imperative showModal()/dismissModal() functions live in lib/modal.ts.
 * This component registers its state setter on mount so they work.
 *
 * Renders a backdrop + shell, delegating content to subtype renderers.
 * Modal definitions come from the server (ai/components/modals/{type}/settings/config.md).
 */

import { useState, useEffect, useCallback } from 'react';
import { registerModalSetter, unregisterModalSetter } from '../../lib/modal';
import type { ModalConfig } from '../../lib/modal';
import { DragFileModal } from './DragFileModal';
import { AlertModal } from './AlertModal';
import { showToast } from '../../lib/toast';
import './modal.css';

/**
 * Strip anything that could escape a <style> tag or execute code.
 * Defense-in-depth — settings/ enforcement is the primary gate.
 */
function sanitizeCss(css: string): string {
  return css
    .replace(/<\/?style[^>]*>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/@import\s+url/gi, '');
}

const MODAL_RENDERERS: Record<string, React.FC<{ config: ModalConfig; onDismiss: () => void }>> = {
  drag_file: DragFileModal,
  alert: AlertModal,
};

export function ModalOverlay() {
  const [modalConfig, setModalConfig] = useState<ModalConfig | null>(null);

  useEffect(() => {
    registerModalSetter((config: ModalConfig | null) => {
      if (config && config.modalType === 'toast') {
        showToast(config.data.message);
        return;
      }
      setModalConfig(config);
    });
    return () => { unregisterModalSetter(); };
  }, []);

  const handleDismiss = useCallback(() => {
    setModalConfig(null);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setModalConfig(null);
    }
  }, []);

  useEffect(() => {
    if (modalConfig) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [modalConfig, handleKeyDown]);

  if (!modalConfig) return null;

  const Renderer = MODAL_RENDERERS[modalConfig.modalType];
  if (!Renderer) {
    console.warn(`[ModalOverlay] Unknown modal type: ${modalConfig.modalType}`);
    return null;
  }

  return (
    <>
      {modalConfig.styles && (
        <style dangerouslySetInnerHTML={{ __html: sanitizeCss(modalConfig.styles) }} />
      )}
      <div className="rv-modal-overlay" onClick={handleDismiss}>
        <div className="rv-modal-shell" onClick={(e) => e.stopPropagation()}>
          <div className="rv-modal-header">
            <span className="rv-modal-title">{modalConfig.data.title}</span>
            <button className="rv-modal-close" onClick={handleDismiss}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <div className="rv-modal-body">
            <Renderer config={modalConfig} onDismiss={handleDismiss} />
          </div>
        </div>
      </div>
    </>
  );
}

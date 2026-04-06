/**
 * @module DragFileModal
 * @role Drag-to-deploy modal for moving files into settings/ folders
 *
 * Left panel: draggable markdown preview of the source file.
 * Right panel: drop target representing the settings/ folder.
 *
 * Uses HTML5 Drag and Drop API for native drag ghost and drop target handling.
 */

import { useState, useCallback, useRef } from 'react';
import { usePanelStore } from '../../state/panelStore';
import type { ModalConfig } from '../../lib/modal';

interface Props {
  config: ModalConfig;
  onDismiss: () => void;
}

export function DragFileModal({ config, onDismiss }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [deployed, setDeployed] = useState(false);
  const deployedTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const { data } = config;
  const sourceContent = data.sourceContent || '(no content)';
  const sourceName = data.source?.split('/').pop() || 'file';

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', data.source || '');
    e.dataTransfer.effectAllowed = 'move';
  }, [data.source]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    const ws = usePanelStore.getState().ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('[DragFileModal] WebSocket not connected');
      return;
    }

    ws.send(JSON.stringify({
      type: 'file:move',
      source: data.source,
      target: data.target,
    }));

    setDeployed(true);
    deployedTimer.current = setTimeout(() => {
      onDismiss();
    }, 1200);
  }, [data.source, data.target, onDismiss]);

  const targetLabel = config.config?.panels?.right
    ? (config.config.panels.right as Record<string, string>).label || 'settings/'
    : 'settings/';

  const targetIcon = config.config?.panels?.right
    ? (config.config.panels.right as Record<string, string>).icon || 'folder_special'
    : 'folder_special';

  return (
    <div className="rv-modal-split">
      {/* Source: draggable document preview */}
      <div
        className="rv-modal-source"
        draggable
        onDragStart={handleDragStart}
      >
        <div className="rv-modal-source-label">
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>description</span>
          {sourceName}
        </div>
        <div className="rv-modal-source-content">
          {sourceContent.slice(0, 2000)}
        </div>
      </div>

      {/* Target: drop zone */}
      <div
        className={`rv-modal-target ${dragOver ? 'drag-over' : ''} ${deployed ? 'deployed' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <span className="material-symbols-outlined rv-modal-target-icon">
          {deployed ? 'check_circle' : targetIcon}
        </span>
        <span className="rv-modal-target-label">
          {deployed ? 'Deployed' : targetLabel}
        </span>
        <span className="rv-modal-target-hint">
          {deployed ? data.message : 'Drop here to activate'}
        </span>
      </div>
    </div>
  );
}

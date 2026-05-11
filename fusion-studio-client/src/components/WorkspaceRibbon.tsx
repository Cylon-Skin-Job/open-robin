/**
 * @module WorkspaceRibbon
 * @role Glass dropdown ribbon for switching, adding, and removing workspaces.
 *
 * Drops down from beneath the header when the user clicks the centered
 * workspace title. Shows workspace icons centered with names beneath.
 *
 * Visual language borrows from the doc-viewer bottom ribbon:
 * diagonal white-alpha gradient, blurred backdrop, thin border.
 */

import { useEffect } from 'react';
import { useWorkspaceStore } from '../state/workspaceStore';
import { Icon } from './Icon';
import type { Workspace } from '../types';
import './WorkspaceRibbon.css';

export function WorkspaceRibbon() {
  const isOpen = useWorkspaceStore((s) => s.isRibbonOpen);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const closeRibbon = useWorkspaceStore((s) => s.closeRibbon);
  const openAddModal = useWorkspaceStore((s) => s.openAddModal);
  const requestSwitch = useWorkspaceStore((s) => s.requestSwitch);
  const requestRemove = useWorkspaceStore((s) => s.requestRemove);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRibbon();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, closeRibbon]);

  const sorted = [...workspaces].sort((a, b) => a.sortOrder - b.sortOrder);

  const onItemClick = (w: Workspace) => {
    closeRibbon();
    if (w.id === activeId) {
      return;
    }
    requestSwitch(w.id);
  };

  const onRemoveClick = (e: React.MouseEvent, w: Workspace) => {
    e.stopPropagation();
    const ok = window.confirm(
      `Remove "${w.label}"? This won't delete any files — the repo stays on disk.`
    );
    if (ok) requestRemove(w.id);
  };

  const onAddClick = () => {
    closeRibbon();
    openAddModal();
  };

  return (
    <>
      {isOpen && (
        <div className="rv-workspace-ribbon-scrim" onClick={closeRibbon} />
      )}
      <div
        className={`rv-workspace-ribbon ${isOpen ? 'is-open' : ''}`}
        aria-hidden={!isOpen}
      >
        <div className="rv-workspace-ribbon-grid">
          <div className="rv-workspace-ribbon-items">
            {sorted.map((w) => (
              <div
                key={w.id}
                className={`rv-workspace-ribbon-item ${w.id === activeId ? 'is-active' : ''}`}
                onClick={() => onItemClick(w)}
                title={w.label}
              >
                <Icon
                  name={w.icon || 'folder'}
                  className="rv-workspace-ribbon-item-icon"
                />
                <span className="rv-workspace-ribbon-item-label">{w.label}</span>
                <button
                  className="rv-workspace-ribbon-item-remove"
                  onClick={(e) => onRemoveClick(e, w)}
                  title="Remove"
                  type="button"
                >
                  <span className="material-symbols-outlined">delete</span>
                </button>
              </div>
            ))}
          </div>
          <button
            className="rv-workspace-ribbon-add"
            onClick={onAddClick}
            type="button"
            title="Add Project"
          >
            <span className="material-symbols-outlined rv-workspace-ribbon-add-icon">
              add
            </span>
            <span className="rv-workspace-ribbon-add-label">Add Project</span>
          </button>
        </div>
      </div>
    </>
  );
}

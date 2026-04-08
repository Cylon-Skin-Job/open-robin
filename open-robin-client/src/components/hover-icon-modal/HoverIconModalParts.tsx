/**
 * @module HoverIconModalParts
 * @role Presentational components for hover-triggered icon modals
 *
 * Pure props → JSX. No state, no effects, no logic.
 */

import React from 'react';
import type { ModalState } from './useHoverIconModal';
import './HoverIconModal.css';

// Trigger button component
interface HoverIconTriggerProps {
  icon: string;
  title: string;
  isOpen: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  triggerProps: {
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    onClick: () => void;
  };
}

export function HoverIconTrigger({ icon, title, isOpen, triggerRef, triggerProps }: HoverIconTriggerProps) {
  return (
    <button
      ref={triggerRef}
      className={`rv-hover-icon-trigger ${isOpen ? 'open' : ''}`}
      title={title}
      aria-label={title}
      aria-expanded={isOpen}
      {...triggerProps}
    >
      <span className="material-symbols-outlined">{icon}</span>
    </button>
  );
}

// Modal container component
interface HoverIconModalContainerProps {
  children: React.ReactNode;
  isOpen: boolean;
  state: ModalState;
  position: { left: number; bottom: number };
  popoverRef: React.RefObject<HTMLDivElement | null>;
  popoverProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
  className?: string;
}

export function HoverIconModalContainer({
  children,
  isOpen,
  state,
  position,
  popoverRef,
  popoverProps,
  className = '',
}: HoverIconModalContainerProps) {
  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className={`rv-hover-icon-modal ${isOpen ? 'open' : ''} ${state === 'LOCKED' ? 'locked' : ''} ${className}`}
      style={{
        position: 'fixed',
        left: position.left,
        bottom: position.bottom,
      }}
      {...popoverProps}
    >
      {children}
    </div>
  );
}

// Modal header component
interface HoverIconModalHeaderProps {
  title: string;
  action?: {
    icon: string;
    title: string;
    onClick: () => void;
  };
}

export function HoverIconModalHeader({ title, action }: HoverIconModalHeaderProps) {
  return (
    <div className="rv-hover-icon-modal-header">
      <span className="rv-hover-icon-modal-title">{title}</span>
      {action && (
        <button
          className="rv-hover-icon-modal-action"
          onClick={action.onClick}
          title={action.title}
        >
          <span className="material-symbols-outlined">{action.icon}</span>
        </button>
      )}
    </div>
  );
}

// Modal row component
interface HoverIconModalRowProps {
  children: React.ReactNode;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  isSelected?: boolean;
}

export function HoverIconModalRow({
  children,
  onClick,
  onMouseEnter,
  onMouseLeave,
  isSelected,
}: HoverIconModalRowProps) {
  return (
    <div
      className={`rv-hover-icon-modal-row ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  );
}

// Modal list container
interface HoverIconModalListProps {
  children: React.ReactNode;
  listRef?: React.RefObject<HTMLDivElement | null>;
}

export function HoverIconModalList({ children, listRef }: HoverIconModalListProps) {
  return <div ref={listRef} className="rv-hover-icon-modal-list">{children}</div>;
}

// Thumbnail component
interface HoverIconModalThumbProps {
  src: string;
  alt: string;
}

export function HoverIconModalThumb({ src, alt }: HoverIconModalThumbProps) {
  return (
    <div className="rv-hover-icon-modal-thumb">
      <img src={src} alt={alt} loading="lazy" />
    </div>
  );
}

// Content area
interface HoverIconModalContentProps {
  primary: string;
  secondary?: string;
}

export function HoverIconModalContent({ primary, secondary }: HoverIconModalContentProps) {
  return (
    <div className="rv-hover-icon-modal-content">
      <div className="rv-hover-icon-modal-content-primary">{primary}</div>
      {secondary && (
        <div className="rv-hover-icon-modal-content-secondary">{secondary}</div>
      )}
    </div>
  );
}

// Loading state
export function HoverIconModalLoading({ message = 'Loading...' }: { message?: string }) {
  return <div className="rv-hover-icon-modal-loading">{message}</div>;
}

// Empty state
interface HoverIconModalEmptyProps {
  icon?: string;
  message: string;
  hint?: string;
}

export function HoverIconModalEmpty({ icon = 'inbox', message, hint }: HoverIconModalEmptyProps) {
  return (
    <div className="rv-hover-icon-modal-empty">
      <span className="material-symbols-outlined">{icon}</span>
      <div>{message}</div>
      {hint && <div>{hint}</div>}
    </div>
  );
}

// Keyboard hint
export function HoverIconModalHint({ message }: { message: string }) {
  return (
    <div className="rv-hover-icon-modal-hint">
      <span className="material-symbols-outlined">keyboard</span>
      <span>{message}</span>
    </div>
  );
}

// Preview popover
interface HoverIconModalPreviewProps {
  src: string;
  label: string;
  position: { left: number; top: number };
}

export function HoverIconModalPreview({ src, label, position }: HoverIconModalPreviewProps) {
  return (
    <div
      className="rv-hover-icon-modal-preview"
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
      }}
    >
      <img src={src} alt={label} />
      <div className="rv-hover-icon-modal-preview-label">{label}</div>
    </div>
  );
}

/**
 * ToolCallBlock — Shared visual shell for all non-text segments.
 *
 * Header (icon + label from catalog) + collapsible content area.
 * Used by both LiveSegmentRenderer and InstantSegmentRenderer.
 */

import type { SegmentType } from '../types';
import {
  getSegmentVisual,
  getSegmentIcon,
  getSegmentIconColor,
  getSegmentLabelColor,
  buildSegmentLabelWithError,
} from '../lib/catalog-visual';
import { COLLAPSE_DURATION } from '../lib/timing';

interface ToolCallBlockProps {
  type: SegmentType;
  /** Override label (e.g., for grouped blocks showing count) */
  label?: string;
  /** Tool arguments for label building */
  toolArgs?: Record<string, unknown>;
  isError?: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** Show shimmer animation on the header */
  shimmer?: boolean;
  /** Override collapse animation duration (ms). Syncs CSS transition with JS sleep under pressure. */
  collapseDuration?: number;
  children?: React.ReactNode;
}

export function ToolCallBlock({
  type,
  label: labelOverride,
  toolArgs,
  isError,
  expanded,
  onToggle,
  shimmer,
  collapseDuration: collapseDurationOverride,
  children,
}: ToolCallBlockProps) {
  const effectiveCollapse = collapseDurationOverride ?? COLLAPSE_DURATION;
  const visual = getSegmentVisual(type);
  const icon = getSegmentIcon(type, isError);
  const iconColor = getSegmentIconColor(type, isError);
  const labelColor = getSegmentLabelColor(type, isError);
  const label = labelOverride || buildSegmentLabelWithError(type, toolArgs, isError);

  const hasContent = !!children;

  return (
    <div className="tool-fade-in" style={{ marginBottom: '12px' }}>
      {/* Header */}
      <button
        type="button"
        onClick={() => hasContent && onToggle()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 0',
          border: 'none',
          background: 'none',
          cursor: hasContent ? 'pointer' : 'default',
          color: labelColor,
          font: 'inherit',
          opacity: 1,
        }}
      >
        {icon && (
          <span
            className="material-symbols-outlined"
            style={{ fontSize: `${visual.iconSize}px`, color: iconColor }}
          >
            {icon}
          </span>
        )}
        <span
          className={shimmer ? 'shimmer-text' : undefined}
          style={{ fontSize: '13px', fontStyle: visual.labelStyle }}
        >
          {label}
          {hasContent && (
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: '16px',
                verticalAlign: 'middle',
                marginLeft: '2px',
                transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: `transform ${effectiveCollapse}ms ease`,
              }}
            >
              arrow_drop_down
            </span>
          )}
        </span>
      </button>

      {/* Content area */}
      {hasContent && (
        <div
          style={{
            marginLeft: '24px',
            maxHeight: expanded ? '2000px' : '0px',
            opacity: expanded ? 1 : 0,
            overflow: 'hidden',
            transition: `max-height ${effectiveCollapse}ms ease, opacity ${effectiveCollapse}ms ease`,
            ...(visual.borderLeft
              ? {
                  borderLeft: `${visual.borderLeft.width} solid ${visual.borderLeft.color}`,
                  paddingLeft: '12px',
                }
              : {}),
          }}
        >
          <div
            style={{
              padding: '8px 0',
              fontSize: '13px',
              color: visual.contentColor,
            }}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

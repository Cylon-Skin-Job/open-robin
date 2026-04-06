/**
 * Tool Grouper — manages grouping of consecutive same-type tool calls
 * and correlates tool_call → tool_result by toolCallId.
 *
 * WHY THIS EXISTS:
 *
 * Groupable tools (read, glob, grep, web_search, fetch) collapse
 * consecutive same-type calls into one visual segment. The grouper
 * tracks which tool calls belong to which group, and which segment
 * index each group writes to.
 *
 * The critical invariant: tool_result must ALWAYS find its group,
 * even if thinking/content tokens interleaved between tool_call
 * and tool_result. The wire protocol does not guarantee that
 * tool_result arrives immediately after tool_call — thinking
 * tokens, status updates, and other events can appear between them.
 *
 * KNOWN PAST BUG (DO NOT REINTRODUCE):
 * The old code used a single `group` variable that was set to null
 * on every content/thinking event. If thinking interleaved between
 * tool_call and tool_result, the group was lost. tool_result fell
 * to a non-grouped path and dumped full file contents as segment
 * content instead of the file path summary.
 *
 * THE FIX (two-layer tracking):
 *   1. `activeGroup` — tracks the CURRENT sequence for segment-building.
 *      Set to null on content/thinking (sequence is broken). Used by
 *      tool_call to decide: extend current group or start new one.
 *
 *   2. `toolCallMap` — maps EVERY toolCallId to its group info.
 *      NOT cleared by content/thinking. Only cleared on turn_end.
 *      Used by tool_result to always find its group.
 *
 * Layer 1 answers: "should this new tool_call join the current group?"
 * Layer 2 answers: "which group does this tool_result belong to?"
 *
 * LIFECYCLE:
 *   turn_begin  → reset()
 *   tool_call   → onToolCall() — registers in both layers
 *   content     → breakSequence() — clears layer 1 only
 *   thinking    → breakSequence() — clears layer 1 only
 *   tool_result → getGroupForResult() — reads layer 2
 *   turn_end    → reset()
 */

import type { SegmentType } from '../types';
import { isGroupable } from './catalog-visual';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Layer 1: the current sequence being built. */
interface ActiveGroup {
  type: SegmentType;
  segmentIndex: number;
  toolCallIds: Set<string>;
  count: number;
}

/** Layer 2: per-toolCallId registration (survives interleaving). */
interface GroupEntry {
  type: SegmentType;
  segmentIndex: number;
}

/** Result of onToolCall — tells the caller what to do. */
export interface ToolCallAction {
  /** 'extend' = add to existing segment. 'new' = push a new segment. */
  action: 'extend' | 'new';
  /** For 'new': the segment type to push. For 'extend': ignored. */
  segmentType: SegmentType;
  /** For 'extend': the segment index to append content to. */
  segmentIndex?: number;
}

/** Result of getGroupForResult — tells the caller how to handle tool_result. */
export interface ToolResultLookup {
  /** Whether this tool_result belongs to a grouped segment. */
  grouped: boolean;
  /** The segment type. */
  type: SegmentType;
  /** The segment index to append summary content to (grouped only). */
  segmentIndex: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// State
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Layer 1: current group sequence. Cleared by content/thinking. */
let activeGroup: ActiveGroup | null = null;

/** Layer 2: every toolCallId → group info. Survives interleaving. Cleared on turn_end. */
const toolCallMap = new Map<string, GroupEntry>();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Public API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * A new tool_call arrived. Register it and decide whether to
 * extend the current group or start a new segment.
 *
 * @param segType — canonical segment type (from toolNameToSegmentType)
 * @param toolCallId — unique ID for correlation
 * @param currentSegmentCount — current segments.length in the store (for new segment index)
 * @returns action telling the caller what to do
 */
export function onToolCall(
  segType: SegmentType,
  toolCallId: string,
  currentSegmentCount: number,
): ToolCallAction {
  if (isGroupable(segType)) {
    if (activeGroup && activeGroup.type === segType) {
      // Extend current group
      activeGroup.toolCallIds.add(toolCallId);
      activeGroup.count++;
      toolCallMap.set(toolCallId, {
        type: segType,
        segmentIndex: activeGroup.segmentIndex,
      });
      return { action: 'extend', segmentType: segType, segmentIndex: activeGroup.segmentIndex };
    } else {
      // Start new group
      activeGroup = {
        type: segType,
        segmentIndex: currentSegmentCount,
        toolCallIds: new Set([toolCallId]),
        count: 1,
      };
      toolCallMap.set(toolCallId, {
        type: segType,
        segmentIndex: currentSegmentCount,
      });
      return { action: 'new', segmentType: segType };
    }
  } else {
    // Non-groupable — always a new segment, breaks any active group
    activeGroup = null;
    return { action: 'new', segmentType: segType };
  }
}

/**
 * A tool_result arrived. Look up which group it belongs to.
 * Uses layer 2 (toolCallMap) which survives interleaving.
 *
 * @returns lookup info, or null if this toolCallId was never registered
 */
export function getGroupForResult(toolCallId: string): ToolResultLookup | null {
  const entry = toolCallMap.get(toolCallId);
  if (!entry) return null;
  return {
    grouped: true,
    type: entry.type,
    segmentIndex: entry.segmentIndex,
  };
}

/**
 * A non-tool event arrived (content, thinking).
 * Breaks the current sequence (layer 1) but preserves
 * the toolCallId registry (layer 2).
 */
export function breakSequence(): void {
  activeGroup = null;
}

/**
 * Turn ended or new turn began. Clear everything.
 */
export function reset(): void {
  activeGroup = null;
  toolCallMap.clear();
}

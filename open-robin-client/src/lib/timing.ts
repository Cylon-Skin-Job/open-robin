/**
 * Timing Constants — fallback defaults for tool call animations.
 *
 * Most timing is now controlled by the pressure gauge (lib/pressure.ts).
 * These constants are only used as fallback defaults when pressure
 * values aren't provided:
 *   - INTER_CHUNK_PAUSE: reveal/orchestrator.ts fallback
 *   - COLLAPSE_DURATION: ToolCallBlock.tsx fallback
 */

/** Pause between typing chunks within a reveal (fallback for reveal orchestrator) */
export const INTER_CHUNK_PAUSE = 80;

/** Duration of the maxHeight fold animation (fallback for ToolCallBlock) */
export const COLLAPSE_DURATION = 300;

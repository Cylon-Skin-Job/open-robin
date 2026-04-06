/**
 * Catalog — Unified Pipeline Registry
 *
 * One entry per tool type. Everything about how a segment flows through
 * the pipeline: chunking strategy, transform, content renderer, reveal
 * controller, speed override.
 *
 * Visual identity (icons, colors, labels) lives in catalog-visual.ts.
 * This file is ONLY pipeline data.
 *
 * Adding a new tool:
 *   1. Write a chunk strategy in chunk-strategies/active/
 *   2. Add one entry here
 *   3. Done. No controllers, renderers, or dispatch files change.
 */

import type { SegmentType } from '../types';
import type { TaggedChunk } from '../types/tagged-chunk';
import type { ActiveChunkStrategy } from '../types/active-strategy';
import type { SegmentContentRenderer } from './segment-renderers/types';
import type { RevealController } from './reveal/types';

// ── Strategy factories ──
import { createSingleChunkStrategy } from './chunk-strategies/active/single-chunk';
import { createLineChunkStrategy } from './chunk-strategies/active/line-chunk';
import { createMarkdownChunkStrategy } from './chunk-strategies/active/markdown-chunk';

// ── Content renderers ──
import { lineStreamRenderer } from './segment-renderers/line-stream';
import { codeRenderer } from './segment-renderers/code';
import { diffRenderer } from './segment-renderers/diff';
// groupedSummaryRenderer available if needed for future tool types

// ── Reveal controllers ──
import { lineStreamReveal } from './reveal/line-stream';
// groupedSummaryReveal available if needed for future tool types

// ── Transforms ──
import { filePathTransform } from './transforms/file-path-transform';

// =============================================================================
// CATALOG ENTRY INTERFACE
// =============================================================================

export interface CatalogEntry {
  /** Segment type identifier */
  type: SegmentType;

  /** Wire tag names that map to this type */
  tags: string[];

  /** Factory: create a fresh strategy instance per segment */
  createStrategy: (parent: string, args?: Record<string, unknown>) => ActiveChunkStrategy;

  /** Optional data transform (e.g., path truncation). Null = pass-through. */
  transform?: (chunk: TaggedChunk, toolArgs?: Record<string, unknown>) => TaggedChunk;

  /** Content renderer for producing HTML from chunks */
  renderer: SegmentContentRenderer;

  /** Reveal controller for the typing/display loop */
  revealController: RevealController;

  /** Speed override. 'fast' or 'slow' skip the attenuator. Null = attenuator decides. */
  speed?: 'fast' | 'slow';

  /** Whether to hold chunks until tool result arrives */
  awaitsResult?: boolean;
}

// =============================================================================
// CATALOG ENTRIES
// =============================================================================

const CATALOG: Record<SegmentType, CatalogEntry> = {
  text: {
    type: 'text',
    tags: [],
    createStrategy: () => createMarkdownChunkStrategy(),
    renderer: lineStreamRenderer,
    revealController: lineStreamReveal,
  },

  think: {
    type: 'think',
    tags: ['Thinking', 'thinking'],
    createStrategy: (parent) => createLineChunkStrategy(parent, 'think'),
    renderer: lineStreamRenderer,
    revealController: lineStreamReveal,
    speed: 'slow',
  },

  shell: {
    type: 'shell',
    tags: ['Bash', 'bash'],
    createStrategy: (parent) => createLineChunkStrategy(parent, 'shell'),
    renderer: lineStreamRenderer,
    revealController: lineStreamReveal,
    speed: 'fast',
    awaitsResult: true,
  },

  read: {
    type: 'read',
    tags: ['Read', 'read'],
    createStrategy: (parent) => createLineChunkStrategy(parent, 'code'),
    transform: filePathTransform,
    renderer: lineStreamRenderer,
    revealController: lineStreamReveal,
    speed: 'fast',
    awaitsResult: true,
  },

  write: {
    type: 'write',
    tags: ['Write', 'write'],
    createStrategy: (parent, args) => createSingleChunkStrategy(parent, 'code', langFromPath(args)),
    transform: filePathTransform,
    renderer: codeRenderer,
    revealController: lineStreamReveal,
    speed: 'fast',
    awaitsResult: true,
  },

  edit: {
    type: 'edit',
    tags: ['Edit', 'edit'],
    createStrategy: (parent, args) => createSingleChunkStrategy(parent, 'diff', langFromPath(args)),
    transform: filePathTransform,
    renderer: diffRenderer,
    revealController: lineStreamReveal,
    speed: 'fast',
    awaitsResult: true,
  },

  glob: {
    type: 'glob',
    tags: ['Glob', 'glob'],
    createStrategy: (parent) => createLineChunkStrategy(parent, 'code'),
    renderer: lineStreamRenderer,
    revealController: lineStreamReveal,
    speed: 'fast',
    awaitsResult: true,
  },

  grep: {
    type: 'grep',
    tags: ['Grep', 'grep'],
    createStrategy: (parent) => createLineChunkStrategy(parent, 'code'),
    renderer: lineStreamRenderer,
    revealController: lineStreamReveal,
    speed: 'fast',
    awaitsResult: true,
  },

  web_search: {
    type: 'web_search',
    tags: ['WebSearch', 'web_search'],
    createStrategy: (parent) => createLineChunkStrategy(parent, 'code'),
    renderer: lineStreamRenderer,
    revealController: lineStreamReveal,
    speed: 'fast',
    awaitsResult: true,
  },

  fetch: {
    type: 'fetch',
    tags: ['WebFetch', 'fetch'],
    createStrategy: (parent) => createLineChunkStrategy(parent, 'code'),
    renderer: lineStreamRenderer,
    revealController: lineStreamReveal,
    speed: 'fast',
    awaitsResult: true,
  },

  subagent: {
    type: 'subagent',
    tags: ['Agent', 'subagent'],
    createStrategy: (parent) => createLineChunkStrategy(parent, 'text'),
    renderer: lineStreamRenderer,
    revealController: lineStreamReveal,
  },

  todo: {
    type: 'todo',
    tags: ['TodoWrite', 'todo'],
    createStrategy: (parent) => createLineChunkStrategy(parent, 'text'),
    renderer: lineStreamRenderer,
    revealController: lineStreamReveal,
  },
};

// =============================================================================
// LOOKUP FUNCTIONS
// =============================================================================

/**
 * Look up a catalog entry by segment type.
 */
export function lookup(type: SegmentType): CatalogEntry {
  return CATALOG[type];
}

/**
 * Look up a catalog entry by wire tag name.
 * Returns undefined if no entry matches the tag.
 */
export function lookupByTag(tag: string): CatalogEntry | undefined {
  for (const entry of Object.values(CATALOG)) {
    if (entry.tags.includes(tag)) return entry;
  }
  return undefined;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Extract language from tool args' file path (e.g., '.ts' → 'typescript').
 */
function langFromPath(args?: Record<string, unknown>): string | undefined {
  const p = args?.path ?? args?.file_path;
  if (typeof p !== 'string') return undefined;

  const ext = p.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;

  const EXT_MAP: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    rb: 'ruby',
    java: 'java',
    css: 'css',
    html: 'html',
    json: 'json',
    md: 'markdown',
    sh: 'bash',
    yml: 'yaml', yaml: 'yaml',
  };

  return EXT_MAP[ext] ?? ext;
}

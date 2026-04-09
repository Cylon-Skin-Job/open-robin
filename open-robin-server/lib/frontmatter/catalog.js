/**
 * Frontmatter type catalog.
 *
 * The authoritative list of file types that are allowed to participate
 * in frontmatter-driven behavior. Files NOT in this catalog cannot be
 * parsed through lib/frontmatter/index.js — the type-gate throws.
 *
 * Adding a new entry here is the ONLY way to expand the frontmatter
 * activation surface. Reviewers: scrutinize additions, especially any
 * with activatesEventBus: true.
 *
 * The `fields` array is documentation-only in SPEC-25. Runtime field
 * validation may be added later if a caller needs it — do not add it
 * preemptively.
 *
 * The `activatesEventBus` flag is also documentation-only today. It
 * exists to make the activation surface explicit and grep-friendly.
 * SPEC-30 (hot reload on settings/ changes) may consume it.
 */

module.exports = {
  trigger: {
    description: 'TRIGGERS.md files under agent/view settings/ folders. Each block registers an event bus listener or a cron job.',
    fields: [],  // accept any — triggers are free-form
    activatesEventBus: true,
  },

  ticket: {
    description: 'Ticket metadata for the issues-viewer Kanban board.',
    fields: [],  // expected: id, title, status, assignee, blocks, blocked_by (not enforced)
    activatesEventBus: false,
  },

  filter: {
    description: 'Watcher filter definitions — declarative file-change filters with match/exclude patterns, actions, and templates.',
    fields: [],
    activatesEventBus: true,
  },

  component: {
    description: 'Declarative UI component configs (modals, etc.) under ai/components/*/settings/config.md.',
    fields: [],
    activatesEventBus: false,
  },

  chat: {
    description: '(STUB — wired up in SPEC-24b.) Chat thread display metadata. Filename is the thread ID; frontmatter holds the display name only.',
    fields: ['name'],
    activatesEventBus: false,
  },
};

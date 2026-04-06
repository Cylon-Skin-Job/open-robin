/**
 * Migration 002 — System panel tables + seed data
 *
 * Adds: system_tabs, cli_registry tables
 * Alters: system_wiki (tab, description, surface_when, category, sort_order, locked)
 *         system_config (tab, section, icon, description, surface_when, wiki_slug, sort_order)
 * Seeds: 5 tabs, wiki sections per tab, CLI registry entries, config items
 */

exports.up = async function (knex) {
  // --- New tables ---

  await knex.schema.createTable('system_tabs', (t) => {
    t.text('id').primary();
    t.text('label').notNullable();
    t.text('icon').notNullable();
    t.text('description');
    t.integer('sort_order').defaultTo(0);
  });

  await knex.schema.createTable('cli_registry', (t) => {
    t.text('id').primary();
    t.text('name').notNullable();
    t.text('author').notNullable();
    t.text('description').notNullable();
    t.text('version');
    t.text('pricing_url');
    t.text('docs_url');
    t.text('surface_when');
    t.integer('installed').defaultTo(0);
    t.integer('active').defaultTo(0);
    t.text('config'); // JSON: { cli, flags, model, endpoint }
    t.integer('sort_order').defaultTo(0);
  });

  // --- Alter existing tables (SQLite: one ALTER per column) ---

  await knex.schema.alterTable('system_wiki', (t) => {
    t.text('tab').references('id').inTable('system_tabs');
    t.text('description');
    t.text('surface_when');
    t.text('category');
    t.integer('sort_order').defaultTo(0);
    t.integer('locked').defaultTo(1);
  });

  await knex.schema.alterTable('system_config', (t) => {
    t.text('tab').references('id').inTable('system_tabs');
    t.text('section');
    t.text('icon');
    t.text('description');
    t.text('surface_when');
    t.text('wiki_slug').references('slug').inTable('system_wiki');
    t.integer('sort_order').defaultTo(0);
  });

  // --- Seed: system_tabs ---

  await knex('system_tabs').insert([
    {
      id: 'clis',
      label: 'CLIs',
      icon: 'terminal',
      description: 'Open Robin works by connecting to AI assistants that run on your machine. These assistants are called CLIs. You need at least one installed for Open Robin to work.',
      sort_order: 0,
    },
    {
      id: 'connectors',
      label: 'Connectors',
      icon: 'link',
      description: 'Connectors let Open Robin talk to services you already use, like GitLab or GitHub. When a connector is active, Open Robin can sync tickets, pull in issues, and keep your external tools in the loop.',
      sort_order: 1,
    },
    {
      id: 'secrets',
      label: 'Secrets',
      icon: 'key',
      description: 'Some connectors and services need passwords or tokens to work. Secrets are stored safely on your machine and are never shared with AI agents. Only Open Robin uses them behind the scenes.',
      sort_order: 2,
    },
    {
      id: 'llm-providers',
      label: 'LLM Providers',
      icon: 'host',
      description: 'Entirely optional. If you\'re happy with your CLI sign-in, there\'s nothing to do here. But if you want to add your own API keys, choose specific models, or connect to different providers, this is where you set that up.',
      sort_order: 3,
    },
    {
      id: 'enforcement',
      label: 'Enforcement',
      icon: 'shield',
      description: 'These are the safety rules. They control what AI agents are allowed to do on your machine. You\'re in charge here — agents can\'t change these settings, only you can.',
      sort_order: 4,
    },
  ]);

  // --- Seed: system_wiki (one page per tab, headings within) ---

  const now = Date.now();

  await knex('system_wiki').insert([
    {
      slug: 'clis',
      title: 'CLIs',
      content: '## What is a CLI?\n\nA CLI (command-line interface) is an AI assistant that runs on your machine. It\'s the engine that powers your conversations and agent tasks. Open Robin doesn\'t process AI requests itself — it connects to a CLI and displays the results.\n\nThink of Open Robin as the dashboard and the CLI as the engine under the hood. You can swap engines anytime.\n\n## Why does Open Robin use a CLI?\n\nOpen Robin is a harness, not an AI. It reads what your CLI sends back and displays it in a visual interface you can manage. This means you\'re never locked into one provider — you can switch CLIs, use different ones for different tasks, or try a new one without changing anything about your project.\n\nYour CLI handles the AI work. Open Robin handles everything else: organizing conversations, managing files, running triggers, and keeping your project in order.\n\n## Can I switch between CLIs?\n\nYes. You can have multiple CLIs installed and switch between them. Each CLI has its own configuration, but your project, conversations, and settings stay the same regardless of which CLI is active.\n\nSome people use one CLI for everyday coding and another for research or analysis. Open Robin makes it easy to swap — just change the active CLI in this panel.\n\n## Will using a CLI cost me money?\n\nOpen Robin is completely free. It will never charge you anything.\n\nThe AI work itself — the conversations, the code generation, the analysis — that\'s handled by whichever CLI you choose. How you pay for that is entirely up to you. Most CLI providers offer metered plans where you sign in and get a monthly token allocation, often at rates significantly lower than raw API pricing. Some, like Qwen and Gemini, even have generous free tiers.\n\nYou can also bring your own API keys from any provider and configure your CLI to use them directly. Either way, you\'re buying tokens from the AI provider of your choice — not from us. Open Robin simply sits in the middle and tells you what\'s happening.',
      context: 'CLI = command-line AI assistant binary installed locally. Open Robin reads the wire protocol (RPC) and renders output. The CLI handles all AI inference. Examples: kimi, claude, qwen, codex, gemini, opencode. User must have at least one installed. Open Robin is a harness/display layer — no lock-in, any CLI, any API key, any provider. Multiple CLIs can be installed simultaneously. Active CLI set per-system in robin.db. Switching CLIs does not affect project state, chat history, triggers, or settings. Open Robin is free, charges nothing. Token costs go to the CLI provider. Metered CLI plans are often cheaper than raw API pricing. Free tiers: Qwen ~2000 req/day, Gemini ~1000 req/day. BYO API keys also supported.',
      tab: 'clis',
      description: 'What CLIs are, why Open Robin uses them, switching, and cost',
      surface_when: 'User is new to the system, asks what a CLI is, questions the architecture, wants to switch CLIs, or asks about cost',
      category: 'cli',
      sort_order: 0,
      locked: 1,
      updated_at: now,
    },
    {
      slug: 'llm-providers',
      title: 'LLM Providers',
      content: '## What is an LLM provider?\n\nAn LLM provider is a company that offers AI models — like Anthropic, OpenAI, or Google. If you\'re already signed into a CLI and happy with how things work, you don\'t need to change anything here. This section is entirely optional.\n\nWhat it gives you is more control. You can add your own API keys from different providers, choose specific models, and create different configurations for different kinds of work. Think of it as extra customization on top of your CLI.\n\n## CLI sign-in vs provider API keys\n\nWhen you sign into a CLI like Claude Code or Codex, you\'re using that provider\'s metered plan. It\'s the simplest setup — sign in and go.\n\nAdding a provider here gives you a second option. You can bring your own API key from any provider and configure your CLI to use it instead. Some people prefer this for more control over billing, or because they want access to specific models that aren\'t available through the CLI\'s default sign-in.\n\nYou can switch between the two anytime. Your CLI sign-in stays active — adding a provider key just gives you another way to connect.\n\n## How do I add a provider?\n\nClick **Add Provider** in the list on the left. Open Robin comes with a list of known providers, and each one is pre-configured with the right endpoints. Some providers offer separate endpoints for coding-specific keys versus general pay-as-you-go keys — you\'ll see both options and can select which one to use.\n\nEnter your API key, save it, and it\'s stored securely. Once saved, you\'ll see it masked in the list. From there, you can pick which models from that provider you want available — Open Robin pulls the model list directly from the provider, so it\'s always up to date.\n\n## Will my API keys be safe?\n\nYes. Provider keys are stored in the same encrypted secrets manager that holds all your other credentials. You can view and manage them here or in the Secrets tab — both are looking at the same thing. AI agents never have access to your keys, and they never leave your machine.',
      context: 'LLM providers = companies offering AI models (Anthropic, OpenAI, Google, etc.). This tab is optional — CLI sign-in works without it. Two auth modes: (1) CLI sign-in = metered plan, simplest. (2) BYO API key from provider = more control, specific models, billing flexibility. Provider keys stored in same encrypted secrets manager as all other credentials. Pre-configured known providers with correct endpoints. Some providers have separate coding vs general endpoints — both available with radio selection. Model dropdown populated via provider API. Keys masked when saved. AI agents never access keys.',
      tab: 'llm-providers',
      description: 'What LLM providers are, adding keys, choosing models, and key security',
      surface_when: 'User asks about API keys, providers, adding models, or configuring alternative inference sources',
      category: 'llm-providers',
      sort_order: 0,
      locked: 1,
      updated_at: now,
    },
    {
      slug: 'connectors',
      title: 'Connectors',
      content: '## What are connectors?\n\nConnectors let Open Robin talk to external services you already use — like GitLab, GitHub, or Jira. When a connector is active, Open Robin can pull in issues, sync ticket status, and keep your external tools up to date with what\'s happening in your project.\n\nConnectors run on your machine and use your credentials. Nothing is sent to Open Robin\'s servers because there aren\'t any.\n\n## Is my data shared externally?\n\nNo. Connectors run entirely on your machine. When Open Robin syncs with GitLab, for example, it\'s your machine talking directly to GitLab using your credentials. Open Robin has no servers, no cloud, no telemetry. Your data stays between your machine and the services you choose to connect.',
      context: 'Connectors = integrations with external services (GitLab, GitHub, Jira, etc.). Run locally, use user credentials stored in secrets manager. Sync is bidirectional where supported. No Open Robin servers involved — everything local. Zero data sharing. No telemetry, no cloud sync, no analytics. Fully local architecture.',
      tab: 'connectors',
      description: 'What connectors are and data privacy',
      surface_when: 'User asks about integrations, external services, or data privacy',
      category: 'connector',
      sort_order: 0,
      locked: 1,
      updated_at: now,
    },
    {
      slug: 'secrets',
      title: 'Secrets',
      content: '## What is the secrets manager?\n\nThe secrets manager stores sensitive information like API keys, access tokens, and passwords. Everything is encrypted and stored locally on your machine in Open Robin\'s database. Secrets are used by connectors and CLI configurations behind the scenes.\n\nYou can add, update, or remove secrets anytime from this panel.\n\n## Can AI agents see my secrets?\n\nNo. This is a hard rule. AI agents never have access to your secrets, API keys, or tokens. The enforcement system prevents it. When a connector needs a token to sync with GitLab, Open Robin\'s server process uses it directly — the AI never sees it.\n\nThis is by design, not configuration. You can\'t accidentally expose secrets to an agent.',
      context: 'Secrets = encrypted key-value store in robin.db. Holds: API keys, access tokens, passwords. Used by connectors and CLI configs. Never exposed to AI agents — enforcement rule. Only Open Robin server process reads them for connector/CLI auth. Stored locally, never synced. Hard enforcement: AI agents NEVER get secret access. This is a security boundary, not a preference.',
      tab: 'secrets',
      description: 'How secrets are stored and AI access rules',
      surface_when: 'User asks about secret storage, encryption, credentials, or AI access to secrets',
      category: 'secret',
      sort_order: 0,
      locked: 1,
      updated_at: now,
    },
    {
      slug: 'enforcement',
      title: 'Enforcement',
      content: '## What are safety rules?\n\nSafety rules control what AI agents can and can\'t do on your machine. They\'re hardcoded into Open Robin — agents can\'t change them, disable them, or work around them. Only you can adjust enforcement settings from this panel.\n\nThe defaults are designed to keep you in control: agents can\'t modify their own configuration, can\'t access your secrets, and need your approval for certain actions.\n\n## Can I override these rules?\n\nSome rules have an override toggle, but they\'re labeled clearly — and for good reason. The default rules exist to prevent common mistakes, like an AI accidentally overwriting its own configuration or exposing your credentials.\n\nYou\'re always in charge. If you know what you\'re doing and want to relax a rule, you can. But Open Robin will make sure you understand what you\'re changing before you do it.',
      context: 'Enforcement = hardcoded safety rules. Not configurable by AI. Write-locked: settings/ folders (any case, dot-prefix variants). AI cannot: modify own config, access secrets, change enforcement rules, write to settings/ folders. Override toggle exists but labeled "this is a bad idea." Enforcement fires tool_bounced event on violation. User is trusted — enforcement constrains AI, not the human. Threat model: AI is the untrusted actor.',
      tab: 'enforcement',
      description: 'Safety rules and override options',
      surface_when: 'User asks about what agents can do, safety, permissions, or overriding rules',
      category: 'enforcement',
      sort_order: 0,
      locked: 1,
      updated_at: now,
    },
  ]);

  // --- Seed: cli_registry ---

  const cliSurfaceWhen = 'User asks about this CLI\'s capabilities, pricing, or comparison with other CLIs. These tools update frequently — research via docs_url and pricing_url before answering. Do not guess at features or pricing.';

  await knex('cli_registry').insert([
    {
      id: 'kimi',
      name: 'Kimi',
      author: 'Kimi AI',
      description: 'The default AI assistant for Open Robin. Purpose-built for IDE integration with native wire protocol support.',
      version: '2026',
      pricing_url: null,
      docs_url: null,
      surface_when: cliSurfaceWhen,
      installed: 1,
      active: 1,
      config: JSON.stringify({ cli: 'kimi', flags: [], model: null, endpoint: null }),
      sort_order: 0,
    },
    {
      id: 'qwen',
      name: 'Qwen Code',
      author: 'Alibaba / QwenLM',
      description: 'Open-source agent with free tier. Supports ACP wire protocol for IDE embedding. Uses Qwen3-Coder models.',
      version: '2026',
      pricing_url: null,
      docs_url: 'https://github.com/QwenLM/Qwen-Agent',
      surface_when: cliSurfaceWhen,
      installed: 0,
      active: 0,
      config: JSON.stringify({ cli: 'qwen', flags: [], model: null, endpoint: null }),
      sort_order: 1,
    },
    {
      id: 'claude',
      name: 'Claude Code',
      author: 'Anthropic',
      description: 'Deep reasoning and careful analysis. Large context window. Supports hooks, plan mode, and the Agent Client Protocol.',
      version: '2.1',
      pricing_url: 'https://www.anthropic.com/pricing',
      docs_url: 'https://docs.anthropic.com/en/docs/claude-code',
      surface_when: cliSurfaceWhen,
      installed: 0,
      active: 0,
      config: JSON.stringify({ cli: 'claude', flags: [], model: null, endpoint: null }),
      sort_order: 2,
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      author: 'SST',
      description: 'Fast-growing open-source alternative. Go-based, polished UI, 75+ model providers. Works offline with local models.',
      version: '2026',
      pricing_url: null,
      docs_url: 'https://github.com/sst/opencode',
      surface_when: cliSurfaceWhen,
      installed: 0,
      active: 0,
      config: JSON.stringify({ cli: 'opencode', flags: [], model: null, endpoint: null }),
      sort_order: 3,
    },
    {
      id: 'codex',
      name: 'Codex CLI',
      author: 'OpenAI',
      description: 'Fast, lightweight Rust-based agent. Full-auto mode for hands-off execution. Cloud mode for async tasks.',
      version: '0.116',
      pricing_url: 'https://openai.com/api/pricing/',
      docs_url: 'https://github.com/openai/codex',
      surface_when: cliSurfaceWhen,
      installed: 0,
      active: 0,
      config: JSON.stringify({ cli: 'codex', flags: [], model: null, endpoint: null }),
      sort_order: 4,
    },
    {
      id: 'gemini',
      name: 'Gemini CLI',
      author: 'Google',
      description: 'Free tier with generous daily limits. Built-in Google Search grounding. Open source.',
      version: '2026',
      pricing_url: 'https://ai.google.dev/pricing',
      docs_url: 'https://github.com/google-gemini/gemini-cli',
      surface_when: cliSurfaceWhen,
      installed: 0,
      active: 0,
      config: JSON.stringify({ cli: 'gemini', flags: [], model: null, endpoint: null }),
      sort_order: 5,
    },
  ]);

  // --- Seed: system_config (settings items per tab) ---

  await knex('system_config').insert([
    // Enforcement tab items
    {
      key: 'settings-write-lock',
      value: 'true',
      updated_at: now,
      tab: 'enforcement',
      section: 'Rules',
      icon: 'lock',
      description: 'AI agents cannot modify any configuration files. Only you can change settings, by dragging files into the settings folder.',
      surface_when: 'User asks about AI permissions or why an agent was blocked from writing',
      wiki_slug: 'enforcement',
      sort_order: 0,
    },
    {
      key: 'deploy-modals',
      value: 'true',
      updated_at: now,
      tab: 'enforcement',
      section: 'Rules',
      icon: 'drag_pan',
      description: 'When an AI suggests new configuration, a visual approval screen appears. You drag the file to accept it, or close to reject.',
      surface_when: 'User sees a deploy modal or asks about the approval process',
      wiki_slug: 'enforcement',
      sort_order: 1,
    },
    {
      key: 'settings-archive',
      value: 'true',
      updated_at: now,
      tab: 'enforcement',
      section: 'Rules',
      icon: 'archive',
      description: 'Every time you approve a new configuration, the previous version is saved automatically. You can always go back.',
      surface_when: 'User asks about version history or recovering old settings',
      wiki_slug: 'enforcement',
      sort_order: 2,
    },
    {
      key: 'session-limit',
      value: '20',
      updated_at: now,
      tab: 'enforcement',
      section: 'Limits',
      icon: 'memory',
      description: 'The maximum number of AI conversations that can run at the same time. Higher means more parallel work, but uses more memory.',
      surface_when: 'User hits the session limit or asks about parallel conversation capacity',
      wiki_slug: 'enforcement',
      sort_order: 3,
    },
    {
      key: 'idle-timeout',
      value: '9m',
      updated_at: now,
      tab: 'enforcement',
      section: 'Limits',
      icon: 'timer',
      description: 'How long an inactive conversation stays open before Open Robin pauses it. The conversation can be resumed anytime.',
      surface_when: 'User notices a conversation was paused or asks about timeout behavior',
      wiki_slug: 'enforcement',
      sort_order: 4,
    },
    {
      key: 'event-log',
      value: 'true',
      updated_at: now,
      tab: 'enforcement',
      section: 'Logging',
      icon: 'event_log',
      description: 'Records everything that happens in the system — file changes, agent actions, trigger fires. Useful for understanding what happened and when.',
      surface_when: 'User asks what happened or wants to audit agent behavior',
      wiki_slug: 'enforcement',
      sort_order: 5,
    },
    {
      key: 'notifications',
      value: 'true',
      updated_at: now,
      tab: 'enforcement',
      section: 'Logging',
      icon: 'notifications',
      description: 'Shows brief pop-up messages when something completes — an agent finishes a task, a scheduled job runs, or a trigger fires.',
      surface_when: 'User asks about notifications or wants to enable/disable them',
      wiki_slug: 'enforcement',
      sort_order: 6,
    },
  ]);
};

exports.down = async function (knex) {
  // Remove seed data
  await knex('system_config').whereIn('key', [
    'settings-write-lock', 'deploy-modals', 'settings-archive',
    'session-limit', 'idle-timeout', 'event-log', 'notifications',
  ]).del();
  await knex('cli_registry').del();
  await knex('system_wiki').whereNotNull('tab').del();
  await knex('system_tabs').del();

  // Drop new tables
  await knex.schema.dropTableIfExists('cli_registry');
  await knex.schema.dropTableIfExists('system_tabs');

  // Note: SQLite doesn't support DROP COLUMN, so we can't cleanly remove
  // added columns. The down migration removes data but leaves columns.
};

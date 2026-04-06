/**
 * Migration 004 — Update all system wiki pages
 *
 * All six pages: slim user-facing content (the user has Robin to help),
 * dense structured context for Robin's retrieval.
 */

exports.up = async function (knex) {
  // --- CLIs ---

  await knex('system_wiki')
    .where('slug', 'clis')
    .update({
      content: `## What is a CLI?

A CLI is an AI assistant that runs on your machine. It's the engine behind your conversations and agent tasks. Open Robin connects to it and displays the results.

## Can I switch between CLIs?

Yes. You can have multiple CLIs installed and switch between them anytime. Your project, conversations, and settings stay the same regardless of which CLI is active.

## Will it cost me money?

Open Robin is free. The AI work is handled by your CLI, and how you pay for that depends on the provider you choose. Most offer metered plans with monthly token allocations. Some have free tiers. You can also bring your own API keys — see the LLM Providers tab.`,

      context: 'CLI = command-line AI assistant binary installed locally. Open Robin reads the CLI wire protocol (RPC) and renders output in a visual interface. The CLI handles all AI inference — Open Robin is a harness/display layer, not an AI itself.\n\nAVAILABLE CLIs: kimi, claude, qwen, codex, gemini, opencode. User must have at least one installed. Active CLI set per-system in robin.db. Multiple can be installed simultaneously.\n\nSWITCHING: Changing the active CLI does not affect project state, chat history, triggers, or settings. Some users use different CLIs for different tasks (e.g., one for coding, another for research).\n\nCOST MODEL: Open Robin is free, charges nothing. Token costs go to the CLI provider. Two payment modes: (1) CLI sign-in = metered plan from the provider, often cheaper than raw API pricing. (2) BYO API key = user provides their own key via LLM Providers tab or Secrets tab. Free tiers exist — Qwen and Gemini both offer generous daily limits.\n\nNO LOCK-IN: Any CLI, any API key, any provider. The user is never locked into one provider. This is a core design principle.\n\nGOTCHAS: CLIs update frequently. When user asks about a specific CLI\'s features, pricing, or capabilities, RESEARCH via that CLI\'s docs_url and pricing_url rather than answering from memory. Do not guess at features or pricing — these change. Each CLI entry in the registry has docs_url and pricing_url fields for this purpose.\n\nRELATIONSHIP TO OTHER TABS: LLM Providers tab lets users add API keys and pick models — this is the BYO key path. Those keys are stored in the Secrets manager. The Connectors tab has nothing to do with CLIs.',

      description: 'AI assistants that power conversations and agent tasks',

      surface_when: 'User asks what a CLI is, how to switch CLIs, what CLIs are available, cost of using Open Robin, or how the AI engine works',

      updated_at: Date.now(),
    });

  // --- Secrets ---

  await knex('system_wiki')
    .where('slug', 'secrets')
    .update({
      content: `## What is the secrets manager?

The secrets manager stores passwords, tokens, and keys your AI needs to connect to outside services on your behalf. Everything is encrypted and stored locally on your machine — nothing leaves your device.

## What's an API key?

A special password that lets software connect to a service like GitHub or Stripe without logging in through a website. You don't need to build anything — just find the key in that service's settings and paste it here.

## Is my data safe?

Yes. Secrets are encrypted in the database. The encryption key comes from your system keychain, so even if someone copied the database file, they couldn't read your secrets. Your AI can see the names of your secrets but never the actual values.

## What about LLM provider keys?

The LLM Providers tab has a guided setup for adding AI provider keys — dropdowns, model pickers, and a place to paste your key. Those keys are stored here in the same secrets manager. That tab is a shortcut for a common task; this tab shows you everything.`,

      context: 'Secrets = encrypted key-value store in robin.db. Holds API keys, access tokens, passwords. Encrypted at rest; decryption key derived from system keychain, never on disk. Fully local — no servers, no cloud sync, no telemetry.\n\nUSER KNOWLEDGE LEVEL: User may not know what an API key is or where to find one. Explain in plain language. An API key is a password that lets software talk to a service. Every service calls it something different — "API key," "access token," "personal access token," "secret key." The location varies too — usually under account settings, developer settings, or security settings. Services change their UIs frequently. When the user asks how to get a key for a specific service, RESEARCH it fresh via the service docs or website. Do not guess from memory.\n\nHOW SECRETS ARE USED: There are no built-in connectors to external services. All external access is ad-hoc through scripts. The flow: user stores a credential here → a script in the scripts folder reads it at runtime → script calls the external API → script returns the result → AI presents the output. The AI triggers the script but never sees the raw credential. Scripts are the bridge. The AI can also write these scripts for the user — they do not need to code anything themselves.\n\nOVERLAP WITH LLM PROVIDERS TAB: The LLM Providers tab uses this same secrets manager under the hood. It provides a guided UI — provider dropdown, model picker, key input field — but the keys land in the same encrypted store shown here. Robin should know both tabs look at the same data. If the user adds a key in LLM Providers, it appears here. If they add one here manually for an LLM provider, it works the same way.\n\nCOMMON USE CASES: GitLab/GitHub personal access tokens, Stripe API keys, Firebase service account credentials, LLM provider API keys (OpenAI, Anthropic, Google, etc.), any REST API that requires authentication.\n\nSECURITY BOUNDARY: AI sees secret names (to know what is available) but NEVER raw values. No tool, command, or workaround exposes values to the AI. Only scripts read them, only in memory, only for the duration of the call. Never written to temp files or environment variables.\n\nGOTCHAS: If user deletes a secret a script needs, the script fails with a clear error naming the missing secret. If user is unsure what secrets they need, Robin can check what scripts exist and what credentials they expect.',

      description: 'Encrypted credential store for API keys, tokens, and passwords',

      surface_when: 'User asks about secrets, API keys, tokens, credentials, connecting external services, encryption, data safety, or how to get a key for a specific service. Also surface when user is confused about the relationship between secrets and LLM providers.',

      updated_at: Date.now(),
    });

  // --- Connectors ---

  await knex('system_wiki')
    .where('slug', 'connectors')
    .update({
      content: `## What are connectors?

Connectors give your AI access to apps on your Mac — Mail, Calendar, Reminders, Notes, and more. They're built into Open Robin and ready to use once you turn them on.

## How do I turn one on?

Each connector has a toggle in the list on the left. Flip it on and your AI can start working with that app. Flip it off and access is revoked immediately. Nothing is enabled by default.

## Do I need to set up my accounts first?

Yes. Connectors work with whatever accounts you already have in your Apple apps. If you want your AI to read your Gmail, you need Gmail set up in Apple Mail first. Same for Calendar, Reminders, and the rest — add your accounts in the Apple app, then flip the connector on here.

## Is my data safe?

Everything runs on your machine. When your AI reads your calendar or drafts an email, it's talking directly to the app on your Mac — not to a server, not to the cloud. Open Robin has no servers. Your data never leaves your device.`,

      context: 'Connectors = built-in integrations with local Apple apps on macOS, baked into the Electron shell. These are tool calls available to the AI, gated by toggle switches. NOT scripts.\n\nARCHITECTURE: Each connector is a tool call that uses the macOS scripting bridge (osascript) under the hood. The app ships with connectors pre-built for Apple apps: Mail, Calendar, Reminders, Notes, and other macOS services. The user flips a toggle to grant access. All disabled by default.\n\nPASS-THROUGH MODEL: Connectors read from and write to the user\'s existing Apple apps. They do not manage accounts themselves. Open Robin sees whatever accounts the user has already configured in the Apple app. If the user wants their AI to access Gmail, the answer is: set up Gmail in Apple Mail first, then enable the Mail connector here. Same pattern for every connector — Calendar sees whatever calendars are in Apple Calendar, Reminders sees whatever lists are in Apple Reminders, etc.\n\nACCOUNT SETUP GUIDANCE: When a user says "I want to connect my Gmail" or "I want access to my work calendar," Robin should guide them to set up that account in the corresponding Apple app FIRST, then come back and flip the toggle. This is always the right path. Do not suggest OAuth scripts, API keys, or workarounds. RESEARCH current Apple app setup instructions for the specific service (Gmail in Apple Mail, Google Calendar in Apple Calendar, etc.) rather than guessing — Apple updates these flows.\n\nMULTIPLE ACCOUNTS: Users can have multiple accounts in a single Apple app (e.g., personal Gmail + work Exchange in Apple Mail). The connector sees all of them once enabled. The user manages which accounts are in the Apple app; the connector just reads what\'s there.\n\nGATING: Toggle on = AI has access. Toggle off = access revoked immediately. This is the user\'s control surface. Nothing enabled by default.\n\nNOT SCRIPTS: Connectors are distinct from the scripts folder. Connectors are built-in tool calls. Scripts are the ad-hoc fallback for services that don\'t have a built-in connector (GitLab, Stripe, Firebase, etc.). For those, the path is: API key in Secrets tab + script in scripts folder. But always prefer the built-in connector path when one exists.\n\nPRIVACY: Everything local. No servers, no cloud, no telemetry. The app talks directly to macOS apps via the scripting bridge. No data leaves the device.\n\nRELATIONSHIP TO OTHER TABS: Secrets tab is for ad-hoc script connections, not needed for built-in connectors. Enforcement tab may govern which connectors can be enabled.',

      description: 'Built-in Apple app integrations gated by toggle switches',

      surface_when: 'User asks about connecting to local apps, email, calendar, reminders, notes, Apple integrations, toggling access, setting up accounts, Gmail, Outlook, Exchange, or data privacy. Also when user asks about connecting non-Apple services (guide to scripts + secrets as fallback).',

      updated_at: Date.now(),
    });

  // --- Enforcement ---

  await knex('system_wiki')
    .where('slug', 'enforcement')
    .update({
      content: `## What are safety rules?

Safety rules control what your AI can and can't do. They're built into Open Robin and can only be changed by you from this panel. Your AI cannot modify, disable, or work around them.

## Can I change these rules?

Some rules have a toggle. The defaults are designed to prevent common mistakes — like an AI overwriting its own configuration. You can relax a rule if you want, but Open Robin will make sure you understand what you're changing first.

## What gets logged?

Open Robin can record what happens in the system — file changes, agent actions, trigger fires. You can turn logging and notifications on or off here.`,

      context: 'Enforcement = safety rules that constrain what the AI can do. The user is trusted; enforcement constrains the AI, not the human. This is the threat model.\n\nRULES SECTION: Settings write-lock prevents AI from modifying any configuration files — only the user can change settings by dragging files into the settings folder. Deploy modals show a visual approval screen when AI suggests new configuration — user drags to accept, closes to reject. Settings archive automatically saves previous config versions when user approves a change — rollback is always possible.\n\nLIMITS SECTION: Session limit caps concurrent AI conversations (default 20). Higher means more parallel work but more memory. Idle timeout pauses inactive conversations after a set period (default 9 minutes). Conversations can always be resumed.\n\nLOGGING SECTION: Event log records all system activity — file changes, agent actions, trigger fires. Notifications show brief pop-ups when things complete — agent finishes, scheduled job runs, trigger fires. Both can be toggled.\n\nENFORCEMENT MECHANICS: When the AI violates a rule, the system fires a tool_bounced event. The AI cannot: modify its own config, access secret values, change enforcement rules, write to settings/ folders (any case, dot-prefix variants). Override toggles exist but are clearly labeled as risky.\n\nGOTCHAS: If user asks why their AI was blocked from doing something, check which enforcement rule triggered. The tool_bounced event contains the reason. If user wants to override, explain the risk clearly — don\'t just flip it. If user asks about recovering old settings, point them to settings archive.\n\nRELATIONSHIP TO OTHER TABS: Secrets tab is protected by enforcement — AI cannot read secret values. Connectors tab may have enforcement rules about which connectors can be enabled. Settings write-lock applies across the entire system, not just this tab.',

      description: 'Safety rules, limits, and logging for AI behavior',

      surface_when: 'User asks about what their AI can or can\'t do, safety, permissions, why something was blocked, overriding rules, session limits, timeouts, logging, or notifications',

      updated_at: Date.now(),
    });

  // --- Customization ---

  await knex('system_wiki')
    .where('slug', 'customization')
    .update({
      content: `## How theming works

Pick an accent color and a brightness level. Everything else updates to match — buttons, borders, badges, backgrounds. One choice, whole interface.

## System theme vs workspace themes

The system theme is the default. It applies everywhere unless a workspace opts out. Each workspace can pick its own accent color. If it doesn't, it inherits the system theme and changes when the system changes.

## Can I customize further?

Yes. You can edit the CSS directly for full control over every visual variable. After editing, click Apply here to save your changes into the database so they're preserved across theme switches.`,

      context: 'Theme system: one accent color + one brightness preset = full visual identity. The cascade is System → Workspace → View. Each level only overrides what it declares.\n\nSTORAGE: System theme stored in SQLite (system_theme table, single row). Per-workspace overrides stored in workspace_themes table. Filesystem CSS at ai/views/settings/themes.css is a propagated copy, not the source of truth — SQLite is authoritative.\n\nCASCADE MODEL: System theme is the baseline. Every workspace inherits it unless the workspace has a custom theme set. Individual views within a workspace can also override with their own themes.css at ai/views/{viewer-name}/settings/themes.css. Each level only overrides the variables it declares — everything else flows down from the parent.\n\nTHREE WORKSPACE STATES: (1) Inheriting — matches the system theme, changes when system changes. (2) Custom — has its own accent color in workspace_themes table, independent of system. (3) Diverged — user hand-edited the CSS file, matches neither system nor stored custom theme. The Apply button absorbs diverged CSS back into SQLite. Toggle preserves custom CSS in SQLite even when set back to inherit.\n\nCOLOR PICKER: Eight curated accent colors plus custom hex input. System auto-generates all variations (hover states, active fills, borders) from the single choice. Presets: Light, Medium, Dark, OLED Black — these control all background and text values.\n\nPER-VIEW OVERRIDES: Drop a themes.css into ai/views/{viewer-name}/settings/themes.css. Only include the variables you want to change. Remove the file to go back to inheriting from workspace.\n\nSYSTEM PANEL EXCEPTION: The Robin system panel always uses the system theme. It never inherits workspace colors. This keeps the control room visually stable.\n\nGOTCHAS: If user edits CSS by hand and then switches themes in the picker, their hand edits could be lost unless they click Apply first. If a workspace looks different from the system and the user didn\'t set it, check if it has a custom theme or diverged CSS. If user asks "why does this workspace look different," check workspace_themes table.',

      description: 'Theme system with system, workspace, and view-level color cascading',

      surface_when: 'User asks about colors, themes, dark mode, accent colors, customization, visual appearance, why a workspace looks different, or CSS editing',

      updated_at: Date.now(),
    });

  // --- LLM Providers ---

  await knex('system_wiki')
    .where('slug', 'llm-providers')
    .update({
      content: `## What are LLM providers?

LLM providers are companies that offer AI models — like Anthropic, OpenAI, or Google. This tab is optional. If you're already signed into a CLI and happy with how it works, you don't need to change anything here.

## Why would I add one?

More control. You can bring your own API key from a provider, choose specific models, and configure different setups for different kinds of work.

## Are my keys safe?

Yes. Provider keys are stored in the encrypted secrets manager. You can view and manage them here or in the Secrets tab — both look at the same store. Your AI never sees the key values.`,

      context: 'LLM providers = companies offering AI models (Anthropic, OpenAI, Google, Qwen, Mistral, etc.). This tab is entirely optional — CLI sign-in works without it.\n\nTWO AUTH MODES: (1) CLI sign-in = metered plan from the provider, simplest setup, sign in and go. (2) BYO API key = user gets a key from a provider and enters it here for more control over billing and model selection. User can switch between the two anytime. CLI sign-in stays active even after adding a provider key.\n\nGUIDED UI: This tab provides a friendlier interface than the raw Secrets tab. Pre-configured list of known providers with correct endpoints. Some providers have separate coding-specific vs general pay-as-you-go endpoints — both options shown. Model dropdown populated via the provider\'s API so it stays current. Keys masked once saved.\n\nOVERLAP WITH SECRETS TAB: Keys entered here are stored in the same encrypted secrets manager shown in the Secrets tab. Both tabs look at the same data. If user adds a provider key here, it appears in Secrets. If user stores a provider key manually in Secrets, it works the same way. This tab is a guided shortcut.\n\nGOTCHAS: When user asks about a specific provider\'s pricing, models, or capabilities, RESEARCH via that provider\'s website rather than answering from memory. Provider offerings change frequently — models get added, pricing tiers shift, endpoints change. Each provider in the registry has docs_url and pricing_url fields — use these. If user asks "which provider is cheapest" or "which model is best," do not guess. Research current pricing and capabilities.\n\nACCOUNT SETUP: If user says "I want to use Claude" or "how do I add OpenAI," Robin should guide them: (1) sign up at the provider\'s website, (2) find the API keys section in their account settings, (3) generate a key, (4) paste it here. RESEARCH the specific provider\'s current key generation flow rather than guessing — these change.\n\nRELATIONSHIP TO OTHER TABS: CLIs tab is where the user picks which AI assistant to use — the CLI may already include a sign-in that handles billing. This tab adds a second option on top of that. Secrets tab shows the raw encrypted store where these keys live.',

      description: 'Optional API key management for AI model providers',

      surface_when: 'User asks about API keys for AI providers, adding models, switching providers, provider pricing, or configuring alternative AI models. Also surface when user asks about the difference between CLI sign-in and BYO API keys.',

      updated_at: Date.now(),
    });
};

exports.down = async function (knex) {
  // Restore original CLIs content from migration 002
  await knex('system_wiki')
    .where('slug', 'clis')
    .update({
      content: '## What is a CLI?\n\nA CLI (command-line interface) is an AI assistant that runs on your machine. It\'s the engine that powers your conversations and agent tasks. Open Robin doesn\'t process AI requests itself — it connects to a CLI and displays the results.\n\nThink of Open Robin as the dashboard and the CLI as the engine under the hood. You can swap engines anytime.\n\n## Why does Open Robin use a CLI?\n\nOpen Robin is a harness, not an AI. It reads what your CLI sends back and displays it in a visual interface you can manage. This means you\'re never locked into one provider — you can switch CLIs, use different ones for different tasks, or try a new one without changing anything about your project.\n\nYour CLI handles the AI work. Open Robin handles everything else: organizing conversations, managing files, running triggers, and keeping your project in order.\n\n## Can I switch between CLIs?\n\nYes. You can have multiple CLIs installed and switch between them. Each CLI has its own configuration, but your project, conversations, and settings stay the same regardless of which CLI is active.\n\nSome people use one CLI for everyday coding and another for research or analysis. Open Robin makes it easy to swap — just change the active CLI in this panel.\n\n## Will using a CLI cost me money?\n\nOpen Robin is completely free. It will never charge you anything.\n\nThe AI work itself — the conversations, the code generation, the analysis — that\'s handled by whichever CLI you choose. How you pay for that is entirely up to you. Most CLI providers offer metered plans where you sign in and get a monthly token allocation, often at rates significantly lower than raw API pricing. Some, like Qwen and Gemini, even have generous free tiers.\n\nYou can also bring your own API keys from any provider and configure your CLI to use them directly. Either way, you\'re buying tokens from the AI provider of your choice — not from us. Open Robin simply sits in the middle and tells you what\'s happening.',
      context: 'CLI = command-line AI assistant binary installed locally. Open Robin reads the wire protocol (RPC) and renders output. The CLI handles all AI inference. Examples: kimi, claude, qwen, codex, gemini, opencode. User must have at least one installed. Open Robin is a harness/display layer — no lock-in, any CLI, any API key, any provider. Multiple CLIs can be installed simultaneously. Active CLI set per-system in robin.db. Switching CLIs does not affect project state, chat history, triggers, or settings. Open Robin is free, charges nothing. Token costs go to the CLI provider. Metered CLI plans are often cheaper than raw API pricing. Free tiers: Qwen ~2000 req/day, Gemini ~1000 req/day. BYO API keys also supported.',
      description: 'What CLIs are, why Open Robin uses them, switching, and cost',
      surface_when: 'User is new to the system, asks what a CLI is, questions the architecture, wants to switch CLIs, or asks about cost',
      updated_at: Date.now(),
    });

  // Restore original secrets content from migration 002
  await knex('system_wiki')
    .where('slug', 'secrets')
    .update({
      content: '## What is the secrets manager?\n\nThe secrets manager stores sensitive information like API keys, access tokens, and passwords. Everything is encrypted and stored locally on your machine in Open Robin\'s database. Secrets are used by connectors and CLI configurations behind the scenes.\n\nYou can add, update, or remove secrets anytime from this panel.\n\n## Can AI agents see my secrets?\n\nNo. This is a hard rule. AI agents never have access to your secrets, API keys, or tokens. The enforcement system prevents it. When a connector needs a token to sync with GitLab, Open Robin\'s server process uses it directly — the AI never sees it.\n\nThis is by design, not configuration. You can\'t accidentally expose secrets to an agent.',
      context: 'Secrets = encrypted key-value store in robin.db. Holds: API keys, access tokens, passwords. Used by connectors and CLI configs. Never exposed to AI agents — enforcement rule. Only Open Robin server process reads them for connector/CLI auth. Stored locally, never synced. Hard enforcement: AI agents NEVER get secret access. This is a security boundary, not a preference.',
      description: 'How secrets are stored and AI access rules',
      surface_when: 'User asks about secret storage, encryption, credentials, or AI access to secrets',
      updated_at: Date.now(),
    });

  // Restore original connectors content from migration 002
  await knex('system_wiki')
    .where('slug', 'connectors')
    .update({
      content: '## What are connectors?\n\nConnectors let Open Robin talk to external services you already use — like GitLab, GitHub, or Jira. When a connector is active, Open Robin can pull in issues, sync ticket status, and keep your external tools up to date with what\'s happening in your project.\n\nConnectors run on your machine and use your credentials. Nothing is sent to Open Robin\'s servers because there aren\'t any.\n\n## Is my data shared externally?\n\nNo. Connectors run entirely on your machine. When Open Robin syncs with GitLab, for example, it\'s your machine talking directly to GitLab using your credentials. Open Robin has no servers, no cloud, no telemetry. Your data stays between your machine and the services you choose to connect.',
      context: 'Connectors = integrations with external services (GitLab, GitHub, Jira, etc.). Run locally, use user credentials stored in secrets manager. Sync is bidirectional where supported. No Open Robin servers involved — everything local. Zero data sharing. No telemetry, no cloud sync, no analytics. Fully local architecture.',
      description: 'What connectors are and data privacy',
      surface_when: 'User asks about integrations, external services, or data privacy',
      updated_at: Date.now(),
    });

  // Restore original enforcement content from migration 002
  await knex('system_wiki')
    .where('slug', 'enforcement')
    .update({
      content: '## What are safety rules?\n\nSafety rules control what AI agents can and can\'t do on your machine. They\'re hardcoded into Open Robin — agents can\'t change them, disable them, or work around them. Only you can adjust enforcement settings from this panel.\n\nThe defaults are designed to keep you in control: agents can\'t modify their own configuration, can\'t access your secrets, and need your approval for certain actions.\n\n## Can I override these rules?\n\nSome rules have an override toggle, but they\'re labeled clearly — and for good reason. The default rules exist to prevent common mistakes, like an AI accidentally overwriting its own configuration or exposing your credentials.\n\nYou\'re always in charge. If you know what you\'re doing and want to relax a rule, you can. But Open Robin will make sure you understand what you\'re changing before you do it.',
      context: 'Enforcement = hardcoded safety rules. Not configurable by AI. Write-locked: settings/ folders (any case, dot-prefix variants). AI cannot: modify own config, access secrets, change enforcement rules, write to settings/ folders. Override toggle exists but labeled "this is a bad idea." Enforcement fires tool_bounced event on violation. User is trusted — enforcement constrains AI, not the human. Threat model: AI is the untrusted actor.',
      description: 'Safety rules and override options',
      surface_when: 'User asks about what agents can do, safety, permissions, or overriding rules',
      updated_at: Date.now(),
    });

  // Restore original customization content from migration 003
  await knex('system_wiki')
    .where('slug', 'customization')
    .update({
      content: '## How theming works\n\nOpen Robin uses a simple approach: pick one accent color and one brightness level, and the entire interface updates to match. Every button, border, badge, and background derives from these two choices.\n\n## System theme vs workspace themes\n\nThe system theme is the baseline. It applies to the Robin system panel itself and to every workspace that hasn\'t been customized. Think of it as the default look.\n\nEach workspace can optionally override the system theme with its own accent color. When a workspace inherits the system theme, changing the system color changes that workspace too. When a workspace has a custom theme, it keeps its own color regardless of system changes.\n\n## The color picker\n\nChoose from eight curated accent colors, or type in any hex value. The system automatically generates all the subtle variations — hover states, active fills, borders — from your single choice.\n\n## Editing CSS by hand\n\nFor advanced customization beyond the color picker, you can edit the CSS file directly:\n\n`ai/views/settings/themes.css`\n\nThis gives you full control over every visual variable. After editing, come back to this panel and click Apply to save your changes. This ensures your edits are preserved in the system database and won\'t be lost if you switch themes later.\n\n## What you can change\n\n- **Accent color** — the primary highlight used for active states, links, and interactive elements\n- **Theme preset** — Light, Medium, Dark, or OLED Black (controls all background and text values)\n- **Per-workspace overrides** — give each workspace its own accent color while keeping the same brightness level\n\n## Per-view overrides\n\nIndividual views within a workspace can have their own accent color too. Each view folder has three siblings — `chat/`, `content/`, and `settings/`. Drop a `themes.css` file into the view\'s settings folder:\n\n`ai/views/{viewer-name}/settings/themes.css`\n\nThis overrides the workspace theme for just that view. You only need to include the variables you want to change — everything else flows down from the workspace, which flows down from the system.\n\nThe full cascade is: **System → Workspace → View**. Each level only overrides what it declares. Remove the file to go back to inheriting.\n\n## What stays consistent\n\nThe Robin system panel always uses the system theme. It never inherits workspace colors. This keeps the "control room" visually stable regardless of which workspace you\'re in.',
      context: 'Theme system: one accent color + one brightness preset = full visual identity. System theme stored in SQLite (system_theme table). Per-workspace overrides stored in workspace_themes table. Filesystem CSS at ai/views/settings/themes.css is a propagated copy, not source of truth. Three states per workspace: inheriting (matches system), custom (matches workspace_themes), diverged (hand-edited, matches neither). Apply button absorbs hand-edited CSS back into SQLite. Toggle preserves custom CSS in SQLite even when set to inherit.',
      description: 'Theme system, color picker, workspace overrides, and hand-editing CSS',
      surface_when: 'User asks about colors, themes, dark mode, customization, or visual appearance',
      updated_at: Date.now(),
    });

  // Restore original LLM providers content from migration 002
  await knex('system_wiki')
    .where('slug', 'llm-providers')
    .update({
      content: '## What is an LLM provider?\n\nAn LLM provider is a company that offers AI models — like Anthropic, OpenAI, or Google. If you\'re already signed into a CLI and happy with how things work, you don\'t need to change anything here. This section is entirely optional.\n\nWhat it gives you is more control. You can add your own API keys from different providers, choose specific models, and create different configurations for different kinds of work. Think of it as extra customization on top of your CLI.\n\n## CLI sign-in vs provider API keys\n\nWhen you sign into a CLI like Claude Code or Codex, you\'re using that provider\'s metered plan. It\'s the simplest setup — sign in and go.\n\nAdding a provider here gives you a second option. You can bring your own API key from any provider and configure your CLI to use it instead. Some people prefer this for more control over billing, or because they want access to specific models that aren\'t available through the CLI\'s default sign-in.\n\nYou can switch between the two anytime. Your CLI sign-in stays active — adding a provider key just gives you another way to connect.\n\n## How do I add a provider?\n\nClick **Add Provider** in the list on the left. Open Robin comes with a list of known providers, and each one is pre-configured with the right endpoints. Some providers offer separate endpoints for coding-specific keys versus general pay-as-you-go keys — you\'ll see both options and can select which one to use.\n\nEnter your API key, save it, and it\'s stored securely. Once saved, you\'ll see it masked in the list. From there, you can pick which models from that provider you want available — Open Robin pulls the model list directly from the provider, so it\'s always up to date.\n\n## Will my API keys be safe?\n\nYes. Provider keys are stored in the same encrypted secrets manager that holds all your other credentials. You can view and manage them here or in the Secrets tab — both are looking at the same thing. AI agents never have access to your keys, and they never leave your machine.',
      context: 'LLM providers = companies offering AI models (Anthropic, OpenAI, Google, etc.). This tab is optional — CLI sign-in works without it. Two auth modes: (1) CLI sign-in = metered plan, simplest. (2) BYO API key from provider = more control, specific models, billing flexibility. Provider keys stored in same encrypted secrets manager as all other credentials. Pre-configured known providers with correct endpoints. Some providers have separate coding vs general endpoints — both available with radio selection. Model dropdown populated via provider API. Keys masked when saved. AI agents never access keys.',
      description: 'What LLM providers are, adding keys, choosing models, and key security',
      surface_when: 'User asks about API keys, providers, adding models, or configuring alternative inference sources',
      updated_at: Date.now(),
    });
};

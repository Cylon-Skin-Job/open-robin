/**
 * Trigger Loader — scans agent folders for TRIGGERS.md files,
 * parses them, and produces watcher filters + cron registrations.
 *
 * Runs alongside the existing lib/watcher/filters/*.md system.
 * TRIGGERS.md adds agent-specific triggers loaded from agent folders.
 */

const fs = require('fs');
const path = require('path');
const { parseTriggerBlocks } = require('./trigger-parser');
const { runScript } = require('./script-runner');
const { buildFilter, evaluateCondition, applyTemplate } = require('../watcher/filter-loader');
const { on } = require('../event-bus');

/**
 * Register an event bus listener for a TRIGGERS.md block.
 * The listener evaluates conditions and executes the configured action.
 *
 * @sideeffect Registers a persistent listener on the event bus singleton.
 */
function registerBusListener(eventType, block, assignee, actionHandlers) {
  on(eventType, (event) => {
    // Workspace filter: skip events from other workspaces
    if (block.workspace && event.workspace !== block.workspace) return;

    // Condition check
    if (block.condition && !evaluateCondition(block.condition, event)) return;

    // Build template vars from event data
    const vars = {
      ...event,
      assignee,
      filePath: event.filePath || '',
      basename: event.basename || '',
    };

    // Execute action
    const action = block.action || 'create-ticket';
    const handler = actionHandlers[action];
    if (handler) {
      const message = normalizeMessage(block.message);
      const def = {
        name: block.name || 'unnamed-trigger',
        action,
        prompt: block.prompt || null,
        message: block.message,
        target: block.target,
        url: block.url,
        body: block.body,
        path: block.path,
        content: block.content,
        role: block.role,
        _autoHold: true,
        ticket: {
          assignee,
          title: message ? message.split('\n')[0].trim() : `Trigger: ${block.name}`,
          body: message || `Event trigger fired: ${block.name}`,
        },
      };
      handler(def, vars);
    } else {
      console.warn(`[TriggerLoader] Unknown action: ${action}`);
    }
  });

  console.log(`[TriggerLoader] Bus listener: ${block.name} on ${eventType} → ${assignee}`);
}

/**
 * Recursively find all TRIGGERS.md files under a directory.
 *
 * @param {string} dir - Directory to scan
 * @returns {string[]} Absolute paths to TRIGGERS.md files
 */
function findTriggersFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTriggersFiles(fullPath));
    } else if (entry.name === 'TRIGGERS.md') {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Derive an assignee name from a TRIGGERS.md file path.
 * Uses the nearest meaningful parent folder name, or 'system'.
 *
 * @param {string} triggersPath - Absolute path to a TRIGGERS.md file
 * @param {string} projectRoot - Absolute path to project root
 * @returns {string} Assignee name
 */
function deriveAssignee(triggersPath, projectRoot) {
  const rel = path.relative(projectRoot, path.dirname(triggersPath));
  const segments = rel.split(path.sep).filter(Boolean);
  // Use the last meaningful segment as the assignee
  return segments[segments.length - 1] || 'system';
}

/**
 * Scan agent folders for TRIGGERS.md and build filters + cron triggers.
 * Also scans ai/views/ and ai/components/ recursively for additional TRIGGERS.md files.
 *
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} agentsBasePath - Absolute path to agents panel
 * @param {Object} registry - Parsed registry.json { agents: { botName: { folder } } }
 * @param {Object} actionHandlers - Action handlers from createActionHandlers()
 * @returns {{ filters: Array, cronTriggers: Array<{ trigger: Object, assignee: string }> }}
 * @sideeffect Registers event bus listeners for chat/ticket/agent/system triggers.
 */
function loadTriggers(projectRoot, agentsBasePath, registry, actionHandlers) {
  const filters = [];
  const cronTriggers = [];
  const processedPaths = new Set();

  // --- Pass 1: Agent TRIGGERS.md files (with known assignees from registry) ---

  for (const [botName, agent] of Object.entries(registry.agents || {})) {
    const agentPath = path.join(agentsBasePath, agent.folder);

    // Scan agent root and all subfolders (workflows, etc.)
    const agentTriggerFiles = findTriggersFiles(agentPath);
    for (const triggersPath of agentTriggerFiles) {
      processedPaths.add(triggersPath);
      const blocks = parseTriggerBlocks(triggersPath);
      const rel = path.relative(agentPath, triggersPath);
      console.log(`[TriggerLoader] ${botName}${rel !== 'TRIGGERS.md' ? '/' + path.dirname(rel) : ''}: parsed ${blocks.length} triggers`);

      for (const block of blocks) {
        processBlock(block, botName, projectRoot, actionHandlers, filters, cronTriggers);
      }
    }
  }

  // --- Pass 2: Recursive scan of ai/views/ and ai/components/ ---

  const scanDirs = [
    path.join(projectRoot, 'ai', 'views'),
    path.join(projectRoot, 'ai', 'components'),
  ];

  for (const scanDir of scanDirs) {
    const triggerFiles = findTriggersFiles(scanDir);
    for (const triggersPath of triggerFiles) {
      if (processedPaths.has(triggersPath)) continue;
      processedPaths.add(triggersPath);

      const assignee = deriveAssignee(triggersPath, projectRoot);
      const blocks = parseTriggerBlocks(triggersPath);
      const rel = path.relative(projectRoot, triggersPath);
      console.log(`[TriggerLoader] ${rel}: parsed ${blocks.length} triggers (assignee: ${assignee})`);

      for (const block of blocks) {
        processBlock(block, assignee, projectRoot, actionHandlers, filters, cronTriggers);
      }
    }
  }

  return { filters, cronTriggers };
}

/**
 * Process a single trigger block — categorize and register.
 */
function processBlock(block, assignee, projectRoot, actionHandlers, filters, cronTriggers) {
  if (block.type === 'cron') {
    cronTriggers.push({ trigger: block, assignee });
  } else if (['chat', 'ticket', 'agent', 'system'].includes(block.type)) {
    if (!block.event) {
      console.warn(`[TriggerLoader] ${block.name || 'unnamed'}: type "${block.type}" requires an "event" field, skipping`);
      return;
    }
    registerBusListener(`${block.type}:${block.event}`, block, assignee, actionHandlers);
  } else {
    const filter = buildTriggerFilter(block, assignee, projectRoot, actionHandlers);
    if (filter) filters.push(filter);
  }
}

/**
 * Normalize the message field from a trigger block.
 * The YAML parser may return a string or an object (when | multiline is used).
 * If object, reconstruct as "key: value" lines.
 */
function normalizeMessage(msg) {
  if (!msg) return null;
  if (typeof msg === 'string') return msg;
  if (typeof msg === 'object') {
    return Object.entries(msg).map(([k, v]) => `${k}: ${v}`).join('\n');
  }
  return String(msg);
}

/**
 * Convert a file-change trigger block into a watcher filter.
 * Injects the prompt field and assignee into ticket creation.
 */
function buildTriggerFilter(block, assignee, projectRoot, actionHandlers) {
  const message = normalizeMessage(block.message);

  // Build a filter definition compatible with buildFilter()
  const action = block.action || 'create-ticket';
  const def = {
    name: block.name || 'unnamed-trigger',
    events: block.events || ['modify', 'create', 'delete'],
    match: block.match,
    exclude: block.exclude,
    condition: block.condition,
    action,
    prompt: block.prompt || null,
    script: block.script || null,
    function: block.function || null,
    modal: block.modal || null,
    _autoHold: action === 'create-ticket',
    ticket: {
      assignee,
      title: message
        ? message.split('\n')[0].trim()
        : `Trigger: ${block.name}`,
      body: message || `Trigger fired: ${block.name}`,
    },
  };

  // Wrap the action handlers to support script execution
  if (def.script) {
    const wrappedHandlers = wrapWithScript(def, actionHandlers, projectRoot);
    const filter = buildFilter(def, wrappedHandlers);
    console.log(`[TriggerLoader] Built filter: ${def.name} (with script: ${def.script})`);
    return filter;
  }

  const filter = buildFilter(def, actionHandlers);
  console.log(`[TriggerLoader] Built filter: ${def.name} → ${assignee}`);
  return filter;
}

/**
 * Wrap action handlers to run a script before the action executes.
 * The script's return value is merged into template variables as `result`.
 */
function wrapWithScript(def, originalHandlers, projectRoot) {
  const wrapped = { ...originalHandlers };

  const originalCreateTicket = wrapped['create-ticket'];
  if (originalCreateTicket) {
    wrapped['create-ticket'] = function(filterDef, vars) {
      // Run the script and merge result into vars
      const result = runScript(def.script, def.function, vars, projectRoot);
      if (result !== null) {
        vars.result = result;
      }

      // Re-evaluate condition with script result if needed
      if (def.condition && def.condition.includes('result.')) {
        if (!evaluateCondition(def.condition, vars)) {
          console.log(`[TriggerLoader] ${def.name}: script condition not met, skipping`);
          return;
        }
      }

      // Re-apply templates with script result
      if (vars.result) {
        filterDef = { ...filterDef };
        if (filterDef.ticket) {
          filterDef.ticket = { ...filterDef.ticket };
          filterDef.ticket.title = applyTemplate(filterDef.ticket.title, vars);
          filterDef.ticket.body = applyTemplate(filterDef.ticket.body, vars);
        }
      }

      originalCreateTicket(filterDef, vars);
    };
  }

  return wrapped;
}

module.exports = { loadTriggers };

/**
 * Built-in action handlers for declarative filters.
 *
 * Each action is a function: (filterDef, vars) => void
 * where vars contains the template variables from the event context.
 */

const fs = require('fs');
const path = require('path');
const { applyTemplate } = require('./filter-loader');

/**
 * Create the default action handlers.
 *
 * @param {Object} deps - Dependencies injected at setup time
 * @param {Function} deps.createTicket - ({ title, assignee, body }) => void
 * @returns {Object} Map of action name → handler function
 */
function createActionHandlers(deps = {}) {
  return {
    /**
     * Create a ticket from the filter's ticket template.
     */
    'create-ticket'(def, vars) {
      if (!deps.createTicket) {
        console.error(`[Action:create-ticket] No createTicket function provided`);
        return;
      }

      const ticketDef = def.ticket || {};
      const title = applyTemplate(ticketDef.title || `${vars.event}: ${vars.basename}`, vars);
      const assignee = ticketDef.assignee || 'unassigned';
      const body = applyTemplate(ticketDef.body || `File \`${vars.filePath}\` was ${vars.event}d.`, vars);

      const ticket = { title, assignee, body };
      if (def.prompt) ticket.prompt = def.prompt;
      if (def.name) ticket.triggerName = def.name;
      if (def._autoHold) ticket.autoHold = true;

      deps.createTicket(ticket);
      console.log(`[Action:create-ticket] ${title}`);
    },

    /**
     * Log the event (no side effects).
     */
    'log'(def, vars) {
      const message = def.message
        ? applyTemplate(def.message, vars)
        : vars.parentStats
          ? `[${vars.event}] ${vars.filePath} (${vars.parentStats.files} files in ${vars.parentDir})`
          : `[${vars.type || vars.event || 'event'}] ${JSON.stringify(vars).slice(0, 200)}`;
      console.log(`[Action:log:${def.name}] ${message}`);
    },

    /**
     * Notify via WebSocket (future: wire up to server broadcast).
     * For now, logs a structured event that the server can pick up.
     */
    'notify'(def, vars) {
      const payload = {
        type: 'file_changed',
        filter: def.name,
        event: vars.event,
        filePath: vars.filePath,
        parentDir: vars.parentDir,
      };
      if (deps.broadcastFileChange) {
        deps.broadcastFileChange(payload);
      }
      console.log(`[Action:notify] ${vars.event}: ${vars.filePath}`);
    },

    /**
     * Send a system message to an active chat session via WebSocket.
     * Phase 2: active sessions only. Session spawning comes in Phase 4.
     */
    'send-message'(def, vars) {
      const target = def.target || vars.workspace;
      const message = applyTemplate(def.message || '', vars);
      const role = def.role || 'system';

      if (!deps.sendChatMessage) {
        console.warn(`[Action:send-message] No sendChatMessage function provided`);
        return;
      }

      deps.sendChatMessage(target, message, role);
      console.log(`[Action:send-message] → ${target}: ${message.slice(0, 80)}`);
    },

    /**
     * HTTP POST to an external URL. Fire-and-forget.
     */
    'webhook-post'(def, vars) {
      const url = applyTemplate(def.url || '', vars);
      const body = def.body ? applyTemplate(def.body, vars) : JSON.stringify(vars);

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).then(res => {
        console.log(`[Action:webhook-post] ${url} → ${res.status}`);
      }).catch(err => {
        console.error(`[Action:webhook-post] ${url} failed: ${err.message}`);
      });
    },

    /**
     * Show a modal overlay on connected clients.
     * Modal type is loaded from ai/components/modals/{type}/.
     * The trigger's modal block provides data (source, target, title, message).
     */
    'show-modal'(def, vars) {
      if (!def.modal || !def.modal.type) {
        console.warn(`[Action:show-modal] No modal.type specified, skipping`);
        return;
      }

      if (!deps.getModalDefinition) {
        console.warn(`[Action:show-modal] No getModalDefinition function provided`);
        return;
      }

      if (!deps.broadcastModal) {
        console.warn(`[Action:show-modal] No broadcastModal function provided`);
        return;
      }

      const modalType = applyTemplate(def.modal.type, vars);
      const definition = deps.getModalDefinition(modalType);
      if (!definition) {
        console.warn(`[Action:show-modal] Unknown modal type: ${modalType}`);
        return;
      }

      // Read source file content for client preview (if source specified)
      let sourceContent = null;
      const sourcePath = def.modal.source ? applyTemplate(def.modal.source, vars) : null;
      if (sourcePath && deps.projectRoot) {
        const fullSourcePath = path.resolve(deps.projectRoot, sourcePath);
        try {
          sourceContent = fs.readFileSync(fullSourcePath, 'utf8');
        } catch (err) {
          console.warn(`[Action:show-modal] Could not read source file: ${err.message}`);
        }
      }

      const modalData = {
        source: sourcePath,
        target: def.modal.target ? applyTemplate(def.modal.target, vars) : null,
        title: def.modal.title ? applyTemplate(def.modal.title, vars) : `Modal: ${modalType}`,
        message: def.modal.message ? applyTemplate(def.modal.message, vars) : '',
        sourceContent,
      };

      deps.broadcastModal({
        modalType,
        config: definition.config,
        styles: definition.styles,
        data: modalData,
      });

      console.log(`[Action:show-modal] ${modalType}: ${modalData.title}`);
    },

    /**
     * Write template-expanded content to a file path.
     * Path must be within the project root.
     */
    'drop-file'(def, vars) {
      const filePath = applyTemplate(def.path || '', vars);
      const content = applyTemplate(def.content || '', vars);
      const projectRoot = deps.projectRoot;

      if (!filePath) {
        console.warn(`[Action:drop-file] No path specified, skipping`);
        return;
      }

      if (projectRoot && !path.resolve(filePath).startsWith(path.resolve(projectRoot))) {
        console.warn(`[Action:drop-file] Path outside project root, skipping: ${filePath}`);
        return;
      }

      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`[Action:drop-file] ${filePath}`);
    },
  };
}

module.exports = { createActionHandlers };

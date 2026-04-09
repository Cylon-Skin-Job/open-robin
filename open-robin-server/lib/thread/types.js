/**
 * Thread Management Types
 * 
 * Based on SPEC.md - Thread Management Specification
 * @see ../../../ai/views/capture-viewer/specs/SPEC.md
 */

/**
 * @typedef {Object} ThreadEntry
 * @property {string} name - Human-readable display name (e.g., "New Chat")
 * @property {string} createdAt - ISO 8601 timestamp when thread was created
 * @property {string} [resumedAt] - ISO 8601 timestamp of last resume (if ever)
 * @property {number} messageCount - Number of messages in thread
 * @property {'active'|'suspended'} status - Current thread status
 */

/**
 * @typedef {Object} ThreadIndex
 * @property {string} version - Schema version (e.g., "1.0")
 * @property {Object.<string, ThreadEntry>} threads - Dictionary keyed by thread ID (Kimi session ID)
 * @description MRU order: most recent thread = first key in object
 */

/**
 * @typedef {Object} ChatMessage
 * @property {'user'|'assistant'} role - Message sender
 * @property {string} content - Message content
 * @property {boolean} [hasToolCalls] - Whether this message had tool calls (redacted in CHAT.md)
 */

/**
 * @typedef {Object} ThreadSession
 * @property {string} threadId - Thread ID (Kimi session ID)
 * @property {string} panelId - Panel this thread belongs to
 * @property {import('child_process').ChildProcess} wireProcess - Kimi CLI wire process
 * @property {import('ws').WebSocket} [ws] - WebSocket connection (if any)
 * @property {number} lastActivity - Timestamp of last activity (for idle timeout)
 * @property {'active'|'grace-period'} state - Current session state
 */

/**
 * @typedef {Object} ThreadManagerConfig
 * @property {number} maxActiveSessions - Max active sessions before FIFO eviction (default: 10)
 * @property {number} idleTimeoutMinutes - Minutes before idle session is killed (default: 9)
 * @property {string} aiPanelsPath - Path to ai/views directory
 */

/**
 * @typedef {Object} ParsedChat
 * @property {string} title - Thread title (from first line)
 * @property {ChatMessage[]} messages - Parsed messages
 */

// WebSocket message types

/**
 * @typedef {Object} WSMessageThreadOpenAssistant
 * @property {'thread:open-assistant'} type
 * @property {string} [threadId] - If present and valid, resume; otherwise create new
 * @property {string} [name] - Optional display name for new threads (default null)
 * @property {string} [harnessId] - Harness selection for new threads ('kimi' | 'robin')
 */

/**
 * @typedef {Object} WSMessageThreadRename
 * @property {'thread:rename'} type
 * @property {string} threadId - Thread to rename
 * @property {string} name - New name
 */

/**
 * @typedef {Object} WSMessageThreadDelete
 * @property {'thread:delete'} type
 * @property {string} threadId - Thread to delete
 */

/**
 * @typedef {Object} WSMessageSend
 * @property {'message:send'} type
 * @property {string} threadId - Target thread
 * @property {string} content - Message content
 */

/**
 * @typedef {WSMessageThreadOpenAssistant|WSMessageThreadRename|WSMessageThreadDelete|WSMessageSend} WSClientMessage
 */

/**
 * @typedef {Object} WSMessageThreadList
 * @property {'thread:list'} type
 * @property {ThreadEntry[]} threads - Ordered by MRU (most recent first)
 */

/**
 * @typedef {Object} WSMessageThreadCreated
 * @property {'thread:created'} type
 * @property {ThreadEntry} thread - New thread info
 * @property {string} threadId - Thread ID
 */

/**
 * @typedef {Object} WSMessageThreadRenamed
 * @property {'thread:renamed'} type
 * @property {string} threadId - Thread ID
 * @property {string} name - New name
 */

/**
 * @typedef {Object} WSMessageThreadDeleted
 * @property {'thread:deleted'} type
 * @property {string} threadId - Deleted thread ID
 */

/**
 * @typedef {Object} WSMessageStream
 * @property {'message:stream'} type
 * @property {string} threadId - Source thread
 * @property {string} delta - Content delta
 */

/**
 * @typedef {Object} WSMessageError
 * @property {'error'} type
 * @property {string} message - Error message
 * @property {string} [code] - Error code
 */

/**
 * @typedef {WSMessageThreadList|WSMessageThreadCreated|WSMessageThreadRenamed|WSMessageThreadDeleted|WSMessageStream|WSMessageError} WSServerMessage
 */

module.exports = {
  // This file is for JSDoc type definitions only
  // No runtime exports needed
};

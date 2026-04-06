/**
 * Thread Management Module
 * 
 * Provides persistent, named conversations with lifecycle management.
 * 
 * @see ../../../ai/views/capture-viewer/specs/SPEC.md - Full specification
 */

const { ThreadIndex } = require('./ThreadIndex');
const { ChatFile, TOOL_CALL_MARKER } = require('./ChatFile');
const { ThreadManager } = require('./ThreadManager');
const { HistoryFile, SCHEMA_VERSION } = require('./HistoryFile');
const ThreadWebSocketHandler = require('./ThreadWebSocketHandler');

module.exports = {
  ThreadIndex,
  ChatFile,
  ThreadManager,
  HistoryFile,
  ThreadWebSocketHandler,
  TOOL_CALL_MARKER,
  SCHEMA_VERSION
};

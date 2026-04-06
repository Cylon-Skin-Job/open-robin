/**
 * @typedef {'turn_begin' | 'content' | 'thinking' | 'tool_call' | 'tool_call_args' | 'tool_result' | 'turn_end'} CanonicalEventType
 */

/**
 * @typedef {Object} CanonicalEvent
 * @property {CanonicalEventType} type
 * @property {number} timestamp
 * @property {string} [turnId]
 */

/**
 * @typedef {Object} TurnBeginEvent
 * @property {'turn_begin'} type
 * @property {number} timestamp
 * @property {string} turnId
 * @property {string} userInput
 */

/**
 * @typedef {Object} ContentEvent
 * @property {'content'} type
 * @property {number} timestamp
 * @property {string} text
 * @property {string} [turnId]
 */

/**
 * @typedef {Object} ThinkingEvent
 * @property {'thinking'} type
 * @property {number} timestamp
 * @property {string} text
 * @property {string} [turnId]
 */

/**
 * @typedef {Object} ToolCallEvent
 * @property {'tool_call'} type
 * @property {number} timestamp
 * @property {string} toolCallId
 * @property {string} toolName
 * @property {string} [turnId]
 */

/**
 * @typedef {Object} ToolCallArgsEvent
 * @property {'tool_call_args'} type
 * @property {number} timestamp
 * @property {string} toolCallId
 * @property {string} argsChunk
 * @property {string} [turnId]
 */

/**
 * @typedef {Object} ToolResultEvent
 * @property {'tool_result'} type
 * @property {number} timestamp
 * @property {string} toolCallId
 * @property {string} toolName
 * @property {string} output
 * @property {unknown[]} display
 * @property {boolean} isError
 * @property {string[]} [files]
 * @property {string} [turnId]
 */

/**
 * @typedef {Object} TokenUsage
 * @property {number} [input_other]
 * @property {number} [input_cache_read]
 * @property {number} [input_cache_creation]
 * @property {number} [output]
 */

/**
 * @typedef {Object} TurnEndEventMeta
 * @property {string} [messageId]
 * @property {TokenUsage} [tokenUsage]
 * @property {number} [contextUsage]
 * @property {boolean} [planMode]
 * @property {string} [harnessId]
 * @property {string} [provider]
 * @property {string} [model]
 */

/**
 * @typedef {Object} TurnEndEvent
 * @property {'turn_end'} type
 * @property {number} timestamp
 * @property {string} turnId
 * @property {string} fullText
 * @property {boolean} hasToolCalls
 * @property {TurnEndEventMeta} [_meta]
 */

/**
 * @typedef {Object} ChatMessage
 * @property {'user' | 'assistant' | 'system'} role
 * @property {string} content
 */

/**
 * @typedef {Object} SendOptions
 * @property {string} [system]
 * @property {ChatMessage[]} [history]
 */

/**
 * @typedef {Object} HarnessConfig
 * @property {string} [cliPath]
 * @property {string} [apiKey]
 * @property {string} [baseUrl]
 * @property {string} [model]
 * @property {number} [maxSteps]
 */

/**
 * @typedef {Object} HarnessSession
 * @property {string} threadId
 * @property {(message: string, options?: SendOptions) => AsyncIterable<CanonicalEvent>} sendMessage
 * @property {() => Promise<void>} stop
 */

/**
 * @typedef {Object} AIHarness
 * @property {string} id
 * @property {string} name
 * @property {string} provider
 * @property {(config: HarnessConfig) => Promise<void>} initialize
 * @property {(threadId: string, projectRoot: string) => Promise<HarnessSession>} startThread
 * @property {() => Promise<void>} dispose
 */

module.exports = {};

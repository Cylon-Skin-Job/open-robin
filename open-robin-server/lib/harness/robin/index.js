const { EventEmitter } = require('events');
const { streamText, tool } = require('ai');
const { emit } = require('../../event-bus');
const { normalizeTokenUsage } = require('../model-catalog');

/**
 * Robin Harness - Built-in Vercel AI SDK implementation
 * 
 * This is the DEFAULT harness. It:
 * - Uses Vercel AI SDK for API calls
 * - Supports BYOK (OpenAI, Anthropic, etc.)
 * - Supports local models (Ollama)
 * - Does NOT spawn external CLI processes
 */
class RobinHarness extends EventEmitter {
  constructor() {
    super();
    this.id = 'robin';
    this.name = 'Robin';
    this.provider = 'vercel-sdk';
    this.config = {};
    this.sessions = new Map();
  }

  async initialize(config = {}) {
    this.config = {
      // Default to OpenAI if configured, else local
      provider: config.provider || process.env.ROBIN_PROVIDER || 'openai',
      model: config.model || process.env.ROBIN_MODEL || 'gpt-4o-mini',
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
      baseUrl: config.baseUrl || process.env.ROBIN_BASE_URL,
      ...config
    };
    console.log('[RobinHarness] Initialized with provider:', this.config.provider);
  }

  async startThread(threadId, projectRoot) {
    const session = {
      threadId,
      projectRoot,
      messages: [],
      config: { ...this.config }
    };
    
    this.sessions.set(threadId, session);
    
    return {
      threadId,
      sendMessage: (message, options) => this.sendMessage(threadId, message, options),
      stop: async () => {
        this.sessions.delete(threadId);
      }
    };
  }

  async *sendMessage(threadId, message, options = {}) {
    const session = this.sessions.get(threadId);
    if (!session) {
      throw new Error(`No session for thread ${threadId}`);
    }

    // Build messages array
    const messages = [
      { role: 'system', content: this.getSystemPrompt() },
      ...session.messages,
      { role: 'user', content: message }
    ];

    // Emit turn begin
    yield {
      type: 'turn_begin',
      timestamp: Date.now(),
      turnId: `turn-${threadId}-${Date.now()}`,
      userInput: message
    };

    // Get the model
    const model = await this.getModel(session.config);

    // Stream the response
    try {
      const result = await streamText({
        model,
        messages,
        tools: this.getTools(),
        maxSteps: 10,
        onStepFinish: (step) => {
          this.emit('step', { threadId, step });
        }
      });

      let fullText = '';
      let hasToolCalls = false;

      // Stream text chunks
      for await (const chunk of result.textStream) {
        fullText += chunk;
        yield {
          type: 'content',
          timestamp: Date.now(),
          text: chunk
        };
      }

      // Handle tool calls
      if (result.toolCalls && result.toolCalls.length > 0) {
        hasToolCalls = true;
        for (const tc of result.toolCalls) {
          yield {
            type: 'tool_call',
            timestamp: Date.now(),
            toolCallId: tc.toolCallId,
            toolName: tc.toolName
          };

          yield {
            type: 'tool_call_args',
            timestamp: Date.now(),
            toolCallId: tc.toolCallId,
            argsChunk: JSON.stringify(tc.args)
          };

          // Note: Tool execution happens client-side
          // Client sends tool_result back via WebSocket
        }
      }

      // Update session history
      session.messages.push({ role: 'user', content: message });
      session.messages.push({ role: 'assistant', content: fullText });

      // Normalize Vercel SDK usage shape → unified token shape
      const rawUsage = result.usage ? {
        input_other: result.usage.inputTokens ?? null,
        output: result.usage.outputTokens ?? null,
      } : null;
      const normalizedUsage = normalizeTokenUsage(
        'robin', session.config.model, rawUsage, null
      );

      const turnId = `turn-${threadId}-${Date.now()}`;

      // Bridge to event bus before yielding (audit subscriber needs this)
      emit('chat:status_update', {
        threadId,
        tokenUsage: normalizedUsage,
      });

      // Accumulate parts from fullText for persistence
      const parts = fullText ? [{ type: 'text', content: fullText }] : [];

      emit('chat:turn_end', {
        workspace: 'code-viewer',
        threadId,
        turnId,
        userInput: message,
        parts,
        fullText,
        hasToolCalls,
      });

      yield {
        type: 'turn_end',
        timestamp: Date.now(),
        turnId,
        fullText,
        hasToolCalls,
        _meta: {
          harnessId: 'robin',
          provider: session.config.provider,
          model: session.config.model,
          tokenUsage: normalizedUsage,
        }
      };

    } catch (error) {
      console.error('[RobinHarness] Stream error:', error);
      yield {
        type: 'turn_end',
        timestamp: Date.now(),
        turnId: `turn-${threadId}-${Date.now()}`,
        fullText: `Error: ${error.message}`,
        hasToolCalls: false,
        _meta: { error: error.message }
      };
    }
  }

  async getModel(config) {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    
    switch (config.provider) {
      case 'openai':
        return createOpenAI({ apiKey: config.apiKey })(config.model);
      
      case 'anthropic':
        return createAnthropic({ apiKey: config.apiKey })(config.model);
      
      case 'ollama':
        // Ollama uses OpenAI-compatible API
        return createOpenAI({
          baseURL: config.baseUrl || 'http://localhost:11434/v1',
          apiKey: 'ollama' // Ollama doesn't need real key
        })(config.model);
      
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  getSystemPrompt() {
    return `You are Robin, a helpful AI assistant. You help users with coding tasks, file operations, and general questions.`;
  }

  getTools() {
    // Tools are handled client-side for now
    // In future, could validate tool calls here
    return {};
  }

  async dispose() {
    this.sessions.clear();
  }
}

module.exports = { RobinHarness };

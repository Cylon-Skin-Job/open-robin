// Agentic loop with streaming
// Handles the Claude API call → tool execution → feed-back cycle

import Anthropic from '@anthropic-ai/sdk';
import { toolDefinitions } from './tools/schemas.js';
import { executeTool } from './tools/executor.js';

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a skilled software engineer working in a project directory. You have access to tools for reading, writing, and editing files, running shell commands, and searching the codebase. Use them to accomplish the user's request.

Key guidelines:
- Read files before editing them
- Use edit_file for surgical changes, write_file for new files or full rewrites
- Run tests after making changes when appropriate
- Keep changes minimal and focused on the request`;

/**
 * Run the agentic loop for a single user turn.
 * Streams events to the caller via the emit callback.
 *
 * @param {object} options
 * @param {Array} options.messages - Conversation history
 * @param {string} options.cwd - Project working directory
 * @param {string} [options.model] - Model to use
 * @param {string} [options.systemPrompt] - Override system prompt
 * @param {(event: object) => void} options.emit - Callback for streaming events
 * @param {() => Promise<'accept'|'reject'>} options.waitForApproval - Async function that resolves when user accepts/rejects a tool call
 * @param {AbortSignal} [options.signal] - Abort signal to cancel the turn
 * @returns {Promise<{ status: string, messages: Array }>}
 */
export async function runAgentLoop({
  messages,
  cwd,
  model = 'claude-sonnet-4-6',
  systemPrompt = SYSTEM_PROMPT,
  emit,
  waitForApproval,
  signal,
}) {
  emit({ type: 'TurnBegin', payload: {} });

  let stepCount = 0;
  const MAX_STEPS = 50;

  while (stepCount < MAX_STEPS) {
    if (signal?.aborted) {
      emit({ type: 'TurnEnd', payload: { reason: 'cancelled' } });
      return { status: 'cancelled', messages };
    }

    stepCount++;
    emit({ type: 'StepBegin', payload: { n: stepCount } });

    // --- Stream the API call ---
    const stream = client.messages.stream({
      model,
      max_tokens: 16384,
      system: systemPrompt,
      messages,
      tools: toolDefinitions,
    });

    const contentBlocks = [];
    let currentBlockIndex = -1;

    stream.on('contentBlockStart', (block) => {
      currentBlockIndex++;
      contentBlocks.push({ ...block.content_block, _text: '' });
    });

    stream.on('contentBlockDelta', (delta) => {
      const d = delta.delta;
      if (d.type === 'text_delta') {
        contentBlocks[currentBlockIndex]._text += d.text;
        emit({ type: 'ContentPart', payload: { type: 'text', text: d.text } });
      } else if (d.type === 'thinking_delta') {
        emit({ type: 'ContentPart', payload: { type: 'think', text: d.thinking } });
      } else if (d.type === 'input_json_delta') {
        // Tool input streaming - accumulate but don't emit text
        contentBlocks[currentBlockIndex]._text += d.partial_json;
      }
    });

    const response = await stream.finalMessage();

    // Emit usage stats
    emit({
      type: 'StatusUpdate',
      payload: {
        token_usage: {
          input_other: response.usage.input_tokens,
          output: response.usage.output_tokens,
          input_cache_read: response.usage.cache_read_input_tokens || 0,
          input_cache_creation: response.usage.cache_creation_input_tokens || 0,
        },
      },
    });

    // Add assistant response to conversation
    messages.push({ role: 'assistant', content: response.content });

    // --- Check stop reason ---
    if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop_sequence') {
      emit({ type: 'TurnEnd', payload: { reason: 'finished' } });
      return { status: 'finished', messages };
    }

    if (response.stop_reason !== 'tool_use') {
      emit({ type: 'TurnEnd', payload: { reason: response.stop_reason } });
      return { status: response.stop_reason, messages };
    }

    // --- Handle tool calls ---
    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
    const toolResults = [];

    for (const toolCall of toolUseBlocks) {
      const isWrite = ['write_file', 'edit_file', 'bash'].includes(toolCall.name);

      // Emit the tool call for the frontend to display
      emit({
        type: 'ToolCall',
        payload: {
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
          needs_approval: isWrite,
        },
      });

      // For write/edit/bash, wait for user approval
      if (isWrite && waitForApproval) {
        const decision = await waitForApproval(toolCall);

        if (decision === 'reject') {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: 'User rejected this tool call.',
            is_error: true,
          });
          emit({
            type: 'ToolResult',
            payload: { id: toolCall.id, rejected: true },
          });
          continue;
        }
      }

      // Execute the tool
      const result = await executeTool(toolCall.name, toolCall.input, cwd);

      emit({
        type: 'ToolResult',
        payload: {
          id: toolCall.id,
          output: result.output,
          is_error: result.is_error,
        },
      });

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolCall.id,
        content: result.output,
        is_error: result.is_error,
      });
    }

    // Feed tool results back to the model
    messages.push({ role: 'user', content: toolResults });
  }

  // Max steps reached
  emit({ type: 'TurnEnd', payload: { reason: 'max_steps_reached' } });
  return { status: 'max_steps_reached', messages };
}

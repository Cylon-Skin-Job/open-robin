/**
 * AutoRename - Generates thread summaries via Kimi subprocess and renames threads
 *
 * Extracted from ThreadManager. Does not import ThreadManager.
 * Accepts ThreadIndex and SessionManager as parameters to avoid circular deps.
 */

class AutoRename {
  /**
   * @param {function} getHistory - Function that returns parsed chat history for a threadId
   */
  constructor(getHistory) {
    this._getHistory = getHistory;
  }

  /**
   * Generate thread summary for auto-naming.
   * Uses kimi --print --no-thinking for fast summarization.
   * @param {string} threadId
   * @returns {Promise<string|null>}
   */
  async generateSummary(threadId) {
    try {
      const history = await this._getHistory(threadId);
      if (!history || history.messages.length < 2) return null;

      // Build conversation text for summarization
      const conversation = history.messages
        .slice(0, 4) // First 2 exchanges max
        .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
        .join('\n');

      const prompt = `Summarize this conversation in 5 words or less for a thread title. Return ONLY the title, no quotes, no punctuation at the end.

${conversation}`;

      // Spawn kimi for summarization
      const { spawn } = require('child_process');
      return new Promise((resolve) => {
        const proc = spawn('kimi', ['--print', '--no-thinking'], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let output = '';
        proc.stdout.on('data', (data) => {
          output += data.toString();
        });

        // 10 second timeout
        const timeout = setTimeout(() => {
          proc.kill();
          resolve(null);
        }, 10000);

        proc.on('exit', () => {
          clearTimeout(timeout);
          console.log('[AutoRename] Raw output:', output.slice(0, 500));

          // Extract text from protocol output
          const lines = output.trim().split('\n');
          let summary = null;

          // First pass: look for TextPart with text='...'
          for (const line of lines) {
            if (line.includes("TextPart") && line.includes("text='")) {
              const textMatch = line.match(/text='([^']+)'/);
              if (textMatch && textMatch[1]) {
                summary = textMatch[1];
                console.log('[AutoRename] Found in TextPart:', summary);
                break;
              }
            }
          }

          // Second pass: skip protocol lines and prompt echo, take first clean line
          if (!summary) {
            for (const line of lines) {
              const trimmed = line.trim();
              // Skip empty, protocol, and prompt echo lines
              if (!trimmed) continue;
              if (trimmed.startsWith('TurnBegin') ||
                  trimmed.startsWith('StepBegin') ||
                  trimmed.startsWith('StatusUpdate') ||
                  trimmed.startsWith('TurnEnd') ||
                  trimmed.startsWith('TextPart') ||
                  prompt.includes(trimmed.slice(0, 20))) {
                continue;
              }
              summary = trimmed;
              console.log('[AutoRename] Found plain text:', summary);
              break;
            }
          }

          // Final fallback: last non-protocol line
          if (!summary) {
            const cleanLines = lines.filter(l => {
              const t = l.trim();
              return t &&
                     !t.startsWith('Turn') &&
                     !t.startsWith('Step') &&
                     !t.startsWith('Status') &&
                     !t.startsWith('TextPart') &&
                     !prompt.includes(t.slice(0, 20));
            });
            summary = cleanLines.pop()?.trim();
            console.log('[AutoRename] Fallback:', summary);
          }

          console.log('[AutoRename] Final summary:', summary?.slice(0, 50));
          resolve(summary ? summary.slice(0, 50) : null);
        });

        proc.stdin.write(prompt);
        proc.stdin.end();
      });
    } catch (err) {
      console.warn(`[AutoRename] Failed to spawn kimi for ${threadId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Auto-rename thread after first assistant response.
   * Guards against race condition where session closes during Kimi summarization.
   * @param {string} threadId
   * @param {import('./ThreadIndex').ThreadIndex} index
   * @param {import('./session-manager').SessionManager} sessionManager
   * @param {function} renameThread - ThreadManager.renameThread bound method
   */
  async autoRename(threadId, index, sessionManager, renameThread) {
    const entry = await index.get(threadId);
    if (!entry || !entry.name.startsWith('New Chat')) return;

    const summary = await this.generateSummary(threadId);
    if (!summary) return;

    // Guard: session may have closed while Kimi was running
    if (!sessionManager.isActive(threadId)) {
      console.log(`[AutoRename] Session ${threadId} closed during summarization, skipping rename`);
      return;
    }

    await renameThread(threadId, summary);
  }
}

module.exports = { AutoRename };

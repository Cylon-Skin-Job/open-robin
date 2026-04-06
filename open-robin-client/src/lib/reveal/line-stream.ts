/**
 * Line-Stream Reveal — think, shell, subagent, todo
 *
 * Wires the line-break parser to the shared orchestrator.
 * That's it. Parser handles boundaries. Orchestrator handles typing.
 */

import { orchestrateReveal } from './orchestrator';
import { createLineBreakParser } from './parsers/line-break';
import type { RevealController } from './types';

export const lineStreamReveal: RevealController = {
  async run(contentRef, setDisplayed, cancelRef, completeRef, options?) {
    const parser = createLineBreakParser();
    await orchestrateReveal(contentRef, setDisplayed, cancelRef, completeRef, parser, options);
  },
};

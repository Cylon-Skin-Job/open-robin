/**
 * Harness configuration for AI backend selection
 * 
 * Defines available harness options and their properties.
 * Used by the HarnessSelector component.
 */

export interface HarnessDetails {
  provider: 'kimi' | 'byok' | 'ollama' | string;
  model: string;
  features: string[];
}

export interface HarnessOption {
  id: string;
  name: string;
  description: string;
  icon: string;
  details: HarnessDetails;
  enabled: boolean;
  comingSoon?: boolean;
  recommended?: boolean;
}

export const HARNESS_OPTIONS: HarnessOption[] = [
  {
    id: 'kimi',
    name: 'KIMI',
    description: 'Moonshot AI — native wire protocol with thinking, context %, and plan mode',
    icon: '🌙',
    details: {
      provider: 'moonshot',
      model: 'k2.5',
      features: ['tools', 'streaming', 'thinking', 'plan_mode', 'context_%']
    },
    enabled: true,
    recommended: true
  },
  {
    id: 'robin',
    name: 'Robin',
    description: 'Built-in Vercel AI SDK — BYOK, works with any OpenAI-compatible provider',
    icon: '🔷',
    details: {
      provider: 'byok',
      model: 'configurable',
      features: ['tools', 'streaming']
    },
    enabled: true
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Anthropic Claude Code CLI — thinking blocks, 1M context',
    icon: '🟣',
    details: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      features: ['tools', 'streaming', 'thinking']
    },
    enabled: true
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description: 'Google Gemini CLI — 1M context window',
    icon: '💎',
    details: {
      provider: 'google',
      model: 'gemini-2.5-pro',
      features: ['tools', 'streaming']
    },
    enabled: true
  },
  {
    id: 'qwen',
    name: 'Qwen',
    description: 'Alibaba Qwen Code CLI — 256K context with thinking',
    icon: '🔶',
    details: {
      provider: 'alibaba',
      model: 'qwen3-coder',
      features: ['tools', 'streaming', 'thinking']
    },
    enabled: true
  },
  {
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI Codex CLI — GPT-5 series agentic coding',
    icon: '⚡',
    details: {
      provider: 'openai',
      model: 'gpt-5.3-codex',
      features: ['tools', 'streaming', 'thinking']
    },
    enabled: true
  }
];

// Default harness - KIMI is the primary experience
export const DEFAULT_HARNESS = 'kimi';

// System prompt prefix for Robin
export const ROBIN_SYSTEM_PROMPT = `You are Robin, a helpful AI assistant. You provide clear, accurate, and helpful responses while being direct and efficient in your communication.`;

// Helper to get harness option by ID
export function getHarnessOption(id: string): HarnessOption | undefined {
  return HARNESS_OPTIONS.find(opt => opt.id === id);
}

// Helper to check if a harness is enabled
export function isHarnessEnabled(id: string): boolean {
  const option = getHarnessOption(id);
  return option?.enabled ?? false;
}

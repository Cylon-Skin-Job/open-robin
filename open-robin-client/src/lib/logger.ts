/**
 * @module logger
 * @role Console logging with optional WebSocket forwarding
 */

let loggerWs: WebSocket | null = null;

export function setLoggerWs(ws: WebSocket | null) {
  loggerWs = ws;
}

export function captureConsoleLogs() {
  // No-op for now — can be wired to forward console.log to server
}

export const logger = {
  info: (...args: unknown[]) => {
    console.log(...args);
    void loggerWs; // reference to suppress unused warning
  },
  error: (...args: unknown[]) => console.error(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  debug: (...args: unknown[]) => console.debug(...args),
};

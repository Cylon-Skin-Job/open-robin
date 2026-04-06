import { useEffect } from 'react';
import { connectWs, disconnectWs } from '../lib/ws-client';

/**
 * Thin React wrapper — calls connectWs on mount, disconnectWs on unmount.
 * All connection, message routing, and discovery logic lives in ws-client.ts.
 */
export function useWebSocket() {
  useEffect(() => {
    connectWs();
    return () => disconnectWs();
  }, []);
}

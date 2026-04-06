/**
 * @module Toast
 * @role React mount point for toast notifications
 *
 * The imperative showToast() function lives in lib/toast.ts.
 * This component registers its state setter on mount so showToast() works.
 */

import { useState, useEffect } from 'react';
import { registerToastSetter, unregisterToastSetter } from '../lib/toast';

// Re-export for existing consumers
export { showToast } from '../lib/toast';

export function Toast() {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    registerToastSetter((msg: string) => {
      setMessage(msg);
      setVisible(true);
      setTimeout(() => setVisible(false), 4000);
    });
    return () => { unregisterToastSetter(); };
  }, []);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#1a1a1a',
      border: '1px solid #333',
      borderRadius: '8px',
      padding: '10px 20px',
      color: '#eee',
      fontSize: '0.8125rem',
      zIndex: 9999,
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    }}>
      {message}
    </div>
  );
}

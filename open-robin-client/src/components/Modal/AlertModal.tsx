/**
 * @module AlertModal
 * @role Alert dialog with confirm/cancel buttons
 *
 * Generic alert modal for trigger-driven confirmations.
 */

import { useCallback } from 'react';
import { fireModalAction } from '../../lib/modal';
import type { ModalConfig } from '../../lib/modal';

interface Props {
  config: ModalConfig;
  onDismiss: () => void;
}

export function AlertModal({ config, onDismiss }: Props) {
  const { data } = config;

  const handleConfirm = useCallback(() => {
    fireModalAction('confirm', { source: data.source, target: data.target });
    onDismiss();
  }, [data, onDismiss]);

  const handleCancel = useCallback(() => {
    fireModalAction('cancel', {});
    onDismiss();
  }, [onDismiss]);

  return (
    <div>
      <div className="rv-modal-alert-message">{data.message}</div>
      <div className="rv-modal-alert-actions">
        <button className="rv-modal-btn" onClick={handleCancel}>Cancel</button>
        <button className="rv-modal-btn rv-modal-btn-primary" onClick={handleConfirm}>Confirm</button>
      </div>
    </div>
  );
}

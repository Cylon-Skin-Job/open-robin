/**
 * @module modal
 * @role Imperative modal notification trigger
 *
 * Decoupled from React — the ModalOverlay component registers its setter on mount.
 * Any module can call showModal() without importing React components.
 *
 * Follows the same pattern as lib/toast.ts.
 */

export interface ModalConfig {
  modalType: string;
  config: {
    type: string;
    layout?: string;
    panels?: Record<string, unknown>;
    actions?: Record<string, unknown>;
    [key: string]: unknown;
  };
  styles: string;
  data: {
    source?: string | null;
    target?: string | null;
    title: string;
    message: string;
    sourceContent?: string | null;
    [key: string]: unknown;
  };
}

type ModalSetter = (config: ModalConfig | null) => void;
type ModalActionCallback = (action: string, payload: unknown) => void;

let modalSetter: ModalSetter | null = null;
let actionCallback: ModalActionCallback | null = null;

export function showModal(config: ModalConfig) {
  if (modalSetter) modalSetter(config);
}

export function dismissModal() {
  if (modalSetter) modalSetter(null);
}

export function registerModalSetter(setter: ModalSetter) {
  modalSetter = setter;
}

export function unregisterModalSetter() {
  modalSetter = null;
}

export function onModalAction(callback: ModalActionCallback) {
  actionCallback = callback;
}

export function fireModalAction(action: string, payload: unknown) {
  if (actionCallback) actionCallback(action, payload);
}

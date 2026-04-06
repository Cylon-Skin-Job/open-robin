/**
 * @module toast
 * @role Imperative toast notification trigger
 *
 * Decoupled from React — the Toast component registers its setter on mount.
 * Any module can call showToast() without importing React components.
 */

let toastSetter: ((msg: string) => void) | null = null;

export function showToast(message: string) {
  if (toastSetter) toastSetter(message);
}

export function registerToastSetter(setter: (msg: string) => void) {
  toastSetter = setter;
}

export function unregisterToastSetter() {
  toastSetter = null;
}

/**
 * @module submodule-registry
 * @role Maps panel type strings to React components
 *
 * Future use: ContentArea will look up components by index.json "type"
 * instead of the current ID-based CONTENT_COMPONENTS map.
 * Currently used by registerSubmodule() for runtime plugin registration.
 */

import type { ComponentType } from 'react';
import type { PanelConfig } from '../lib/panels';

export interface SubmoduleProps {
  panel: string;
  config: PanelConfig;
}

const SUBMODULE_REGISTRY: Record<string, ComponentType<SubmoduleProps>> = {};

/**
 * Look up the React component for a panel type.
 * Returns undefined for unknown types (caller should render placeholder).
 */
export function getSubmodule(type: string): ComponentType<SubmoduleProps> | undefined {
  return SUBMODULE_REGISTRY[type];
}

/**
 * Register a submodule at runtime (for plugin system or lazy registration).
 */
export function registerSubmodule(type: string, component: ComponentType<SubmoduleProps>) {
  SUBMODULE_REGISTRY[type] = component;
}

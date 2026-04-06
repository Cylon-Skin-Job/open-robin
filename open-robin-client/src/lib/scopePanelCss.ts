/**
 * @module scopePanelCss
 * @role Prefix selectors with [data-panel="…"] for workspace-injected panel CSS
 *
 * Shared by runtime module ctx.injectStyles and usePanelWorkspaceStyles.
 */

export function scopePanelCss(css: string, panelId: string): string {
  return css.replace(
    /(^|\})\s*([^@{}][^{]*)\{/g,
    (match, before, selector) => {
      const s = selector.trim();
      if (s.startsWith('@') || s.includes(`[data-panel="${panelId}"]`)) {
        return match;
      }
      return `${before} [data-panel="${panelId}"] ${s} {`;
    }
  );
}

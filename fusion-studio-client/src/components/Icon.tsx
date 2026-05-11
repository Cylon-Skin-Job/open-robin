/**
 * @module Icon
 * @role Render a Material Symbol as either an inline SVG (customizable) or
 * a font glyph (fallback). Works with the icon-registry cache.
 *
 * Usage:
 *   <Icon name="home" className="rv-icon-xl" />
 *
 * If the SVG is cached in icon-registry, renders inline <svg>.
 * Otherwise renders <span className="material-symbols-outlined"> so
 * the icon is visible immediately while the SVG loads in the background.
 */

import { useEffect, useState } from 'react';
import { getCachedIcon, loadIcon } from '../lib/icon-registry';

interface IconProps {
  name: string;
  className?: string;
  style?: React.CSSProperties;
  filled?: boolean;
  /** Only used for customizable icons; panels/UI stay outlined */
  symbolStyle?: 'outlined' | 'rounded' | 'sharp';
}

export function Icon({ name, className = '', style, filled = false, symbolStyle = 'outlined' }: IconProps) {
  const [svg, setSvg] = useState<string | null>(() => getCachedIcon(name, symbolStyle, filled));

  useEffect(() => {
    const cached = getCachedIcon(name, symbolStyle, filled);
    if (cached) {
      setSvg(cached);
      return;
    }

    let mounted = true;
    loadIcon(name, symbolStyle, filled).then((loaded) => {
      if (mounted && loaded) setSvg(loaded);
    });
    return () => { mounted = false; };
  }, [name, symbolStyle, filled]);

  if (svg) {
    return (
      <span
        className={className}
        style={{
          ...style,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '1em',
          height: '1em',
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  // Fallback: render as font glyph (instant, no layout shift)
  return (
    <span className={`material-symbols-outlined ${className}`} style={style}>
      {name}
    </span>
  );
}

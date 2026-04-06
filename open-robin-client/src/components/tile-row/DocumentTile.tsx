/**
 * @module DocumentTile
 * @role Single file rendered as a scaled-down document thumbnail
 *
 * Renders the actual file content at full size inside a container,
 * then scales it down with CSS transform. The tile shows real content,
 * not a placeholder.
 *
 * Reusable across any workspace that wants a tile view.
 */

import { CodeView } from '../CodeView';

interface DocumentTileProps {
  name: string;
  content: string;
  extension?: string;
  panel?: string;
  folderPath?: string;
  onClick?: () => void;
  active?: boolean;
  size?: 'default' | 'small';
}

const ICON_MAP: Record<string, string> = {
  md: 'description',
  html: 'html',
  json: 'data_object',
  js: 'javascript',
  ts: 'javascript',
  css: 'css',
  txt: 'text_snippet',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  svg: 'image',
  pdf: 'picture_as_pdf',
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);

export function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
}

export function DocumentTile({ name, content, extension, panel, folderPath, onClick, active, size = 'default' }: DocumentTileProps) {
  const ext = extension || name.split('.').pop()?.toLowerCase() || '';
  const icon = ICON_MAP[ext] || 'draft';
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const classes = ['doc-tile'];
  if (size === 'small') classes.push('doc-tile-small');
  if (active) classes.push('active');

  return (
    <div className={classes.join(' ')} onClick={onClick} title={name}>
      <div className="doc-tile-preview">
        {isImage ? (
          <img
            src={`/api/panel-file/${panel}/${folderPath}/${encodeURIComponent(name)}`}
            alt={name}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <CodeView content={content} extension={ext} />
        )}
      </div>
      <div className="doc-tile-footer">
        <span className="material-symbols-outlined doc-tile-icon">{icon}</span>
        <span className="doc-tile-name">{name}</span>
      </div>
    </div>
  );
}

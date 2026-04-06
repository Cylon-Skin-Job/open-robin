import type { FileTreeNode } from '../../types/file-explorer';
import { getFileIcon, formatNodeName } from '../../lib/file-utils';
import { useFileStore } from '../../state/fileStore';
import { loadFileContent } from '../../hooks/useFileTree';

interface FileNodeProps {
  node: FileTreeNode;
  depth: number;
}

export function FileNode({ node, depth }: FileNodeProps) {
  const isThisFileLoading = useFileStore((s) =>
    s.tabs.some((t) => t.file.path === node.path && t.loading),
  );

  const icon = getFileIcon(node.extension);
  const paddingLeft = `${0.75 + depth * 1.25}rem`;

  function handleClick() {
    if (isThisFileLoading) return;
    loadFileContent({
      name: node.name,
      path: node.path,
      type: 'file',
      extension: node.extension,
    });
  }

  return (
    <div
      className={`file-tree-item${isThisFileLoading ? ' disabled' : ''}`}
      style={{ paddingLeft }}
      onClick={handleClick}
    >
      <span className={`material-symbols-outlined tree-icon icon-${icon}`}>
        {icon}
      </span>
      <span className="tree-label">{formatNodeName(node.name)}</span>
    </div>
  );
}

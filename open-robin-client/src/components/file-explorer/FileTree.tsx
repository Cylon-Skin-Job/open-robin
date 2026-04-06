import type { FileTreeNode as FileTreeNodeType } from '../../types/file-explorer';
import { FileTreeNode } from './FileTreeNode';

interface FileTreeProps {
  nodes: FileTreeNodeType[];
  depth?: number;
}

export function FileTree({ nodes, depth = 0 }: FileTreeProps) {
  if (nodes.length === 0) {
    return (
      <div className="file-tree-empty" style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}>
        <span style={{ color: 'var(--text-dim)', fontSize: 'var(--file-tree-font-size, 0.85rem)' }}>
          Empty folder
        </span>
      </div>
    );
  }

  return (
    <div className="file-tree">
      {nodes.map((node) => (
        <FileTreeNode key={node.path} node={node} depth={depth} />
      ))}
    </div>
  );
}

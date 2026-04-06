import type { FileTreeNode as FileTreeNodeType } from '../../types/file-explorer';
import { FolderNode } from './FolderNode';
import { FileNode } from './FileNode';

interface FileTreeNodeProps {
  node: FileTreeNodeType;
  depth: number;
}

export function FileTreeNode({ node, depth }: FileTreeNodeProps) {
  if (node.type === 'folder') {
    return <FolderNode node={node} depth={depth} />;
  }
  return <FileNode node={node} depth={depth} />;
}

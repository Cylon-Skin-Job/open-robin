/**
 * @module useFolderFiles
 * @role Hook that returns all files (with content) for a panel folder
 *
 * Reads from the central fileDataStore. Triggers fetch on first call,
 * returns cached data on subsequent mounts. No WS listeners in components.
 *
 * Returns { files, loading } where files includes content for text files
 * and empty content for images.
 */

import { useEffect, useMemo } from 'react';
import { useFileDataStore, type FileNode, type FileWithContent } from '../state/fileDataStore';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);

function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
}

export function useFolderFiles(panel: string, folder: string): {
  files: FileWithContent[];
  loading: boolean;
} {
  const trees = useFileDataStore((s) => s.trees);
  const contents = useFileDataStore((s) => s.contents);
  const requestTree = useFileDataStore((s) => s.requestTree);
  const requestContent = useFileDataStore((s) => s.requestContent);

  const treeKey = `${panel}:${folder}`;
  const nodes: FileNode[] | undefined = trees[treeKey];

  // Request tree if not cached
  useEffect(() => {
    requestTree(panel, folder);
  }, [panel, folder, requestTree]);

  // Once tree arrives, request content for text files
  useEffect(() => {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.type !== 'file' || node.name.startsWith('.')) continue;
      if (isImageFile(node.name)) continue;
      requestContent(panel, node.path);
    }
  }, [nodes, panel, requestContent]);

  // Build the files array from cache
  return useMemo(() => {
    if (!nodes) return { files: [], loading: true };

    const fileNodes = nodes.filter(
      (n) => n.type === 'file' && !n.name.startsWith('.')
    );

    let allLoaded = true;
    const files: FileWithContent[] = [];

    for (const node of fileNodes) {
      if (isImageFile(node.name)) {
        files.push({ ...node, content: '' });
      } else {
        const key = `${panel}:${node.path}`;
        const content = contents[key];
        if (content === undefined) {
          allLoaded = false;
        } else {
          files.push({ ...node, content });
        }
      }
    }

    files.sort((a, b) => a.name.localeCompare(b.name));

    return { files, loading: !allLoaded };
  }, [nodes, contents, panel]);
}

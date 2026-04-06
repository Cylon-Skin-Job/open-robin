// File Explorer Types
// See docs/FILE_EXPLORER_WEBSOCKET_SPEC.md for protocol details

export interface FileTreeNode {
  name: string;           // filename on disk: "architecture.md"
  path: string;           // full relative path: "docs/architecture.md"
  type: 'file' | 'folder';
  extension?: string;     // normalized lowercase: "md" (files only)
  hasChildren?: boolean;  // folders only: true if non-empty
  isSymlink?: boolean;    // true if entry is a symlink
}

export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'folder';
  extension?: string;
}

/** One open file tab in the code viewer (path is unique per tab). */
export interface EditorTab {
  file: FileInfo;
  content: string;
  size: number;
  loading: boolean;
}

export type FileErrorCode =
  | 'ENOENT'
  | 'EACCES'
  | 'ENOTDIR'
  | 'EISDIR'
  | 'ENOTPANEL'
  | 'ETOOLARGE'
  | 'UNKNOWN';

// Client -> Server
export interface FileTreeRequest {
  type: 'file_tree_request';
  panel: string;
  path?: string;
}

export interface FileContentRequest {
  type: 'file_content_request';
  panel: string;
  path: string;
}

// Server -> Client (success)
export interface FileTreeResponse {
  type: 'file_tree_response';
  panel: string;
  path: string;
  success: true;
  nodes: FileTreeNode[];
}

export interface FileContentResponse {
  type: 'file_content_response';
  panel: string;
  path: string;
  success: true;
  content: string;
  size: number;
  lastModified: number;
}

// Server -> Client (error)
export interface FileOperationError {
  type: 'file_tree_response' | 'file_content_response';
  panel: string;
  path: string;
  success: false;
  error: string;
  code: FileErrorCode;
}

// Server -> Client (file watching stub)
export interface FileChangedNotification {
  type: 'file_changed';
  panel: string;
  path: string;
  change: 'created' | 'modified' | 'deleted';
  timestamp: number;
}

// Server -> Client (panel configuration on connect)
export interface PanelConfigMessage {
  type: 'panel_config';
  panel: string;
  projectRoot: string;
  projectName: string;
}

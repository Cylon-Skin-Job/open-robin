import { CodeView } from '../CodeView';

interface FileContentRendererProps {
  content: string;
  extension?: string;
  fileName?: string;
}

export function FileContentRenderer({ content, extension }: FileContentRendererProps) {
  return (
    <div className="rv-file-content-renderer rv-document-surface">
      <CodeView content={content} extension={extension} />
    </div>
  );
}

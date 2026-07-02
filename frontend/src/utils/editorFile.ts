import type { EditorFile } from '../stores/ideStore';
import { getLanguageName } from './editorLanguage';
import { getFileNameFromPath, toNativeLocalPath } from './lspUri';

interface ReadFileResultLike {
  content: string;
  encoding: string;
  lineEndings: string;
}

/** Builds the EditorFile object Firn stores for an opened file tab. */
export function createEditorFile(path: string, fileContent: ReadFileResultLike): EditorFile {
  const localPath = toNativeLocalPath(path);

  return {
    id: localPath,
    name: getFileNameFromPath(localPath),
    path: localPath,
    language: getLanguageName(localPath),
    encoding: fileContent.encoding,
    lineEndings: fileContent.lineEndings,
    content: fileContent.content,
    isModified: false,
  };
}

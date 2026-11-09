import type { FileEntry } from '../stores/ideStore';

/**
 * Whether a folder name is one the Show hidden folders toggle hides (#450): a
 * dot-folder such as .github. The backend never lists .git, .hg or .svn.
 */
export const isHiddenFolderName = (name: string): boolean => name.startsWith('.');

const isHiddenFolder = (entry: FileEntry): boolean => entry.isDir && isHiddenFolderName(entry.name);

/**
 * entries as the tree shows them: dot-folders left out unless shown, dot-files
 * kept. Returns entries itself when nothing is left out.
 */
export function shownEntries(entries: FileEntry[], showHiddenFolders: boolean): FileEntry[] {
  return showHiddenFolders || !entries.some(isHiddenFolder)
    ? entries
    : entries.filter((entry) => !isHiddenFolder(entry));
}

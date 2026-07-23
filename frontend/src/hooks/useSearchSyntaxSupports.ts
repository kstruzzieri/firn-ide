import { startTransition, useEffect, useRef, useState } from 'react';
import type { LanguageSupport } from '@codemirror/language';
import {
  getLanguageDescription,
  getLoadedLanguageSupport,
  loadLanguageSupport,
} from '../components/Editor/codemirror/languages';

const EMPTY: ReadonlyMap<string, LanguageSupport> = new Map();

/**
 * Panel-level loader: given the distinct filenames of currently visible match
 * rows, returns a filename→LanguageSupport map for the languages that have
 * loaded. Guarantees:
 *   - Empty map on the first render of each new `visibleFilenames` identity, so
 *     every new result set first commits monochrome.
 *   - One import per distinct language (grouped by LanguageDescription name).
 *   - Unsupported files, failed imports, and superseded/unmounted loads never
 *     publish support. `LanguageDescription.load()` already dedupes and clears
 *     failed promises, so no local promise cache is kept (a later input retries).
 */
export function useSearchSyntaxSupports(
  visibleFilenames: readonly string[]
): ReadonlyMap<string, LanguageSupport> {
  // Adjust-state-on-input-change: resets to EMPTY synchronously (before commit)
  // whenever the input array identity changes.
  const [state, setState] = useState<{
    key: readonly string[];
    map: ReadonlyMap<string, LanguageSupport>;
  }>({ key: visibleFilenames, map: EMPTY });
  if (state.key !== visibleFilenames) {
    setState({ key: visibleFilenames, map: EMPTY });
  }

  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    let active = true;

    // Group filenames by language name; keep one representative filename to feed
    // the extension-based loaders.
    const groups = new Map<string, { sample: string; filenames: string[] }>();
    for (const filename of visibleFilenames) {
      const description = getLanguageDescription(filename);
      if (!description) continue;
      const group = groups.get(description.name);
      if (group) group.filenames.push(filename);
      else groups.set(description.name, { sample: filename, filenames: [filename] });
    }
    if (groups.size === 0)
      return () => {
        active = false;
      };

    const tasks = [...groups.values()].map(async ({ sample, filenames }) => {
      const support = getLoadedLanguageSupport(sample) ?? (await loadLanguageSupport(sample));
      return { filenames, support };
    });

    void Promise.all(tasks).then((results) => {
      if (!active || generationRef.current !== generation) return;
      const map = new Map<string, LanguageSupport>();
      for (const { filenames, support } of results) {
        if (!support) continue;
        for (const filename of filenames) map.set(filename, support);
      }
      if (map.size === 0) return;
      startTransition(() => {
        if (!active || generationRef.current !== generation) return;
        setState({ key: visibleFilenames, map });
      });
    });

    return () => {
      active = false;
    };
  }, [visibleFilenames]);

  return state.key === visibleFilenames ? state.map : EMPTY;
}

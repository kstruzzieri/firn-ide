/**
 * Human-readable language labels for editor files and status bar display.
 */

export function getLanguageName(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();

  const languageNames: Record<string, string> = {
    js: 'JavaScript',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    jsx: 'JavaScript JSX',
    ts: 'TypeScript',
    mts: 'TypeScript',
    cts: 'TypeScript',
    tsx: 'TypeScript JSX',
    py: 'Python',
    pyw: 'Python',
    pyi: 'Python',
    go: 'Go',
    css: 'CSS',
    scss: 'SCSS',
    less: 'Less',
    html: 'HTML',
    htm: 'HTML',
    json: 'JSON',
    jsonc: 'JSON with Comments',
    md: 'Markdown',
    markdown: 'Markdown',
    txt: 'Plain Text',
    sh: 'Shell',
    bash: 'Bash',
    zsh: 'Zsh',
    yml: 'YAML',
    yaml: 'YAML',
    toml: 'TOML',
    xml: 'XML',
    svg: 'SVG',
    sql: 'SQL',
    rs: 'Rust',
    rb: 'Ruby',
    java: 'Java',
    kt: 'Kotlin',
    swift: 'Swift',
    c: 'C',
    h: 'C Header',
    cpp: 'C++',
    hpp: 'C++ Header',
    cs: 'C#',
    php: 'PHP',
  };

  return ext ? languageNames[ext] || 'Plain Text' : 'Plain Text';
}

/**
 * Test: CI/CD Configuration
 *
 * These tests verify GitHub Actions workflows are properly configured.
 * TDD: Written first to define expected behavior.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const rootDir = resolve(__dirname, '../../..');
const workflowsDir = resolve(rootDir, '.github/workflows');

function workflowSteps(content: string): string[][] {
  const lines = content.split(/\r?\n/);
  const steps: string[][] = [];

  for (let start = 0; start < lines.length; start += 1) {
    const stepStart = lines[start].match(/^(\s*)-\s+(?:name|uses|run):/);
    if (!stepStart) continue;

    const indent = stepStart[1].length;
    let end = start + 1;
    while (end < lines.length) {
      const nextStep = lines[end].match(/^(\s*)-\s+/);
      const nextContent = lines[end].match(/^(\s*)\S/);
      if (nextStep?.[1].length === indent || (nextContent && nextContent[1].length < indent)) break;
      end += 1;
    }

    steps.push(lines.slice(start, end));
    start = end - 1;
  }

  return steps;
}

describe('CI Workflow', () => {
  it('should have test.yml workflow', () => {
    expect(existsSync(resolve(workflowsDir, 'test.yml'))).toBe(true);
  });

  it('should have lint.yml workflow', () => {
    expect(existsSync(resolve(workflowsDir, 'lint.yml'))).toBe(true);
  });

  it('should have build.yml workflow', () => {
    expect(existsSync(resolve(workflowsDir, 'build.yml'))).toBe(true);
  });

  it('should resolve every setup-go step from the Go version required by go.mod', () => {
    const goMod = readFileSync(resolve(rootDir, 'go.mod'), 'utf-8');
    const goVersion = goMod.match(/^go\s+(\d+\.\d+)/m)?.[1];
    const workflowFiles = readdirSync(workflowsDir).filter((file) => /\.ya?ml$/.test(file));
    const expectedSetupGoSteps: Record<string, number> = {
      'build.yml': 1,
      'lint.yml': 1,
      'release.yml': 3,
      // backend-tests plus windows-filesystem-tests, which exercises the
      // platform-specific filesystem code on the OS that actually runs it.
      'test.yml': 2,
    };

    expect(goVersion).toBeDefined();

    for (const file of workflowFiles) {
      const content = readFileSync(resolve(workflowsDir, file), 'utf-8');
      const setupGoSteps = workflowSteps(content).filter((step) =>
        step.some((line) =>
          /^\s*(?:-\s*)?uses:\s*['"]?actions\/setup-go@[^'"\s]+['"]?\s*$/.test(line)
        )
      );
      const expectedCount = expectedSetupGoSteps[file] ?? 0;

      expect({ file, setupGoSteps: setupGoSteps.length }).toEqual({
        file,
        setupGoSteps: expectedCount,
      });

      for (const step of setupGoSteps) {
        const withIndex = step.findIndex((line) => /^\s*with:\s*$/.test(line));
        const withIndent = withIndex >= 0 ? step[withIndex].match(/^(\s*)/)?.[1].length : undefined;
        const afterWith = withIndex >= 0 ? step.slice(withIndex + 1) : [];
        const inputEnd =
          withIndent === undefined
            ? 0
            : afterWith.findIndex((line) => {
                if (!line.trim() || line.trimStart().startsWith('#')) return false;
                return (line.match(/^(\s*)/)?.[1].length ?? 0) <= withIndent;
              });
        const inputs = afterWith.slice(0, inputEnd < 0 ? undefined : inputEnd);

        expect({
          file,
          versionFiles: inputs.filter((line) =>
            /^\s*go-version-file:\s*['"]?go\.mod['"]?\s*$/.test(line)
          ).length,
          literalVersions: inputs.filter((line) => /^\s*go-version:\s*/.test(line)).length,
        }).toEqual({
          file,
          versionFiles: 1,
          literalVersions: 0,
        });
      }
    }
  });

  it('should pin workflow Wails installs to the module version', () => {
    const goMod = readFileSync(resolve(rootDir, 'go.mod'), 'utf-8');
    const wailsVersion = goMod.match(/^\s*github\.com\/wailsapp\/wails\/v2\s+(v\S+)/m)?.[1];

    expect(wailsVersion).toBeDefined();
    const workflowFiles = readdirSync(workflowsDir).filter((file) => /\.ya?ml$/.test(file));
    const installVersions = workflowFiles.flatMap((workflow) => {
      const content = readFileSync(resolve(workflowsDir, workflow), 'utf-8');
      return [...content.matchAll(/github\.com\/wailsapp\/wails\/v2\/cmd\/wails@(\S+)/g)].map(
        (match) => match[1]
      );
    });

    expect(installVersions.length).toBeGreaterThan(0);
    expect(new Set(installVersions)).toEqual(new Set([wailsVersion]));
  });
});

describe('Release Workflow', () => {
  it('should have release.yml workflow', () => {
    expect(existsSync(resolve(workflowsDir, 'release.yml'))).toBe(true);
  });

  it('should trigger on version tags', () => {
    const releaseYml = readFileSync(resolve(workflowsDir, 'release.yml'), 'utf-8');
    expect(releaseYml).toMatch(/tags:\s*\n\s*-\s*['"]?v/);
  });

  it('should build for macOS', () => {
    const releaseYml = readFileSync(resolve(workflowsDir, 'release.yml'), 'utf-8');
    expect(releaseYml).toMatch(/macos|darwin/i);
  });

  it('should build for Linux', () => {
    const releaseYml = readFileSync(resolve(workflowsDir, 'release.yml'), 'utf-8');
    expect(releaseYml).toMatch(/linux|ubuntu/i);
  });

  it('should use the tested release-note and checksum scripts', () => {
    const releaseYml = readFileSync(resolve(workflowsDir, 'release.yml'), 'utf-8');

    expect(releaseYml).toContain('.github/scripts/extract-changelog.sh');
    expect(releaseYml).toContain('.github/scripts/generate-checksums.sh');
    expect(releaseYml).toContain('SHA256SUMS');
  });
});

describe('Lint Workflow', () => {
  it('should run ESLint', () => {
    const lintYml = readFileSync(resolve(workflowsDir, 'lint.yml'), 'utf-8');
    expect(lintYml).toMatch(/eslint|npm run lint/i);
  });

  it('should run golangci-lint', () => {
    const lintYml = readFileSync(resolve(workflowsDir, 'lint.yml'), 'utf-8');
    expect(lintYml).toMatch(/golangci-lint/i);
  });
});

describe('Changelog', () => {
  it('should have CHANGELOG.md', () => {
    expect(existsSync(resolve(rootDir, 'CHANGELOG.md'))).toBe(true);
  });
});

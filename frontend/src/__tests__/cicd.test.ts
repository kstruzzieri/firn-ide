/**
 * Test: CI/CD Configuration
 *
 * These tests verify GitHub Actions workflows are properly configured.
 * TDD: Written first to define expected behavior.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';

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

type WorkflowEvent = Record<string, unknown> | null;

function workflowEvents(content: string): Record<string, WorkflowEvent> {
  return (parse(content) as { on?: Record<string, WorkflowEvent> }).on ?? {};
}

function workflowBranchFilters(content: string, event: string): string[] {
  const config = workflowEvents(content)[event];
  return config
    ? ['branches', 'branches-ignore'].filter((filter) => Object.hasOwn(config, filter))
    : [];
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

  // The setup-go count below would also break if this job were deleted, but it
  // would break citing step counts. Assert the thing we actually care about so
  // the failure names it: the path-portability suites must run on Windows.
  it('should run the path-sensitive Go suites on Windows', () => {
    const testYml = readFileSync(resolve(workflowsDir, 'test.yml'), 'utf-8');

    expect(testYml).toMatch(/runs-on:\s*windows-latest/);
    for (const pkg of ['./internal/filesystem', './internal/runhistory', './internal/workspace']) {
      expect(testYml).toContain(pkg);
    }
  });

  // `pull_request.branches` matches the PR's BASE branch, so a [main, develop]
  // filter silently gives stacked PRs zero checks -- no red X, just a mergeable
  // "no checks reported". Nothing else fails when this regresses, so assert it
  // for every workflow file, current or future. The three CI workflows also
  // may not path-filter: branch protection requires their checks, and a
  // filtered-out PR never reports them -- it would sit "Expected" forever and
  // be unmergeable.
  it('should run the CI workflows on pull requests regardless of base branch', () => {
    for (const file of ['test.yml', 'build.yml', 'lint.yml']) {
      const content = readFileSync(resolve(workflowsDir, file), 'utf-8');
      const events = workflowEvents(content);
      const pullRequest = events.pull_request;

      expect({ file, hasPullRequestTrigger: Object.hasOwn(events, 'pull_request') }).toEqual({
        file,
        hasPullRequestTrigger: true,
      });
      expect({
        file,
        pathFilters: pullRequest
          ? ['paths', 'paths-ignore'].filter((filter) => Object.hasOwn(pullRequest, filter))
          : [],
      }).toEqual({ file, pathFilters: [] });
    }

    for (const file of readdirSync(workflowsDir).filter((entry) => /\.ya?ml$/.test(entry))) {
      const content = readFileSync(resolve(workflowsDir, file), 'utf-8');

      expect({
        file,
        baseBranchFilters: workflowBranchFilters(content, 'pull_request').length,
      }).toEqual({ file, baseBranchFilters: 0 });
    }
  });

  it.each([
    {
      format: 'a quoted filter key',
      content: "name: fixture\non:\n  pull_request:\n    'branches': [main, develop]\n",
      filter: 'branches',
    },
    {
      format: 'CRLF line endings',
      content: ['name: fixture', 'on:', '  pull_request:', '    branches-ignore: [main]'].join(
        '\r\n'
      ),
      filter: 'branches-ignore',
    },
  ])('should detect pull-request branch filters with $format', ({ content, filter }) => {
    expect(workflowBranchFilters(content, 'pull_request')).toEqual([filter]);
  });

  // Counterpart to the filter above: `push` must stay scoped to the long-lived
  // branches. Widening it would run every feature-branch push twice -- once for
  // the push, once for the PR's synchronize event.
  it('should keep the push trigger scoped to the long-lived branches', () => {
    for (const file of ['test.yml', 'build.yml', 'lint.yml']) {
      const content = readFileSync(resolve(workflowsDir, file), 'utf-8');
      const push = workflowEvents(content).push;

      expect({ file, branches: push?.branches }).toEqual({
        file,
        branches: ['main', 'develop'],
      });
    }
  });

  it('should resolve every setup-go step from the Go version required by go.mod', () => {
    const goMod = readFileSync(resolve(rootDir, 'go.mod'), 'utf-8');
    const goVersion = goMod.match(/^go\s+(\d+\.\d+)/m)?.[1];
    const workflowFiles = readdirSync(workflowsDir).filter((file) => /\.ya?ml$/.test(file));
    const expectedSetupGoSteps: Record<string, number> = {
      'build.yml': 1,
      'lint.yml': 1,
      'release.yml': 3,
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

  it('should pin workflow wails3 installs to the module version', () => {
    const goMod = readFileSync(resolve(rootDir, 'go.mod'), 'utf-8');
    const wailsVersion = goMod.match(/^\s*github\.com\/wailsapp\/wails\/v3\s+(v\S+)/m)?.[1];
    expect(wailsVersion).toBeDefined();

    const workflowFiles = readdirSync(workflowsDir).filter((file) => /\.ya?ml$/.test(file));
    const installVersions = workflowFiles.flatMap((file) => {
      const content = readFileSync(resolve(workflowsDir, file), 'utf-8');
      return [...content.matchAll(/github\.com\/wailsapp\/wails\/v3\/cmd\/wails3@(\S+)/g)].map(
        (m) => m[1]
      );
    });
    expect(installVersions.length).toBeGreaterThan(0);
    expect(new Set(installVersions)).toEqual(new Set([wailsVersion]));
  });

  it('should pin @wailsio/runtime to the wails module version exactly', () => {
    const goMod = readFileSync(resolve(rootDir, 'go.mod'), 'utf-8');
    const wailsVersion = goMod.match(/^\s*github\.com\/wailsapp\/wails\/v3\s+(v\S+)/m)?.[1];
    const npmVersion = wailsVersion?.replace(/^v/, '');

    const pkg = JSON.parse(readFileSync(resolve(rootDir, 'frontend/package.json'), 'utf-8'));
    expect(pkg.dependencies['@wailsio/runtime']).toBe(npmVersion);

    const lock = JSON.parse(readFileSync(resolve(rootDir, 'frontend/package-lock.json'), 'utf-8'));
    expect(lock.packages['node_modules/@wailsio/runtime'].version).toBe(npmVersion);
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

  it('should feed build/config.yml to the changelog script', () => {
    const releaseYml = readFileSync(resolve(workflowsDir, 'release.yml'), 'utf-8');
    expect(releaseYml).toContain('build/config.yml');
    expect(releaseYml).not.toContain('wails.json');
  });

  it('should keep dispatch read-only and publish only from tag pushes', () => {
    const releaseYml = readFileSync(resolve(workflowsDir, 'release.yml'), 'utf-8');
    const workflow = parse(releaseYml) as {
      on?: { workflow_dispatch?: { inputs?: Record<string, unknown> } };
      permissions?: Record<string, string>;
      jobs?: Record<string, { if?: string; permissions?: Record<string, string> }>;
    };

    expect(workflow.on?.workflow_dispatch?.inputs).toHaveProperty('release_tag');
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs?.release?.if).toBe("github.event_name == 'push'");
    expect(workflow.jobs?.release?.permissions).toEqual({ contents: 'write' });
  });

  it('should verify archive root entries', () => {
    const releaseYml = readFileSync(resolve(workflowsDir, 'release.yml'), 'utf-8');
    expect(releaseYml).toContain('.github/scripts/verify-archive-roots.sh');
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

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

  it('should test the backend with the Go version required by go.mod', () => {
    const goMod = readFileSync(resolve(rootDir, 'go.mod'), 'utf-8');
    const goVersion = goMod.match(/^go\s+(\d+\.\d+)/m)?.[1];
    const workflowFiles = readdirSync(workflowsDir).filter((file) => /\.ya?ml$/.test(file));
    const configuredVersions = workflowFiles.flatMap((file) => {
      const content = readFileSync(resolve(workflowsDir, file), 'utf-8');
      return [...content.matchAll(/go-version:\s*['"]?([^'"\s]+)/g)].map((match) => match[1]);
    });

    expect(goVersion).toBeDefined();
    expect(configuredVersions.length).toBeGreaterThan(0);
    expect(new Set(configuredVersions)).toEqual(new Set([goVersion]));
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

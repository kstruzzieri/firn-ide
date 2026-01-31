/**
 * Test: Linting and Formatting Configuration
 *
 * These tests verify ESLint and Prettier are properly configured.
 * TDD: Written first to define expected behavior.
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';

const rootDir = resolve(__dirname, '../..');

describe('ESLint Configuration', () => {
  it('should have eslint.config.js file', () => {
    expect(existsSync(resolve(rootDir, 'eslint.config.js'))).toBe(true);
  });

  it('should run eslint without errors on clean code', () => {
    // This will throw if eslint fails
    expect(() => {
      execFileSync('npm', ['run', 'lint'], { cwd: rootDir, stdio: 'pipe' });
    }).not.toThrow();
  });
});

describe('Prettier Configuration', () => {
  it('should have .prettierrc file', () => {
    expect(existsSync(resolve(rootDir, '.prettierrc'))).toBe(true);
  });

  it('should have .prettierignore file', () => {
    expect(existsSync(resolve(rootDir, '.prettierignore'))).toBe(true);
  });

  it('should pass format check on all files', () => {
    expect(() => {
      execFileSync('npm', ['run', 'format:check'], { cwd: rootDir, stdio: 'pipe' });
    }).not.toThrow();
  });
});

describe('Husky Pre-commit Hook', () => {
  it('should have husky installed at root', () => {
    expect(existsSync(resolve(rootDir, '../.husky'))).toBe(true);
  });

  it('should have pre-commit hook configured', () => {
    expect(existsSync(resolve(rootDir, '../.husky/pre-commit'))).toBe(true);
  });
});

describe('NPM Scripts', () => {
  it('should have lint script', () => {
    const pkg = require(resolve(rootDir, 'package.json'));
    expect(pkg.scripts.lint).toBeDefined();
  });

  it('should have lint:fix script', () => {
    const pkg = require(resolve(rootDir, 'package.json'));
    expect(pkg.scripts['lint:fix']).toBeDefined();
  });

  it('should have format script', () => {
    const pkg = require(resolve(rootDir, 'package.json'));
    expect(pkg.scripts.format).toBeDefined();
  });

  it('should have format:check script', () => {
    const pkg = require(resolve(rootDir, 'package.json'));
    expect(pkg.scripts['format:check']).toBeDefined();
  });
});

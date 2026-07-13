import { createHash } from 'crypto';
import { spawnSync, execFileSync } from 'child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const rootDir = resolve(__dirname, '../../..');
const releaseScriptsDir = resolve(rootDir, '.github/scripts');

function withTempDir(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'firn-release-test-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeExecutable(path: string, content: string) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

describe('release changelog extraction', () => {
  const script = resolve(releaseScriptsDir, 'extract-changelog.sh');
  const changelog = resolve(rootDir, 'CHANGELOG.md');
  const packageJson = resolve(rootDir, 'frontend/package.json');
  const wailsJson = resolve(rootDir, 'wails.json');

  it('extracts the requested stable section without bleeding into the prior release', () => {
    withTempDir((dir) => {
      const output = join(dir, 'notes.md');

      execFileSync('sh', [script, 'v0.11.0-rc.1', changelog, output, packageJson, wailsJson]);

      const notes = readFileSync(output, 'utf8');
      expect(notes.trim()).not.toBe('');
      expect(notes).toContain('Stabilization release');
      expect(notes).not.toMatch(/^## \[/m);
      expect(notes).not.toContain('Milestone 7: Git integration');
    });
  });

  it('rejects a final tag while its changelog date is Pending', () => {
    withTempDir((dir) => {
      // Use a fixture rather than the live CHANGELOG so the test stays valid
      // once a release dates its own entry.
      const pendingChangelog = join(dir, 'CHANGELOG.md');
      writeFileSync(
        pendingChangelog,
        '# Changelog\n\n## [0.11.0] - Pending\n\nFixture entry.\n\n## [0.10.0] - 2026-07-08\n\nPrior.\n'
      );
      const result = spawnSync(
        'sh',
        [script, 'v0.11.0', pendingChangelog, join(dir, 'notes.md'), packageJson, wailsJson],
        { encoding: 'utf8' }
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('replace Pending with the release date');
    });
  });

  it('accepts a final tag once the changelog entry is dated', () => {
    withTempDir((dir) => {
      const output = join(dir, 'notes.md');

      execFileSync('sh', [script, 'v0.11.0', changelog, output, packageJson, wailsJson]);

      const notes = readFileSync(output, 'utf8');
      expect(notes.trim()).not.toBe('');
      expect(notes).toContain('Stabilization release');
    });
  });

  it('rejects release metadata that does not match the tag version', () => {
    withTempDir((dir) => {
      const stalePackage = join(dir, 'package.json');
      writeFileSync(stalePackage, '{"version":"0.10.0"}\n');
      const result = spawnSync(
        'sh',
        [script, 'v0.11.0-rc.1', changelog, join(dir, 'notes.md'), stalePackage, wailsJson],
        { encoding: 'utf8' }
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('package version 0.10.0 does not match tag v0.11.0-rc.1');
    });
  });

  it('rejects a Wails product version that does not match the tag', () => {
    withTempDir((dir) => {
      const staleWails = join(dir, 'wails.json');
      writeFileSync(staleWails, '{\n  "info": {\n    "productVersion": "1.0.0"\n  }\n}\n');
      const result = spawnSync(
        'sh',
        [script, 'v0.11.0-rc.1', changelog, join(dir, 'notes.md'), packageJson, staleWails],
        { encoding: 'utf8' }
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('wails productVersion 1.0.0 does not match tag v0.11.0-rc.1');
    });
  });
});

describe('release version consistency', () => {
  it('keeps the Wails product version in lockstep with the frontend package version', () => {
    const packageVersion = JSON.parse(
      readFileSync(resolve(rootDir, 'frontend/package.json'), 'utf8')
    ).version;
    const wailsProductVersion = JSON.parse(readFileSync(resolve(rootDir, 'wails.json'), 'utf8'))
      .info?.productVersion;

    expect(wailsProductVersion).toBe(packageVersion);
  });
});

describe('release checksums', () => {
  it('generates one deterministic SHA-256 entry per release archive', () => {
    withTempDir((dir) => {
      const artifacts = join(dir, 'artifacts');
      mkdirSync(join(artifacts, 'macos'), { recursive: true });
      mkdirSync(join(artifacts, 'linux'), { recursive: true });
      const files = [
        ['macos/Firn-macos-arm64.zip', 'mac'],
        ['linux/Firn-linux-amd64.tar.gz', 'linux'],
      ] as const;
      for (const [name, content] of files) writeFileSync(join(artifacts, name), content);
      const output = join(dir, 'SHA256SUMS');

      execFileSync('sh', [resolve(releaseScriptsDir, 'generate-checksums.sh'), artifacts, output]);

      const lines = readFileSync(output, 'utf8').trim().split('\n');
      expect(lines).toEqual(
        [...files]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, content]) => {
            const digest = createHash('sha256').update(content).digest('hex');
            return `${digest}  ${name.split('/').at(-1)}`;
          })
      );
    });
  });
});

describe('installer integrity verification', () => {
  const ASSET_NAME = 'Firn-linux-amd64.tar.gz';

  // Stub uname (report Linux/amd64), curl (serve the fixture asset + manifest),
  // and tar (record that extraction was reached). tar exits non-zero on purpose
  // so the run stops at extraction regardless of the host's install target.
  function writeLinuxInstallerStubs(bin: string) {
    writeExecutable(
      join(bin, 'uname'),
      '#!/bin/sh\nif [ "$1" = "-s" ]; then echo Linux; else echo x86_64; fi\n'
    );
    writeExecutable(
      join(bin, 'curl'),
      `#!/bin/sh
out=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift 2 ;;
    -*) shift ;;
    *) url=$1; shift ;;
  esac
done
case "$url" in
  *SHA256SUMS) cp "$FIXTURE_MANIFEST" "$out" ;;
  *) cp "$FIXTURE_ASSET" "$out" ;;
esac
`
    );
    writeExecutable(join(bin, 'tar'), '#!/bin/sh\ntouch "$TAR_SENTINEL"\nexit 1\n');
  }

  function runInstaller(dir: string, assetContent: string, manifestBody: string) {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const asset = join(dir, 'asset.tar.gz');
    const manifest = join(dir, 'SHA256SUMS');
    const tarSentinel = join(dir, 'tar-called');
    writeFileSync(asset, assetContent);
    writeFileSync(manifest, manifestBody);
    writeLinuxInstallerStubs(bin);

    const result = spawnSync('sh', [resolve(rootDir, 'install.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FIRN_VERSION: 'v0.11.0',
        FIXTURE_ASSET: asset,
        FIXTURE_MANIFEST: manifest,
        TAR_SENTINEL: tarSentinel,
      },
    });

    return { result, tarReached: existsSync(tarSentinel) };
  }

  function sha256(content: string) {
    return createHash('sha256').update(content).digest('hex');
  }

  it('rejects a checksum mismatch before extracting the downloaded asset', () => {
    withTempDir((dir) => {
      const { result, tarReached } = runInstaller(
        dir,
        'tampered archive',
        `${'0'.repeat(64)}  ${ASSET_NAME}\n`
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('checksum mismatch');
      expect(tarReached).toBe(false);
    });
  });

  it('rejects a manifest with no entry for the requested asset', () => {
    withTempDir((dir) => {
      const asset = 'valid archive';
      const { result, tarReached } = runInstaller(
        dir,
        asset,
        `${sha256(asset)}  Firn-macos-arm64.zip\n`
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('checksum entry missing or duplicated');
      expect(tarReached).toBe(false);
    });
  });

  it('proceeds to extraction once the checksum matches', () => {
    withTempDir((dir) => {
      const asset = 'valid archive';
      const { result, tarReached } = runInstaller(dir, asset, `${sha256(asset)}  ${ASSET_NAME}\n`);

      expect(tarReached).toBe(true);
      expect(result.stderr).not.toContain('checksum mismatch');
      expect(result.stderr).toContain('extract failed');
    });
  });
});

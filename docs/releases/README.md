# Releases

Firn ships a minor release every three weeks. Each release has a contract in
this directory, `vX.Y.Z.md`, and a GitHub milestone of the same name. The
contract is the source of truth. The milestone mirrors its In and Stretch lists
so every issue shows the release it targets. Contracts are edited only on
`develop`; a release branch keeps the copy it was cut with.

## The train

- A release ships on a Tuesday, three weeks after the one before it.
- Seven days before that, the release freezes: `release/vX.Y.Z` is cut from
  `develop` and the packaged build is used daily for the rest of the week.
- The `protect-release-branches` ruleset covers `release/*`: no force-push, no
  deletion, and every change needs the six required checks listed under
  [Exit criteria](#exit-criteria). A push to a release branch runs no CI of its
  own, so changes reach it through pull requests.
- `develop` never closes. Work merged to `develop` after a freeze ships in the
  next train.
- The date holds. An In item that has not merged by the freeze moves to the
  next train through an amendment that names the reason.
- A patch release (`vX.Y.Z+1`) is cut only for a regression against the
  previous release or for data loss.

## What a contract fixes

- **In**: committed scope, by issue number, sized against measured capacity.
- **Stretch**: ships only if it merges to `develop` before the freeze.
  Otherwise it rolls to the next train's Stretch list.
- **Out**: everything not listed under In or Stretch. The contract names the
  notable exclusions and where each one goes.
- **Known issues**: defects that ship in the release, each with its target.
- **Exit criteria**: the list below, plus any the contract adds.
- **Dates**: the freeze and the release.

## Changing a contract

Before the freeze, a contract changes only by an owner decision, recorded in its
Amendments table with the date, the change and the reason.

After the freeze, a release branch takes only release administration (the
version bump, the changelog and its date, the README's install examples and
release status) and fixes for a regression against the previous release or for
data loss, each as a pull request into `release/vX.Y.Z`. Everything else waits
for the next train. A contract that departs from these rules names the exception
and the reason.

## Exit criteria

Every release meets all of these before it is tagged:

1. The release pull request into `main` passes every required check (Frontend
   Tests, Backend Tests, Windows Filesystem Tests, Build Verification, ESLint,
   golangci-lint). The release workflow builds and verifies the archives but
   runs none of these, so this is the test gate.
2. The version gate passes: the bumped version agrees across the files listed
   under [Version files](#version-files), and `releaseScripts.test.ts` is green.
3. A release workflow dry run succeeds on the release branch
   (`gh workflow run release.yml --ref release/vX.Y.Z -f release_tag=vX.Y.Z-rc.N`):
   Build macOS (both architectures), Build Linux, Build Windows and Verify
   Artifacts pass, and `Create Release` is skipped. Pushing an `-rc` tag is not
   a dry run: the tag trigger publishes a prerelease.
4. An external review (Codex) of the release diff and the changelog, plus the
   project's `/code-review`, has every finding fixed or answered.
5. The packaged macOS app (`wails3 task darwin:package`) is used daily during
   the freeze week, and a final smoke pass covers opening a workspace, editing
   and saving, the terminal, running a profile, the Git panel, and the Golem
   chat and configuration views.
6. A VoiceOver pass over the surfaces the release changed finds nothing that
   regressed against the previous release. Defects that already shipped are
   listed as known issues, not treated as failures.
7. `CHANGELOG.md` covers every user-facing pull request, carries a dated
   `## [X.Y.Z]` section with its known issues, and advances the comparison
   links at the bottom of the file. Once dated, the extractor passes with the
   final tag:
   `sh .github/scripts/extract-changelog.sh vX.Y.Z CHANGELOG.md /tmp/notes.md frontend/package.json build/config.yml`.
   The Jest case uses an `-rc` tag, which skips the date check.
8. Every criterion ran against the final candidate, the release branch head
   that step 5 merges. Criteria 3 to 6 may instead have run on an earlier
   commit whose only difference from the candidate is the Date step's
   replacement of `Pending` with the release date. The release pull request
   records both full SHAs and links the checks, dry run, reviews and smoke
   pass. Any other later change, including any other `CHANGELOG.md` edit,
   reruns the criteria it affects.

## Release steps

1. **Freeze.** Push the agreed commit, by its full SHA, as the release branch:
   `git push origin <sha>:refs/heads/release/vX.Y.Z`.
2. **Prepare.** A pull request into `release/vX.Y.Z` bumps the version, curates
   the changelog under `## [X.Y.Z] - Pending`, and points the README's install
   examples and release status at `vX.Y.Z`. The bump and the changelog section
   land in the same commit, because `releaseScripts.test.ts` extracts the
   section for the bumped version.
3. **Soak.** Run exit criteria 3 to 6. Fixes arrive as pull requests into the
   release branch.
4. **Date.** A pull request into the release branch replaces `Pending` with
   the release date and changes nothing else; the final-tag extractor then
   passes (criterion 7).
5. **Release.** Merge a pull request from `release/vX.Y.Z` into `main` with a
   merge commit, not a squash. Check that the merge commit's tree matches the
   candidate (`git diff <candidate> <merge>` prints nothing), then tag `vX.Y.Z`
   on it and push the tag. The release workflow publishes the four archives and
   `SHA256SUMS`; check them and the packaged version before marking the
   contract Released.
6. **Back-merge.** Merge a pull request from `main` into `develop` with a merge
   commit, so every freeze-week fix and the version bump reach `develop`. Check
   `CHANGELOG.md` before merging, even when Git reports no conflict: the
   `## [X.Y.Z]` section matches the tagged file, entries merged to `develop`
   after the freeze stay under `## [Unreleased]`, and the `[Unreleased]` link
   compares `vX.Y.Z...HEAD`. Resolve a conflict on a branch cut from `develop`
   that merges `main`, never on `main`.
7. **Close out.** On `develop`, point the roadmap's release status at the new
   tag, mark the contract Released, and close the milestone.

## Version files

Edit these by hand, as v0.12.0 did. `wails3 task common:update:build-assets`
also regenerates the four build assets, but it writes a three-part Windows
manifest version that the lockstep test rejects, plus assets for targets this
project does not keep; see
[build/README.md](../../build/README.md#regenerating-platform-metadata).

| File | Field |
| --- | --- |
| `build/config.yml` | `info.version` (the source of truth) |
| `frontend/package.json` | `version` |
| `frontend/package-lock.json` | the top-level `version` and `packages[""].version` only; no test guards them |
| `build/darwin/Info.plist` | `CFBundleShortVersionString`, `CFBundleVersion` |
| `build/darwin/Info.dev.plist` | `CFBundleShortVersionString`, `CFBundleVersion` |
| `build/windows/info.json` | `fixed.file_version`, `info.0000.ProductVersion` |
| `build/windows/wails.exe.manifest` | `assemblyIdentity` version, as `X.Y.Z.0` |
| `CHANGELOG.md` | the release section and the comparison links |

The root `package.json` is a private tooling manifest that no gate reads; leave
it alone.

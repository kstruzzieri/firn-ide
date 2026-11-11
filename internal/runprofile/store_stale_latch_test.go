package runprofile

import (
	"bytes"
	"encoding/json"
	"errors"
	"firn/internal/filesystem"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

// Issue #397: a run-profiles.json that changed on disk after it was loaded (a
// branch checkout, a merge, a hand edit) must never be replaced by the profiles
// this store still holds in memory. Issue #442: a run-recency sidecar that
// could not be read must never be replaced by the empty recency that failed
// read leaves behind. Like the #359 tests these drive the production
// constructor over the real filesystem.

const staleOtherBranch = `{
  "version": 3,
  "profiles": [
    {"id": "other-branch", "name": "Other branch", "type": "single", "source": "user", "command": "echo other"}
  ]
}
`

func staleValidProfiles() []byte {
	return []byte(strings.Replace(latchSavedProfiles, "%d", "3", 1))
}

// staleSet puts data at path, or removes the file when data is nil.
func staleSet(t *testing.T, path string, data []byte) {
	t.Helper()
	if data == nil {
		if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
			t.Fatal(err)
		}
		return
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

// staleAssertFile fails unless path holds exactly want (nil: no file).
func staleAssertFile(t *testing.T, path string, want []byte, what string) {
	t.Helper()
	got, err := os.ReadFile(path)
	if want == nil {
		if !errors.Is(err, fs.ErrNotExist) {
			t.Fatalf("%s: the file must stay absent, got err=%v content:\n%s", what, err, got)
		}
		return
	}
	if err != nil {
		t.Fatalf("%s: %v", what, err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("%s: the file was rewritten:\n%s", what, got)
	}
}

func skipWithoutPosixModes(t *testing.T) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("Windows os.Chmod models only the read-only attribute, not POSIX mode bits")
	}
	if os.Geteuid() == 0 {
		t.Skip("root ignores file permissions")
	}
}

type staleChange struct {
	name   string
	atLoad []byte // nil: no file when Firn loaded
	after  []byte // nil: the file was removed afterwards
}

func staleChanges() []staleChange {
	return []staleChange{
		{"rewritten", staleValidProfiles(), []byte(staleOtherBranch)},
		{"removed", staleValidProfiles(), nil},
		{"created", nil, []byte(staleOtherBranch)},
	}
}

func TestIssue397ExternalChangeSurvivesWrites(t *testing.T) {
	for _, c := range staleChanges() {
		for _, a := range latchActions {
			t.Run(c.name+"/"+a.name, func(t *testing.T) {
				root := latchRepo(t)
				path := latchProfilesPath(root)
				staleSet(t, path, c.atLoad)
				m := latchLoad(t, root)
				staleSet(t, path, c.after)

				err := a.run(t, m)

				staleAssertFile(t, path, c.after, a.name)
				if err == nil {
					t.Fatalf("%s must refuse after the profiles file changed on disk", a.name)
				}
				for _, want := range []string{path, "changed on disk", "Reload in the Run Profiles panel"} {
					if !strings.Contains(err.Error(), want) {
						t.Errorf("refusal %q does not name %q", err, want)
					}
				}
			})
		}
	}
}

// Delete routes through the same write; the profile it would remove is one the
// other branch's file no longer lists.
func TestIssue397ExternalChangeSurvivesDelete(t *testing.T) {
	root := latchRepo(t)
	path := latchProfilesPath(root)
	staleSet(t, path, staleValidProfiles())
	m := latchLoad(t, root)
	staleSet(t, path, []byte(staleOtherBranch))

	err := m.DeleteProfile("keep-a")

	staleAssertFile(t, path, []byte(staleOtherBranch), "DeleteProfile")
	if err == nil || !strings.Contains(err.Error(), "changed on disk") {
		t.Fatalf("DeleteProfile must refuse after the profiles file changed on disk, got %v", err)
	}
}

// The panel draws Reload only while the snapshot carries a load warning, so a
// refusal has to reach the snapshot or the remedy it names is unreachable.
func TestIssue397SnapshotCarriesChangeNoticeUntilReload(t *testing.T) {
	root := latchRepo(t)
	path := latchProfilesPath(root)
	staleSet(t, path, staleValidProfiles())
	m := latchLoad(t, root)
	if w := m.Snapshot().LoadWarnings; len(w) != 0 {
		t.Fatalf("clean load produced warnings: %q", w)
	}
	staleSet(t, path, []byte(staleOtherBranch))

	if _, err := m.SaveProfile(latchUserProfile()); err == nil {
		t.Fatal("save must refuse after the profiles file changed on disk")
	}
	// A second refused write must not stack a second notice.
	if err := m.PinProfile(latchDetectedID(t, m)); err == nil {
		t.Fatal("pin must refuse until the changed file is reloaded")
	}

	warnings := m.Snapshot().LoadWarnings
	if len(warnings) != 1 {
		t.Fatalf("want exactly one notice, got %q", warnings)
	}
	for _, want := range []string{path, "changed on disk", "Reload in the Run Profiles panel"} {
		if !strings.Contains(warnings[0], want) {
			t.Errorf("notice %q does not name %q", warnings[0], want)
		}
	}
	var name string
	for _, p := range m.GetAllProfiles() {
		if p.Source == ProfileSourceDetected {
			name = p.WorkspaceName
			break
		}
	}
	if prefix := fmt.Sprintf("workspace %q: ", name); name == "" || !strings.HasPrefix(warnings[0], prefix) {
		t.Errorf("notice %q does not start with %q", warnings[0], prefix)
	}

	if err := m.Load(); err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got := m.Snapshot().LoadWarnings; got == nil || len(got) != 0 {
		t.Fatalf("a reload must leave an empty, non-nil warning list, got %#v", got)
	}
	if _, err := m.SaveProfile(latchUserProfile()); err != nil {
		t.Fatalf("save after reload: %v", err)
	}
	var pf ProfilesFile
	data, _ := os.ReadFile(path)
	if err := json.Unmarshal(data, &pf); err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, p := range pf.Profiles {
		ids[p.ID] = true
	}
	if len(pf.Profiles) != 2 || !ids["other-branch"] || !ids["new-user"] {
		t.Fatalf("want the other branch's profile plus the new one, got %s", data)
	}
}

// A file that can no longer be read cannot be confirmed unchanged, so the write
// is refused rather than made blind.
func TestIssue397UnreadableAfterLoadSurvivesSave(t *testing.T) {
	skipWithoutPosixModes(t)
	root := latchRepo(t)
	path := latchProfilesPath(root)
	staleSet(t, path, staleValidProfiles())
	m := latchLoad(t, root)
	if err := os.Chmod(path, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(path, 0o644) })

	_, err := m.SaveProfile(latchUserProfile())

	if cerr := os.Chmod(path, 0o644); cerr != nil {
		t.Fatal(cerr)
	}
	staleAssertFile(t, path, staleValidProfiles(), "SaveProfile")
	if err == nil {
		t.Fatal("save must refuse while the profiles file cannot be re-read")
	}
	for _, want := range []string{path, "Restore read access"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("refusal %q does not name %q", err, want)
		}
	}
	// Nothing is known to have changed, so once the file is readable again the
	// same save goes through without a Reload.
	if _, err := m.SaveProfile(latchUserProfile()); err != nil {
		t.Fatalf("save after read access returned: %v", err)
	}
}

// Guard, not a red-first test: the store's own writes move the baseline, so a
// run of ordinary edits never trips the check.
func TestIssue397OwnWritesDoNotLatch(t *testing.T) {
	root := latchRepo(t)
	staleSet(t, latchProfilesPath(root), staleValidProfiles())
	m := latchLoad(t, root)

	if _, err := m.SaveProfile(latchUserProfile()); err != nil {
		t.Fatalf("save: %v", err)
	}
	if err := m.AdoptProfile(latchDetectedID(t, m)); err != nil {
		t.Fatalf("adopt after save: %v", err)
	}
	if err := m.PinProfile(latchDetectedID(t, m)); err != nil {
		t.Fatalf("pin after adopt: %v", err)
	}
	if err := m.DeleteProfile("keep-a"); err != nil {
		t.Fatalf("delete after pin: %v", err)
	}
	if w := m.Snapshot().LoadWarnings; len(w) != 0 {
		t.Fatalf("ordinary edits produced warnings: %q", w)
	}
}

type sidecarDamage struct {
	name   string
	data   []byte
	chmod  bool   // make the sidecar unreadable instead of corrupting its content
	remedy string // the remedy the notice and the refusal must name
}

func sidecarDamages(t *testing.T) []sidecarDamage {
	t.Helper()
	valid, err := json.Marshal(RecencyFile{Version: recencyFileVersion, Recency: map[string]int64{"keep-a": 1, "keep-b": 2}})
	if err != nil {
		t.Fatal(err)
	}
	return []sidecarDamage{
		{"conflict marker", append(append([]byte{}, valid...), []byte("\n>>>>>>> feature/branch\n")...), false, "Fix or remove the file"},
		{"unreadable", valid, true, "Restore read access"},
	}
}

func TestIssue442UnreadableSidecarSurvivesRun(t *testing.T) {
	for _, c := range sidecarDamages(t) {
		t.Run(c.name, func(t *testing.T) {
			if c.chmod {
				skipWithoutPosixModes(t)
			}
			root := latchRepo(t)
			staleSet(t, latchProfilesPath(root), staleValidProfiles())
			rpath := latchRecencyPath(root)
			staleSet(t, rpath, c.data)
			if c.chmod {
				if err := os.Chmod(rpath, 0); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = os.Chmod(rpath, 0o644) })
			}

			m := latchLoad(t, root)
			warnings := m.Snapshot().LoadWarnings
			err := m.RecordRun(latchDetectedID(t, m), 99)

			if c.chmod {
				if cerr := os.Chmod(rpath, 0o644); cerr != nil {
					t.Fatal(cerr)
				}
			}
			staleAssertFile(t, rpath, c.data, "RecordRun")
			if err == nil {
				t.Fatal("RecordRun must refuse while the sidecar is unreadable")
			}
			for _, want := range []string{rpath, c.remedy, "Reload in the Run Profiles panel"} {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("refusal %q does not name %q", err, want)
				}
			}
			// The panel says why recency is not being recorded, and how to fix it.
			if len(warnings) != 1 {
				t.Fatalf("want exactly one notice, got %q", warnings)
			}
			for _, want := range []string{rpath, "last-run times are not being recorded", c.remedy, "Reload in the Run Profiles panel"} {
				if !strings.Contains(warnings[0], want) {
					t.Errorf("notice %q does not name %q", warnings[0], want)
				}
			}
			// Profile definitions are a different file and stay writable.
			if _, err := m.SaveProfile(latchUserProfile()); err != nil {
				t.Fatalf("save while the sidecar is unreadable: %v", err)
			}
		})
	}
}

func TestIssue442FixedSidecarAndReloadRecordsAgain(t *testing.T) {
	root := latchRepo(t)
	staleSet(t, latchProfilesPath(root), staleValidProfiles())
	rpath := latchRecencyPath(root)
	staleSet(t, rpath, sidecarDamages(t)[0].data)
	m := latchLoad(t, root)
	detected := latchDetectedID(t, m)
	if err := m.RecordRun(detected, 99); err == nil {
		t.Fatal("RecordRun must refuse before the sidecar is fixed")
	}

	latchSeedRecency(t, root, map[string]int64{"keep-a": 1, "keep-b": 2})
	if err := m.Load(); err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got := m.Snapshot().LoadWarnings; got == nil || len(got) != 0 {
		t.Fatalf("a reload of the fixed sidecar must leave an empty, non-nil warning list, got %#v", got)
	}
	if err := m.RecordRun(detected, 99); err != nil {
		t.Fatalf("RecordRun after fix and reload: %v", err)
	}
	latchAssertRecency(t, root, map[string]int64{"keep-a": 1, "keep-b": 2, detected: 99})
}

// Load's own prune writes the sidecar too. A pre-split profiles file can still
// embed recency for a profile that no longer exists, which is the one case
// where the prune has something to drop while the sidecar is unreadable.
func TestIssue442LoadPruneKeepsUnreadableSidecar(t *testing.T) {
	root := latchRepo(t)
	staleSet(t, latchProfilesPath(root), []byte(`{
  "version": 3,
  "profiles": [
    {"id": "keep-a", "name": "Keep A", "type": "single", "source": "user", "command": "echo a"}
  ],
  "profileState": {"gone": {"lastRunAt": 5}}
}
`))
	rpath := latchRecencyPath(root)
	damaged := sidecarDamages(t)[0].data
	staleSet(t, rpath, damaged)

	m := latchLoad(t, root)

	staleAssertFile(t, rpath, damaged, "Load")
	if w := m.Snapshot().LoadWarnings; len(w) != 1 {
		t.Fatalf("want the one sidecar notice and no prune failure, got %q", w)
	}
}

// An empty (or whitespace-only) sidecar holds no recency to preserve, so it is
// treated as absent, as an empty profiles file is (#332): no notice, and the
// next run is recorded. Latching on it would strand a file the next run used to
// repair by itself.
func TestIssue442EmptySidecarStillRecords(t *testing.T) {
	for _, content := range []string{"", "  \n"} {
		t.Run(strconv.Quote(content), func(t *testing.T) {
			root := latchRepo(t)
			staleSet(t, latchRecencyPath(root), []byte(content))
			m := latchLoad(t, root)
			if w := m.Warnings(); len(w) != 0 {
				t.Fatalf("empty sidecar produced warnings: %v", w)
			}
			detected := latchDetectedID(t, m)
			if err := m.RecordRun(detected, 99); err != nil {
				t.Fatalf("RecordRun with an empty sidecar: %v", err)
			}
			latchAssertRecency(t, root, map[string]int64{detected: 99})
		})
	}
}

// swapAfterFirstRead replaces the profiles file right after it is first read:
// the gap between Load reading a v1 file and writing its migration back.
type swapAfterFirstRead struct {
	filesystem.FileSystem
	with []byte
	done bool
}

func (f *swapAfterFirstRead) ReadFile(path string) ([]byte, error) {
	data, err := f.FileSystem.ReadFile(path)
	if !f.done && strings.HasSuffix(filepath.ToSlash(path), profilesFileName) {
		f.done = true
		if werr := os.WriteFile(path, f.with, 0o644); werr != nil {
			return nil, werr
		}
	}
	return data, err
}

// The profiles Load returns are stale once its own migration write was refused,
// so they must not decide which recency entries to prune: the file on disk now
// may name profiles this store has never seen.
func TestIssue397ChangeDuringMigrationKeepsRecencyAndWarnsOnce(t *testing.T) {
	root := latchRepo(t)
	path := latchProfilesPath(root)
	v1 := strings.Replace(latchSavedProfiles, "%d", "1", 1)
	if err := os.WriteFile(path, []byte(v1), 0o644); err != nil {
		t.Fatal(err)
	}
	latchSeedRecency(t, root, map[string]int64{"other-branch": 7})

	m := NewProjectManager(&swapAfterFirstRead{FileSystem: filesystem.NewOS(), with: []byte(staleOtherBranch)}, root)
	if err := m.Load(); err != nil {
		t.Fatalf("Load: %v", err)
	}

	staleAssertFile(t, path, []byte(staleOtherBranch), "the migration write-back")
	latchAssertRecency(t, root, map[string]int64{"other-branch": 7})
	w := m.Snapshot().LoadWarnings
	if len(w) != 1 || !strings.Contains(w[0], "changed on disk") || !strings.Contains(w[0], "Reload in the Run Profiles panel") {
		t.Fatalf("want exactly one change notice naming Reload, got %d: %q", len(w), w)
	}
}

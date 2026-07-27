package runhistory

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"firn/internal/filesystem"
	"github.com/google/uuid"
)

const phase2CValidIndexRecordJSON = `{"historyId":"01900000-0000-7000-8000-000000000001","kind":"ordinary","profileId":"build","profileName":"Build","state":"success","exitCode":0,"startedAt":1,"completedAt":2,"outputAvailable":true,"size":1,"modifiedAt":1}`

func TestStorePhase2C_RefusesSymlinkedArchiveDirectory(t *testing.T) {
	historyID, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("NewV7: %v", err)
	}
	tests := map[string]func(*Store) error{
		"Snapshot": func(store *Store) error {
			_, err := store.Snapshot("/repo")
			return err
		},
		"Append": func(store *Store) error {
			_, err := store.Append("/repo", phase2COrdinaryInput("build", 1, "secret"))
			return err
		},
		"ClearRecord": func(store *Store) error {
			return store.ClearRecord("/repo", historyID.String())
		},
		"ClearAll": func(store *Store) error {
			return store.ClearAll("/repo")
		},
	}
	for component := range map[string]struct{}{"firn": {}, "run-history": {}, "workspace": {}} {
		for name, operation := range tests {
			t.Run(component+"/"+name, func(t *testing.T) {
				if runtime.GOOS == "windows" {
					t.Skip("symlink permissions are not portable on Windows")
				}
				home := t.TempDir()
				target := t.TempDir()
				marker := filepath.Join(target, "outside")
				if err := os.WriteFile(marker, []byte("unchanged"), 0o600); err != nil {
					t.Fatalf("write marker: %v", err)
				}
				firnDir := filepath.Join(home, "firn")
				store := NewStore(filesystem.NewOS(), firnDir)
				dir, err := store.workspaceDir("/repo")
				if err != nil {
					t.Fatalf("workspaceDir: %v", err)
				}
				var symlinkPath string
				switch component {
				case "firn":
					symlinkPath = firnDir
				case "run-history":
					if err := os.MkdirAll(firnDir, 0o700); err != nil {
						t.Fatalf("MkdirAll(firn): %v", err)
					}
					symlinkPath = filepath.Dir(dir)
				case "workspace":
					if err := os.MkdirAll(filepath.Dir(dir), 0o700); err != nil {
						t.Fatalf("MkdirAll(run-history): %v", err)
					}
					symlinkPath = dir
				}
				if err := os.Symlink(target, symlinkPath); err != nil {
					t.Fatalf("Symlink: %v", err)
				}

				if err := operation(store); !errors.Is(err, filesystem.ErrUnsafePath) {
					t.Fatalf("%s error = %v, want ErrUnsafePath", name, err)
				}
				entries, err := os.ReadDir(target)
				if err != nil {
					t.Fatalf("ReadDir(target): %v", err)
				}
				if len(entries) != 1 || entries[0].Name() != "outside" {
					t.Fatalf("redirected target was modified: %#v", entries)
				}
			})
		}
	}
}

func TestStorePhase2C_RefusesSymlinkedOwnedFiles(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink permissions are not portable on Windows")
	}
	tests := []string{"index", "canonical", "temp"}
	for _, name := range tests {
		t.Run(name, func(t *testing.T) {
			home := t.TempDir()
			store := NewStore(filesystem.NewOS(), home)
			dir, err := store.workspaceDir("/repo")
			if err != nil {
				t.Fatalf("workspaceDir: %v", err)
			}
			if err := os.MkdirAll(dir, 0o700); err != nil {
				t.Fatalf("MkdirAll: %v", err)
			}
			target := filepath.Join(t.TempDir(), "outside")
			if err := os.WriteFile(target, []byte("unchanged"), 0o600); err != nil {
				t.Fatalf("write target: %v", err)
			}
			historyID, err := uuid.NewV7()
			if err != nil {
				t.Fatalf("NewV7: %v", err)
			}
			var path string
			switch name {
			case "index":
				path = filepath.Join(dir, "index.json")
			case "canonical":
				path = recordPath(dir, historyID.String())
			case "temp":
				path = recordPath(dir, historyID.String()) + ".0123456789abcdef"
			}
			if err := os.Symlink(target, path); err != nil {
				t.Fatalf("Symlink: %v", err)
			}

			if _, err := store.Snapshot("/repo"); !errors.Is(err, filesystem.ErrUnsafePath) {
				t.Fatalf("Snapshot error = %v, want ErrUnsafePath", err)
			}
			data, err := os.ReadFile(target)
			if err != nil {
				t.Fatalf("ReadFile(target): %v", err)
			}
			if string(data) != "unchanged" {
				t.Fatalf("redirected target was modified: %q", data)
			}
		})
	}
}

func TestStorePhase2C_RefusesOwnedDirectories(t *testing.T) {
	for _, name := range []string{"index", "canonical", "temp"} {
		t.Run(name, func(t *testing.T) {
			home := t.TempDir()
			store := NewStore(filesystem.NewOS(), home)
			dir, err := store.workspaceDir("/repo")
			if err != nil {
				t.Fatalf("workspaceDir: %v", err)
			}
			if err := os.MkdirAll(dir, 0o700); err != nil {
				t.Fatalf("MkdirAll: %v", err)
			}
			historyID, err := uuid.NewV7()
			if err != nil {
				t.Fatalf("NewV7: %v", err)
			}
			var path string
			switch name {
			case "index":
				path = filepath.Join(dir, "index.json")
			case "canonical":
				path = recordPath(dir, historyID.String())
			case "temp":
				path = recordPath(dir, historyID.String()) + ".0123456789abcdef"
			}
			if err := os.Mkdir(path, 0o700); err != nil {
				t.Fatalf("Mkdir(owned path): %v", err)
			}

			if _, err := store.Snapshot("/repo"); !errors.Is(err, filesystem.ErrUnsafePath) {
				t.Fatalf("Snapshot error = %v, want ErrUnsafePath", err)
			}
		})
	}
}

func TestStorePhase2C_FIFOsReturnPromptly(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("FIFOs are not portable on Windows")
	}
	mkfifo, err := exec.LookPath("mkfifo")
	if err != nil {
		t.Skip("mkfifo is unavailable")
	}
	tests := []string{"index.json", "canonical"}
	for _, name := range tests {
		t.Run(name, func(t *testing.T) {
			home := t.TempDir()
			store := NewStore(filesystem.NewOS(), home)
			dir, err := store.workspaceDir("/repo")
			if err != nil {
				t.Fatalf("workspaceDir: %v", err)
			}
			if err := os.MkdirAll(dir, 0o700); err != nil {
				t.Fatalf("MkdirAll: %v", err)
			}
			path := filepath.Join(dir, name)
			if name == "canonical" {
				historyID, err := uuid.NewV7()
				if err != nil {
					t.Fatalf("NewV7: %v", err)
				}
				path = recordPath(dir, historyID.String())
			}
			if output, err := exec.Command(mkfifo, path).CombinedOutput(); err != nil {
				t.Fatalf("mkfifo: %v: %s", err, output)
			}

			done := make(chan error, 1)
			go func() {
				_, err := store.Snapshot("/repo")
				done <- err
			}()
			select {
			case err := <-done:
				if !errors.Is(err, filesystem.ErrUnsafePath) {
					t.Fatalf("Snapshot error = %v, want ErrUnsafePath", err)
				}
			case <-time.After(500 * time.Millisecond):
				writer, openErr := os.OpenFile(path, os.O_WRONLY, 0)
				if openErr == nil {
					_ = writer.Close()
				}
				<-done
				t.Fatal("Snapshot blocked opening a FIFO")
			}
		})
	}
}

func TestStorePhase2C_CanonicalRecordLimitSelfHeals(t *testing.T) {
	home := t.TempDir()
	seed := NewStore(filesystem.NewOS(), home)
	seed.canonicalRecordLimit = 3
	for i := 1; i <= 3; i++ {
		if _, err := seed.Append("/repo", phase2COrdinaryInput("profile", int64(i), "saved")); err != nil {
			t.Fatalf("seed Append %d: %v", i, err)
		}
	}

	store := NewStore(filesystem.NewOS(), home)
	store.canonicalRecordLimit = 2
	snapshot, err := store.Snapshot("/repo")
	if err != nil {
		t.Fatalf("Snapshot one over limit: %v", err)
	}
	if len(snapshot.Summaries) != 2 ||
		snapshot.Summaries[0].CompletedAt != 2 ||
		snapshot.Summaries[1].CompletedAt != 3 {
		t.Fatalf("reconciled summaries = %#v, want newest two", snapshot.Summaries)
	}
	if _, err := store.Append("/repo", phase2COrdinaryInput("profile", 4, "saved")); err != nil {
		t.Fatalf("Append over limit: %v", err)
	}
	snapshot, err = store.Snapshot("/repo")
	if err != nil || len(snapshot.Summaries) != 2 || snapshot.Summaries[1].CompletedAt != 4 {
		t.Fatalf("post-Append Snapshot = %#v, err = %v", snapshot, err)
	}
	if err := store.ClearAll("/repo"); err != nil {
		t.Fatalf("ClearAll after pruning: %v", err)
	}
}

func TestStorePhase2C_DecodersRejectExcessiveCardinality(t *testing.T) {
	var record strings.Builder
	record.WriteString(`{"version":1,"historyId":"01900000-0000-7000-8000-000000000001","kind":"ordinary","profileId":"build","profileName":"Build","state":"completed","outputAvailable":true,"entries":[`)
	for i := 0; i < maxEntries+1; i++ {
		if i > 0 {
			record.WriteByte(',')
		}
		record.WriteString(`{"stream":"stdout","text":"x","timestamp":1}`)
	}
	record.WriteString(`]}`)
	if _, err := decodeRecord([]byte(record.String()), maxEntries); err == nil ||
		!strings.Contains(err.Error(), "more than") {
		t.Fatalf("record decoder cardinality error = %v", err)
	}

	var index strings.Builder
	index.WriteString(`{"version":1,"records":[`)
	for i := 0; i < maxCanonicalRecords+1; i++ {
		if i > 0 {
			index.WriteByte(',')
		}
		index.WriteString(phase2CValidIndexRecordJSON)
	}
	index.WriteString(`]}`)
	if _, err := decodeIndex([]byte(index.String()), maxCanonicalRecords); err == nil ||
		!strings.Contains(err.Error(), "more than") {
		t.Fatalf("index decoder cardinality error = %v", err)
	}
}

func TestStorePhase2C_DecodeIndexRejectsDuplicateRecordArrays(t *testing.T) {
	data := []byte(
		`{"version":1,"records":[` + phase2CValidIndexRecordJSON + `,` +
			phase2CValidIndexRecordJSON + `],"records":[` +
			phase2CValidIndexRecordJSON + `,` + phase2CValidIndexRecordJSON + `]}`,
	)
	if _, err := decodeIndex(data, 2); err == nil {
		t.Fatal("decodeIndex accepted duplicate records arrays that reset the cardinality limit")
	}
}

func TestStorePhase2C_DecoderRejectsInvalidDurableSchemas(t *testing.T) {
	valid := Record{
		Version: storeVersion,
		Summary: Summary{
			HistoryID:       "01900000-0000-7000-8000-000000000001",
			Kind:            RecordKindOrdinary,
			ProfileID:       "build",
			ProfileName:     "Build",
			State:           "completed",
			OutputAvailable: true,
		},
		WorkingDir: "/repo",
		Entries:    []OutputEntry{{Stream: "stdout", Text: "ok"}},
	}
	tests := map[string]Record{
		"invalid kind": func() Record {
			record := valid
			record.Kind = "unknown"
			return record
		}(),
		"oversized profile ID": func() Record {
			record := valid
			record.ProfileID = strings.Repeat("x", (4<<10)+1)
			return record
		}(),
		"compound rich payload": func() Record {
			record := valid
			record.Kind = RecordKindCompoundStep
			return record
		}(),
		"redacted rich payload": func() Record {
			record := valid
			record.OutputAvailable = false
			return record
		}(),
	}
	for name, record := range tests {
		t.Run(name, func(t *testing.T) {
			data, err := json.Marshal(record)
			if err != nil {
				t.Fatalf("Marshal: %v", err)
			}
			if _, err := decodeRecord(data, maxEntries); err == nil {
				t.Fatal("record decoder accepted invalid durable schema")
			}
		})
	}
}

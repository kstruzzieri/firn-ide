package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"firn/internal/filesystem"

	"github.com/kstruzzieri/go-llm/config"
)

// #524: a models.json Firn finds in its process working directory never
// expands ${NAME} api_key references, so a repository Firn was started inside
// cannot send an environment secret to the endpoint it names.

const (
	workdirSecretName   = "FIRN_524_SECRET"
	workdirSecretMarker = "firn-524-secret-marker"
)

// workdirAgentConfig is a valid agent config whose one provider carries apiKey.
func workdirAgentConfig(endpoint, apiKey string) string {
	return fmt.Sprintf(`{
  "providers": {"hosted": {"base_url": %q, "api_format": "openai-compat", "api_key": %q}},
  "models": {"agent-m": {"name": "wire-model", "provider": "hosted", "type": "dense", "capabilities": ["chat", "stream", "tool_call"]}},
  "defaults": {"agent": "agent-m"}
}`, endpoint, apiKey)
}

// stageWorkdirConfig makes a fresh working directory the process's, with body
// as its models.json: the file itself, or a symlink to a file elsewhere. The
// secret is set and GO_LLM_CONFIG unset, so discovery picks the working
// directory. It returns the working directory and the file's bytes.
func stageWorkdirConfig(t *testing.T, body string, viaSymlink bool) (string, []byte) {
	t.Helper()
	sandboxAgentConfigEnv(t)
	t.Setenv(workdirSecretName, workdirSecretMarker)
	work := t.TempDir()
	t.Chdir(work)
	target := filepath.Join(work, "models.json")
	if viaSymlink {
		target = filepath.Join(t.TempDir(), "elsewhere.json")
	}
	if err := os.WriteFile(target, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if viaSymlink {
		if err := os.Symlink(target, filepath.Join(work, "models.json")); err != nil {
			t.Skipf("symlinks unavailable here: %v", err)
		}
	}
	return work, []byte(body)
}

var workdirForms = []struct {
	name       string
	viaSymlink bool
}{{"file", false}, {"symlink", true}}

func assertKeyReferenceRefusal(t *testing.T, err error) {
	t.Helper()
	if !errors.Is(err, ErrAgentConfigInvalid) || !errors.Is(err, errWorkingDirectoryKeyReference) {
		t.Fatalf("error = %v, want the working-directory key reference refusal", err)
	}
	if !strings.Contains(err.Error(), "GO_LLM_CONFIG") {
		t.Fatalf("refusal %q does not name the remedy", err)
	}
	if strings.Contains(err.Error(), workdirSecretMarker) || strings.Contains(err.Error(), workdirSecretName) {
		t.Fatalf("refusal %q leaks the reference or its value", err)
	}
}

func TestWorkingDirectoryKeyReferenceIsRefused(t *testing.T) {
	for _, form := range workdirForms {
		t.Run(form.name, func(t *testing.T) {
			stageWorkdirConfig(t, workdirAgentConfig("http://127.0.0.1:1", "${"+workdirSecretName+"}"), form.viaSymlink)

			doc, loaded, err := loadAgentConfigDocument()
			if doc != nil || loaded.Config != nil {
				t.Fatal("a refused config still produced a document")
			}
			assertKeyReferenceRefusal(t, err)
			if loaded.Origin != originWorkingDirectory {
				t.Fatalf("origin = %q, want working_directory", loaded.Origin)
			}

			p := buildSettingsProjection(loaded, err)
			want := Diagnostic{Code: codeKeyReferenceRefused, SubjectKind: "provider", SubjectName: "hosted", Blocking: true}
			if p.State != "invalid" || p.SourceOrigin != "working_directory" ||
				len(p.Diagnostics) != 1 || p.Diagnostics[0] != want {
				t.Fatalf("projection = %+v, want invalid with %+v", p, want)
			}
			if err := validateSettingsProjection(p); err != nil {
				t.Fatalf("projection breaks the contract: %v", err)
			}

			public := SanitizeError(err)
			if public.Code != "config_key_reference_refused" || !strings.Contains(public.Message, "GO_LLM_CONFIG") {
				t.Fatalf("public error = %+v, want the refusal naming GO_LLM_CONFIG", public)
			}
		})
	}
}

func TestWorkingDirectoryConfigNamedByGoLLMConfigExpands(t *testing.T) {
	work, _ := stageWorkdirConfig(t, workdirAgentConfig("http://127.0.0.1:1", "${"+workdirSecretName+"}"), false)
	t.Setenv("GO_LLM_CONFIG", filepath.Join(work, "models.json"))

	loaded, err := loadDefaultAgentConfig()
	if err != nil {
		t.Fatalf("load via GO_LLM_CONFIG: %v", err)
	}
	if loaded.Origin != originEnv {
		t.Fatalf("origin = %q, want env", loaded.Origin)
	}
	if got := loaded.Config.Providers["hosted"].APIKey; got != workdirSecretMarker {
		t.Fatalf("api_key = %q, want the expanded variable", got)
	}
}

// A literal key in a working-directory config keeps loading, with the
// identity and revision LoadDocument gives the same file.
func TestWorkingDirectoryLiteralKeyKeepsIdentityAndRevision(t *testing.T) {
	work, raw := stageWorkdirConfig(t, workdirAgentConfig("http://127.0.0.1:1", "literal-key"), false)

	doc, loaded, err := loadAgentConfigDocument()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	want := canonicalPath(t, filepath.Join(work, "models.json"))
	sum := sha256.Sum256(raw)
	if loaded.SourcePath != want || loaded.Origin != originWorkingDirectory ||
		loaded.Revision != hex.EncodeToString(sum[:]) || loaded.HasConfigDiagnostic {
		t.Fatalf("loaded = %+v", loaded)
	}
	reference, err := config.LoadDocument(want)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Revision() != reference.Revision() || doc.Origin() != reference.Origin() {
		t.Fatalf("document origin/revision = %+v/%s, want %+v/%s",
			doc.Origin(), doc.Revision(), reference.Origin(), reference.Revision())
	}
	if got := loaded.Config.Providers["hosted"].APIKey; got != "literal-key" {
		t.Fatalf("api_key = %q", got)
	}
}

// The acceptance case: with the production loader and runner, a chat turn
// against a working-directory config that names a secret reaches neither a
// loopback listener (no consent needed) nor a remote one whose destination the
// user already approved.
func TestWorkingDirectoryKeyReferenceSendsNoRequest(t *testing.T) {
	listeners := []struct {
		name  string
		start func(*testing.T) (string, *int32)
	}{{"loopback", startLocalCountingServer}, {"remote", startCountingServer}}
	for _, listener := range listeners {
		for _, form := range workdirForms {
			t.Run(listener.name+"/"+form.name, func(t *testing.T) {
				endpoint, requests := listener.start(t)
				stageWorkdirConfig(t, workdirAgentConfig(endpoint, "${"+workdirSecretName+"}"), form.viaSymlink)
				svc := NewService(context.Background(), filesystem.NewOS(),
					filepath.Join(t.TempDir(), "consent", "grants.json"), (&emitRecorder{}).emit, "")
				t.Cleanup(func() {
					ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
					defer cancel()
					if err := svc.Close(ctx); err != nil {
						t.Errorf("Close: %v", err)
					}
				})
				canonical, local, err := NormalizeEndpoint(endpoint)
				if err != nil {
					t.Fatal(err)
				}
				if !local {
					// The user approved this destination earlier, so a run
					// would start without a consent challenge.
					if err := svc.consent.Grant(ProviderDestination{
						Provider: "hosted", Model: "wire-model", Endpoint: canonical,
						Classification: "remote", Digest: destinationDigest("hosted", canonical),
					}); err != nil {
						t.Fatalf("Grant: %v", err)
					}
				}
				repoID, _, err := svc.BindRepository(newRepo(t))
				if err != nil {
					t.Fatalf("BindRepository: %v", err)
				}

				adm, err := svc.StartTurn(context.Background(), turnFor(runIdentityFor(repoID, "project")))
				if err == nil {
					drainRuns(t, svc)
					t.Fatalf("StartTurn = %+v and the listener saw %d request(s), want the refusal",
						adm, atomic.LoadInt32(requests))
				}
				if code := publicCode(t, err); code != "config_key_reference_refused" {
					t.Fatalf("StartTurn code = %q, want config_key_reference_refused", code)
				}
				if got := atomic.LoadInt32(requests); got != 0 {
					t.Fatalf("listener saw %d request(s)", got)
				}
				st, err := svc.Status(StatusRequest{RepoEpoch: repoID.RepoEpoch, WorkspaceID: "project"})
				if err != nil || st.Available || !strings.Contains(st.InitError, "GO_LLM_CONFIG") {
					t.Fatalf("Status = %+v, %v, want unavailable naming GO_LLM_CONFIG", st, err)
				}
			})
		}
	}
}

// Commit generation sends with the key chat loaded (#491), never reading the
// file again, so a file rewritten from a literal key to a ${NAME} reference
// after the load changes nothing until Refresh, and Refresh refuses it.
func TestStagedScopeKeepsTheLoadedKey(t *testing.T) {
	work, _ := stageWorkdirConfig(t, workdirAgentConfig("http://127.0.0.1:1", "literal-key"), false)
	svc, repo := newBoundScopeService(t)
	key := func() (string, error) {
		t.Helper()
		scope, err := svc.StagedScope(repo)
		if err != nil {
			return "", err
		}
		scope.Release()
		return scope.Model.target.apiKey, nil
	}
	if got, err := key(); err != nil || got != "literal-key" {
		t.Fatalf("model key = %q, %v, want the literal", got, err)
	}
	writeFile(t, filepath.Join(work, "models.json"), workdirAgentConfig("http://127.0.0.1:1", "${"+workdirSecretName+"}"))

	if got, err := key(); err != nil || got != "literal-key" {
		t.Fatalf("model key after the rewrite = %q, %v, want the loaded literal", got, err)
	}
	if _, err := svc.ReloadSettings(); err != nil {
		t.Fatal(err)
	}
	if _, err := key(); err == nil {
		t.Fatal("StagedScope accepted the rewritten config after Refresh")
	} else {
		assertKeyReferenceRefusal(t, err)
	}
}

// Settings reload, Apply, profile capture and the generation scope all go
// through a fresh load of the discovered file, and each keeps the refusal.
func TestWorkingDirectoryKeyReferenceRefusedOnEveryReload(t *testing.T) {
	for _, form := range workdirForms {
		t.Run(form.name, func(t *testing.T) {
			_, raw := stageWorkdirConfig(t, workdirAgentConfig("http://127.0.0.1:1", "${"+workdirSecretName+"}"), form.viaSymlink)
			svc := NewService(context.Background(), filesystem.NewOS(),
				filepath.Join(t.TempDir(), "consent", "grants.json"), (&emitRecorder{}).emit, "")
			t.Cleanup(func() {
				ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer cancel()
				if err := svc.Close(ctx); err != nil {
					t.Errorf("Close: %v", err)
				}
			})
			refused := func(where string, ds []Diagnostic) {
				t.Helper()
				if len(ds) != 1 || ds[0].Code != codeKeyReferenceRefused {
					t.Fatalf("%s diagnostics = %+v, want %s", where, ds, codeKeyReferenceRefused)
				}
			}

			p, err := svc.Settings()
			if err != nil {
				t.Fatal(err)
			}
			refused("Settings", p.Diagnostics)
			reload, err := svc.ReloadSettings()
			if err != nil || reload.Busy {
				t.Fatalf("ReloadSettings = %+v, %v", reload, err)
			}
			refused("ReloadSettings", reload.Projection.Diagnostics)

			sum := sha256.Sum256(raw)
			revision := hex.EncodeToString(sum[:])
			res, err := svc.ApplySettings(SettingsApplyRequest{
				TargetRevision: &revision,
				Source:         ApplySource{Kind: applySourceApplied},
				Changes: []Change{{Kind: changeKindProviderUpdate, Name: "hosted",
					Endpoint: stringPtr("http://127.0.0.1:2")}},
				Keys: map[string]string{},
			})
			if err != nil || res.Status != "diagnostics" {
				t.Fatalf("ApplySettings = %+v, %v, want diagnostics", res, err)
			}
			refused("ApplySettings", res.Diagnostics)
			if after, err := os.ReadFile("models.json"); err != nil || !bytes.Equal(after, raw) {
				t.Fatalf("ApplySettings changed the refused file: %v", err)
			}

			saved, err := svc.SaveGolemProfileAs(SaveGolemProfileAsRequest{ID: "user/mine", AppliedRevision: revision})
			if err != nil || saved.Status != "diagnostics" || len(saved.Diagnostics) != 1 ||
				saved.Diagnostics[0].Code != "active_config_invalid" {
				t.Fatalf("SaveGolemProfileAs = %+v, %v, want active_config_invalid", saved, err)
			}

			repo := newRepo(t)
			if _, _, err := svc.BindRepository(repo); err != nil {
				t.Fatalf("BindRepository: %v", err)
			}
			if _, err := svc.StagedScope(repo); err == nil {
				t.Fatal("StagedScope accepted a refused working-directory config")
			} else {
				assertKeyReferenceRefusal(t, err)
			}
		})
	}
}

// newBoundScopeService is a Service bound to a fresh repository, for
// StagedScope.
func newBoundScopeService(t *testing.T) (*Service, string) {
	t.Helper()
	svc := NewService(context.Background(), filesystem.NewOS(),
		filepath.Join(t.TempDir(), "consent", "grants.json"), (&emitRecorder{}).emit, "")
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := svc.Close(ctx); err != nil {
			t.Errorf("Close: %v", err)
		}
	})
	repo := newRepo(t)
	if _, _, err := svc.BindRepository(repo); err != nil {
		t.Fatalf("BindRepository: %v", err)
	}
	return svc, repo
}

// With no config anywhere, generation refuses as chat does. A models.json
// created in the working directory afterwards is not read until Refresh, which
// refuses its ${NAME} key.
func TestStagedScopeIgnoresAConfigCreatedAfterTheLoad(t *testing.T) {
	sandboxAgentConfigEnv(t)
	t.Setenv(workdirSecretName, workdirSecretMarker)
	work := t.TempDir()
	t.Chdir(work)
	svc, repo := newBoundScopeService(t)
	if _, err := svc.StagedScope(repo); !errors.Is(err, ErrAgentConfigMissing) {
		t.Fatalf("StagedScope = %v, want the missing-configuration refusal", err)
	}
	writeFile(t, filepath.Join(work, "models.json"), workdirAgentConfig("http://127.0.0.1:1", "${"+workdirSecretName+"}"))

	if _, err := svc.StagedScope(repo); !errors.Is(err, ErrAgentConfigMissing) {
		t.Fatalf("StagedScope after the file appeared = %v, want the loaded refusal until Refresh", err)
	}
	if _, err := svc.ReloadSettings(); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.StagedScope(repo); err == nil {
		t.Fatal("StagedScope accepted the new config after Refresh")
	} else {
		assertKeyReferenceRefusal(t, err)
	}
}

// A working-directory config that does not load refuses generation with the
// coarse error, not go-llm's text about a file path.
func TestStagedScopeRefusesAnInvalidWorkingDirectoryConfig(t *testing.T) {
	stageWorkdirConfig(t, `{"providers": `, false)
	svc, repo := newBoundScopeService(t)

	_, err := svc.StagedScope(repo)

	if !errors.Is(err, ErrAgentConfigInvalid) || errors.Is(err, errWorkingDirectoryKeyReference) {
		t.Fatalf("StagedScope error = %v, want the coarse invalid-config error", err)
	}
	if strings.Contains(err.Error(), string(filepath.Separator)) {
		t.Fatalf("error %q names a path", err)
	}
}

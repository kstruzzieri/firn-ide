package runprofile

import (
	"strings"
	"testing"
)

func TestScopedIDInsertsWorkspaceScope(t *testing.T) {
	got := scopedID("frontend", "detected-package-json-test")
	want := "detected-frontend-ws-66726f6e74656e64-package-json-test"
	if got != want {
		t.Errorf("scopedID = %q, want %q", got, want)
	}
}

func TestScopedIDSanitizesRootMarkerAndPath(t *testing.T) {
	if got := scopedID("root:go", "detected-go-mod-test"); got != "detected-root-go-ws-726f6f743a676f-go-mod-test" {
		t.Errorf("root marker scope = %q", got)
	}
	if got := scopedID("backend/python", "detected-pyproject-toml-test"); got != "detected-backend-python-ws-6261636b656e642f707974686f6e-pyproject-toml-test" {
		t.Errorf("path scope = %q", got)
	}
}

func TestScopedIDDistinguishesWorkspaceIDsWithSameSanitizedSlug(t *testing.T) {
	rootMarker := scopedID("root:go", "detected-go-mod-test")
	subdir := scopedID("root-go", "detected-go-mod-test")

	if rootMarker == subdir {
		t.Fatalf("scoped IDs collided: %q", rootMarker)
	}
	if !strings.HasPrefix(rootMarker, "detected-root-go-ws-") || !strings.HasSuffix(rootMarker, "-go-mod-test") {
		t.Fatalf("root marker ID lost readable scope/suffix: %q", rootMarker)
	}
	if !strings.HasPrefix(subdir, "detected-root-go-ws-") || !strings.HasSuffix(subdir, "-go-mod-test") {
		t.Fatalf("subdir ID lost readable scope/suffix: %q", subdir)
	}
}

func TestScopedIDLeavesUserAndUnscopedIDsAlone(t *testing.T) {
	if got := scopedID("frontend", "my-custom-id"); got != "my-custom-id" {
		t.Errorf("user id should be untouched, got %q", got)
	}
	if got := scopedID("", "detected-package-json-test"); got != "detected-package-json-test" {
		t.Errorf("empty scope should be a no-op, got %q", got)
	}
}

func TestMigrateV1StampsOwnershipAndRewritesIDs(t *testing.T) {
	scope := MigrationScope{WorkspaceID: "frontend", WorkspaceName: "Frontend", WorkspaceRelDir: "frontend"}
	in := []RunProfile{
		{ID: "detected-package-json-test", Name: "npm run test", Type: ProfileTypeSingle, Source: ProfileSourceUser},
	}
	out, changed := migrateV1Profiles(in, scope)
	if !changed {
		t.Fatal("expected changed=true")
	}
	p := out[0]
	if p.ID != scopedID("frontend", "detected-package-json-test") {
		t.Errorf("ID = %q", p.ID)
	}
	if p.WorkspaceID != "frontend" || p.WorkspaceRelDir != "frontend" || p.WorkingDir != "frontend" {
		t.Errorf("ownership not stamped: %+v", p)
	}
}

func TestMigrateV1RewritesIntraFileCompoundSteps(t *testing.T) {
	scope := MigrationScope{WorkspaceID: "frontend", WorkspaceName: "Frontend", WorkspaceRelDir: "frontend"}
	in := []RunProfile{
		{ID: "detected-package-json-dev", Name: "npm run dev", Type: ProfileTypeSingle},
		{ID: "my-compound", Name: "All", Type: ProfileTypeCompound, Steps: []string{"detected-package-json-dev"}},
	}
	out, changed := migrateV1Profiles(in, scope)
	if !changed {
		t.Fatal("expected changed=true")
	}
	var compound RunProfile
	for _, p := range out {
		if p.Type == ProfileTypeCompound {
			compound = p
		}
	}
	if len(compound.Steps) != 1 || compound.Steps[0] != scopedID("frontend", "detected-package-json-dev") {
		t.Errorf("compound step not rewritten: %v", compound.Steps)
	}
}

func TestMigrateV1RebasesRelativeWorkingDirToRepoRoot(t *testing.T) {
	scope := MigrationScope{WorkspaceID: "frontend", WorkspaceName: "Frontend", WorkspaceRelDir: "frontend"}
	in := []RunProfile{
		{ID: "custom-script", Name: "Script", Type: ProfileTypeSingle, WorkingDir: "scripts"},
		{ID: "already-rooted", Name: "Rooted", Type: ProfileTypeSingle, WorkingDir: "frontend/tools"},
	}
	out, changed := migrateV1Profiles(in, scope)
	if !changed {
		t.Fatal("expected changed=true")
	}
	if out[0].WorkingDir != "frontend/scripts" {
		t.Errorf("workingDir should be repo-root-relative, got %q", out[0].WorkingDir)
	}
	if out[1].WorkingDir != "frontend/tools" {
		t.Errorf("already-rooted workingDir changed incorrectly: %q", out[1].WorkingDir)
	}
}

func TestMigrateV1LeavesAbsoluteWorkingDirAlone(t *testing.T) {
	scope := MigrationScope{WorkspaceID: "frontend", WorkspaceName: "Frontend", WorkspaceRelDir: "frontend"}
	in := []RunProfile{
		{ID: "absolute", Name: "Absolute", Type: ProfileTypeSingle, WorkingDir: "/tmp/project"},
	}
	out, _ := migrateV1Profiles(in, scope)
	if out[0].WorkingDir != "/tmp/project" {
		t.Errorf("absolute workingDir changed: %q", out[0].WorkingDir)
	}
}

func TestMigrateV1FillsPartialOwnership(t *testing.T) {
	scope := MigrationScope{WorkspaceID: "frontend", WorkspaceName: "Frontend", WorkspaceRelDir: "frontend"}
	in := []RunProfile{
		{ID: "custom", Name: "Custom", Type: ProfileTypeSingle, WorkspaceID: "frontend"},
	}
	out, changed := migrateV1Profiles(in, scope)
	if !changed {
		t.Fatal("expected changed=true")
	}
	if out[0].WorkspaceName != "Frontend" || out[0].WorkspaceRelDir != "frontend" {
		t.Errorf("partial ownership not filled: %+v", out[0])
	}
}

func TestMigrateV1NoChangeWhenAlreadyScopedAndStamped(t *testing.T) {
	scope := MigrationScope{WorkspaceID: "frontend", WorkspaceName: "Frontend", WorkspaceRelDir: "frontend"}
	in := []RunProfile{
		{ID: "my-custom", Name: "Custom", Type: ProfileTypeSingle, WorkspaceID: "frontend", WorkspaceName: "Frontend", WorkspaceRelDir: "frontend", WorkingDir: "frontend"},
	}
	_, changed := migrateV1Profiles(in, scope)
	if changed {
		t.Error("expected changed=false for already-migrated profile")
	}
}

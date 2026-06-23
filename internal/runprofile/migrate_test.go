package runprofile

import "testing"

func TestScopedIDInsertsWorkspaceScope(t *testing.T) {
	got := scopedID("frontend", "detected-package-json-test")
	want := "detected-frontend-package-json-test"
	if got != want {
		t.Errorf("scopedID = %q, want %q", got, want)
	}
}

func TestScopedIDSanitizesRootMarkerAndPath(t *testing.T) {
	if got := scopedID("root:go", "detected-go-mod-test"); got != "detected-root-go-go-mod-test" {
		t.Errorf("root marker scope = %q", got)
	}
	if got := scopedID("backend/python", "detected-pyproject-toml-test"); got != "detected-backend-python-pyproject-toml-test" {
		t.Errorf("path scope = %q", got)
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
	if p.ID != "detected-frontend-package-json-test" {
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
	if len(compound.Steps) != 1 || compound.Steps[0] != "detected-frontend-package-json-dev" {
		t.Errorf("compound step not rewritten: %v", compound.Steps)
	}
}

func TestMigrateV1NoChangeWhenAlreadyScopedAndStamped(t *testing.T) {
	scope := MigrationScope{WorkspaceID: "frontend", WorkspaceName: "Frontend", WorkspaceRelDir: "frontend"}
	in := []RunProfile{
		{ID: "my-custom", Name: "Custom", Type: ProfileTypeSingle, WorkspaceID: "frontend", WorkspaceRelDir: "frontend", WorkingDir: "frontend"},
	}
	_, changed := migrateV1Profiles(in, scope)
	if changed {
		t.Error("expected changed=false for already-migrated profile")
	}
}

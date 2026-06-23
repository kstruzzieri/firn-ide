package runprofile

import "strings"

// MigrationScope carries the owning-workspace identity the coordinator supplies
// when loading a per-workspace store, used both to stamp ownership on legacy
// profiles and to scope their IDs. The zero value means "unscoped" (legacy
// single-workspace Manager path) and is a no-op.
type MigrationScope struct {
	WorkspaceID     string
	WorkspaceName   string
	WorkspaceRelDir string
}

// scopeSlug normalizes a workspace id into an ID-safe segment.
// "root:go" -> "root-go", "backend/python" -> "backend-python".
func scopeSlug(workspaceID string) string {
	return sanitizeDashes(workspaceID)
}

// looksLikeDetectedID reports whether an ID was produced by generateID.
func looksLikeDetectedID(id string) bool {
	return strings.HasPrefix(id, "detected-")
}

// scopedID inserts the workspace scope into a legacy detected ID. User-authored
// IDs (not "detected-…") and the empty scope are returned unchanged.
func scopedID(workspaceID, oldID string) string {
	if workspaceID == "" || !looksLikeDetectedID(oldID) {
		return oldID
	}
	rest := strings.TrimPrefix(oldID, "detected-")
	return "detected-" + scopeSlug(workspaceID) + "-" + rest
}

// migrateV1Profiles upgrades a v1 profile list in place-by-value to the v2
// shape: stamps ownership, scopes detected IDs, and rewrites intra-file
// compound step references. Returns the migrated slice and whether anything
// changed (so the caller can decide whether to persist).
func migrateV1Profiles(profiles []RunProfile, scope MigrationScope) ([]RunProfile, bool) {
	changed := false
	idRewrite := map[string]string{}
	out := make([]RunProfile, len(profiles))

	for i, p := range profiles {
		if newID := scopedID(scope.WorkspaceID, p.ID); newID != p.ID {
			idRewrite[p.ID] = newID
			p.ID = newID
			changed = true
		}
		if p.WorkspaceID == "" && scope.WorkspaceID != "" {
			p.WorkspaceID = scope.WorkspaceID
			p.WorkspaceName = scope.WorkspaceName
			p.WorkspaceRelDir = scope.WorkspaceRelDir
			changed = true
		}
		if p.WorkingDir == "" && scope.WorkspaceRelDir != "" {
			p.WorkingDir = scope.WorkspaceRelDir
			changed = true
		}
		out[i] = p
	}

	// Rewrite intra-file compound step references via the old->new id map.
	for i := range out {
		if out[i].Type != ProfileTypeCompound || len(out[i].Steps) == 0 {
			continue
		}
		steps := make([]string, len(out[i].Steps))
		copy(steps, out[i].Steps)
		stepChanged := false
		for j, step := range steps {
			if nv, ok := idRewrite[step]; ok {
				steps[j] = nv
				stepChanged = true
			}
		}
		if stepChanged {
			out[i].Steps = steps
			changed = true
		}
	}

	return out, changed
}

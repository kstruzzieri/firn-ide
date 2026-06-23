package runprofile

import (
	"firn/internal/filesystem"
	"firn/internal/workspace"
	"fmt"
	"path/filepath"
	"sort"
	"sync"
)

// storeUnit is one detection-target root (a workspace's relDir) with its own
// saved-profile store, detector, and last detection snapshot.
type storeUnit struct {
	relDir   string
	ownerID  string
	store    *Store
	detector *Detector
	detected []RunProfile
}

// ProjectRunProfileManager is the repo-scoped coordinator: it detects run
// profiles across every workspace at load, stamps ownership, scopes detected
// IDs, routes persistence to the owning workspace's store, and presents one
// combined repo-wide profile list. It is the app-facing contract (replacing the
// single-workspace Manager).
type ProjectRunProfileManager struct {
	repoRoot string
	fs       filesystem.FileSystem

	mu          sync.RWMutex
	units       map[string]*storeUnit             // keyed by relDir
	order       []string                          // relDirs in display order
	ownerRelDir map[string]string                 // workspaceId -> relDir
	ownerDefs   map[string]workspace.WorkspaceDef // workspaceId -> def
}

// NewProjectManager creates a coordinator rooted at the opened repo.
func NewProjectManager(fsys filesystem.FileSystem, repoRoot string) *ProjectRunProfileManager {
	return &ProjectRunProfileManager{
		repoRoot:    repoRoot,
		fs:          fsys,
		units:       map[string]*storeUnit{},
		ownerRelDir: map[string]string{},
		ownerDefs:   map[string]workspace.WorkspaceDef{},
	}
}

// Load detects workspaces, then builds and loads one unit per detection target.
func (m *ProjectRunProfileManager) Load() error {
	defs, err := workspace.DetectWorkspaces(m.fs, m.repoRoot)
	if err != nil {
		return fmt.Errorf("detect workspaces: %w", err)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	m.units = map[string]*storeUnit{}
	m.order = nil
	m.ownerRelDir = map[string]string{}
	m.ownerDefs = map[string]workspace.WorkspaceDef{}

	// Repo-root owner: the typed root-marker def if present, else project.
	rootOwner := workspace.WorkspaceDef{ID: "project", Name: "Project", RelDir: ""}
	for _, d := range defs {
		if d.RelDir == "" && d.ID != "project" {
			rootOwner = d // "root:<type>"
			break
		}
	}

	for _, d := range defs {
		m.ownerRelDir[d.ID] = d.RelDir
		m.ownerDefs[d.ID] = d
	}

	// Distinct detection targets (relDirs) and the owner def for each.
	targetOwner := map[string]workspace.WorkspaceDef{"": rootOwner}
	for _, d := range defs {
		if d.RelDir == "" {
			continue
		}
		if _, ok := targetOwner[d.RelDir]; !ok {
			targetOwner[d.RelDir] = d
		}
	}

	for relDir, owner := range targetOwner {
		root := m.repoRoot
		if relDir != "" {
			root = filepath.Join(m.repoRoot, relDir)
		}
		scope := MigrationScope{
			WorkspaceID:     owner.ID,
			WorkspaceName:   owner.Name,
			WorkspaceRelDir: relDir,
		}

		store := NewStore(m.fs, root)
		store.SetScope(scope)
		if _, err := store.Load(); err != nil {
			return fmt.Errorf("load profiles for %q: %w", relDir, err)
		}

		det := NewDetector(m.fs, root)
		det.SetScope(scope)

		unit := &storeUnit{
			relDir:   relDir,
			ownerID:  owner.ID,
			store:    store,
			detector: det,
			detected: det.DetectAll(),
		}
		m.units[relDir] = unit
		m.order = append(m.order, relDir)
	}

	m.sortOrderLocked()
	return nil
}

// sortOrderLocked orders units: repo root first, then subdir relDirs ascending.
func (m *ProjectRunProfileManager) sortOrderLocked() {
	sort.SliceStable(m.order, func(i, j int) bool {
		if m.order[i] == "" {
			return true
		}
		if m.order[j] == "" {
			return false
		}
		return m.order[i] < m.order[j]
	})
}

// GetAllProfiles merges every unit's (saved + non-shadowed detected) into one
// repo-wide list, in unit display order.
func (m *ProjectRunProfileManager) GetAllProfiles() []RunProfile {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var merged []RunProfile
	for _, relDir := range m.order {
		merged = append(merged, m.combineUnitLocked(m.units[relDir])...)
	}
	if merged == nil {
		merged = []RunProfile{}
	}
	return merged
}

// combineUnitLocked replicates Manager merge semantics for one unit: saved
// profiles first, then detected profiles whose ID is not shadowed by a saved
// one. Saved profiles are owner-normalized in case of legacy gaps.
func (m *ProjectRunProfileManager) combineUnitLocked(u *storeUnit) []RunProfile {
	if u == nil {
		return nil
	}
	saved := u.store.GetAll()
	savedIDs := map[string]bool{}

	out := make([]RunProfile, 0, len(saved)+len(u.detected))
	for _, p := range saved {
		savedIDs[p.ID] = true
		out = append(out, m.normalizeOwner(p, u))
	}
	for _, d := range u.detected {
		if savedIDs[d.ID] {
			continue
		}
		out = append(out, d)
	}
	return out
}

// normalizeOwner fills missing ownership on a saved profile from its unit owner.
func (m *ProjectRunProfileManager) normalizeOwner(p RunProfile, u *storeUnit) RunProfile {
	if p.WorkspaceID == "" {
		def := m.ownerDefs[u.ownerID]
		p.WorkspaceID = u.ownerID
		p.WorkspaceName = def.Name
		p.WorkspaceRelDir = u.relDir
	}
	if p.WorkingDir == "" && u.relDir != "" {
		p.WorkingDir = u.relDir
	}
	return p
}

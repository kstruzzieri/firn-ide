// Package runprofile provides run profile management for Firn IDE.
// Run profiles are first-class build/lint/test/deploy configurations per workspace.
package runprofile

import (
	"bytes"
	"encoding/json"
	"sort"
)

// ProfileType distinguishes single-command profiles from compound (multi-step) profiles.
type ProfileType string

const (
	ProfileTypeSingle   ProfileType = "single"
	ProfileTypeCompound ProfileType = "compound"
)

// ProfileSource distinguishes user-created profiles from auto-detected ones.
type ProfileSource string

const (
	ProfileSourceUser     ProfileSource = "user"
	ProfileSourceDetected ProfileSource = "detected"
)

// ProfileTag categorizes profiles for filtering and display.
type ProfileTag string

const (
	TagBuild  ProfileTag = "build"
	TagTest   ProfileTag = "test"
	TagDev    ProfileTag = "dev"
	TagDeploy ProfileTag = "deploy"
	TagLint   ProfileTag = "lint"
)

// ValidTags is the set of recognized profile tags.
var ValidTags = map[ProfileTag]bool{
	TagBuild:  true,
	TagTest:   true,
	TagDev:    true,
	TagDeploy: true,
	TagLint:   true,
}

// EnvVariant represents an alternative environment configuration.
type EnvVariant struct {
	Name    string `json:"name"`
	EnvFile string `json:"envFile"`
}

// EnvVariants stores environment variants in the canonical array shape while
// still accepting the issue #64 map shape from hand-written profile files.
type EnvVariants []EnvVariant

// UnmarshalJSON accepts either:
//   - [{"name":"dev","envFile":".env.dev"}]
//   - {"dev":".env.dev"}
func (v *EnvVariants) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		*v = nil
		return nil
	}

	if trimmed[0] != '{' {
		var variants []EnvVariant
		if err := json.Unmarshal(trimmed, &variants); err != nil {
			return err
		}
		*v = variants
		return nil
	}

	var variantMap map[string]string
	if err := json.Unmarshal(trimmed, &variantMap); err != nil {
		return err
	}

	names := make([]string, 0, len(variantMap))
	for name := range variantMap {
		names = append(names, name)
	}
	sort.Strings(names)

	variants := make([]EnvVariant, 0, len(names))
	for _, name := range names {
		variants = append(variants, EnvVariant{Name: name, EnvFile: variantMap[name]})
	}
	*v = variants
	return nil
}

// RunProfile represents a single run configuration.
type RunProfile struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	Type            ProfileType       `json:"type"`
	Source          ProfileSource     `json:"source"`
	Command         string            `json:"command,omitempty"`
	WorkingDir      string            `json:"workingDir,omitempty"`
	Env             map[string]string `json:"env,omitempty"`
	EnvFile         string            `json:"envFile,omitempty"`
	EnvVariants     EnvVariants       `json:"envVariants,omitempty"`
	ActiveVariant   string            `json:"activeVariant,omitempty"`
	Tags            []ProfileTag      `json:"tags,omitempty"`
	Steps           []string          `json:"steps,omitempty"`
	DetectedFrom    string            `json:"detectedFrom,omitempty"`
	Order           int               `json:"order,omitempty"`
	WorkspaceID     string            `json:"workspaceId,omitempty"`     // owner: "frontend" | "root:go" | "project"
	WorkspaceName   string            `json:"workspaceName,omitempty"`   // display label, e.g. "Frontend"
	WorkspaceRelDir string            `json:"workspaceRelDir,omitempty"` // "" for repo-root profiles
}

// ProfilesFile is the on-disk format for .firn/run-profiles.json.
type ProfilesFile struct {
	Version  int          `json:"version"`
	Profiles []RunProfile `json:"profiles"`
}

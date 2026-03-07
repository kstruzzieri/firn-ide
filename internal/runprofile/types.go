// Package runprofile provides run profile management for Firn IDE.
// Run profiles are first-class build/lint/test/deploy configurations per workspace.
package runprofile

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

// RunProfile represents a single run configuration.
type RunProfile struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	Type          ProfileType       `json:"type"`
	Source        ProfileSource     `json:"source"`
	Command       string            `json:"command,omitempty"`
	WorkingDir    string            `json:"workingDir,omitempty"`
	Env           map[string]string `json:"env,omitempty"`
	EnvFile       string            `json:"envFile,omitempty"`
	EnvVariants   []EnvVariant      `json:"envVariants,omitempty"`
	ActiveVariant string            `json:"activeVariant,omitempty"`
	Tags          []ProfileTag      `json:"tags,omitempty"`
	Steps         []string          `json:"steps,omitempty"`
	DetectedFrom  string            `json:"detectedFrom,omitempty"`
	Order         int               `json:"order,omitempty"`
}

// ProfilesFile is the on-disk format for .firn/run-profiles.json.
type ProfilesFile struct {
	Version  int          `json:"version"`
	Profiles []RunProfile `json:"profiles"`
}

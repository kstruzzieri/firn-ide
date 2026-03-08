package runprofile

import (
	"encoding/json"
	"testing"
)

func TestRunProfileJSONRoundTrip(t *testing.T) {
	profile := RunProfile{
		ID:         "test-1",
		Name:       "Build",
		Type:       ProfileTypeSingle,
		Source:     ProfileSourceUser,
		Command:    "go build ./...",
		WorkingDir: "/project",
		Env:        map[string]string{"GO111MODULE": "on"},
		EnvFile:    ".env",
		EnvVariants: []EnvVariant{
			{Name: "staging", EnvFile: ".env.staging"},
		},
		ActiveVariant: "staging",
		Tags:          []ProfileTag{TagBuild},
		DetectedFrom:  "go.mod",
		Order:         1,
	}

	data, err := json.Marshal(profile)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	var decoded RunProfile
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if decoded.ID != profile.ID {
		t.Errorf("ID mismatch: got %q, want %q", decoded.ID, profile.ID)
	}
	if decoded.Name != profile.Name {
		t.Errorf("Name mismatch: got %q, want %q", decoded.Name, profile.Name)
	}
	if decoded.Type != profile.Type {
		t.Errorf("Type mismatch: got %q, want %q", decoded.Type, profile.Type)
	}
	if decoded.Source != profile.Source {
		t.Errorf("Source mismatch: got %q, want %q", decoded.Source, profile.Source)
	}
	if decoded.Command != profile.Command {
		t.Errorf("Command mismatch: got %q, want %q", decoded.Command, profile.Command)
	}
	if decoded.WorkingDir != profile.WorkingDir {
		t.Errorf("WorkingDir mismatch: got %q, want %q", decoded.WorkingDir, profile.WorkingDir)
	}
	if decoded.Env["GO111MODULE"] != "on" {
		t.Errorf("Env mismatch: got %v", decoded.Env)
	}
	if decoded.EnvFile != profile.EnvFile {
		t.Errorf("EnvFile mismatch: got %q, want %q", decoded.EnvFile, profile.EnvFile)
	}
	if len(decoded.EnvVariants) != 1 || decoded.EnvVariants[0].Name != "staging" {
		t.Errorf("EnvVariants mismatch: got %v", decoded.EnvVariants)
	}
	if decoded.ActiveVariant != profile.ActiveVariant {
		t.Errorf("ActiveVariant mismatch: got %q, want %q", decoded.ActiveVariant, profile.ActiveVariant)
	}
	if len(decoded.Tags) != 1 || decoded.Tags[0] != TagBuild {
		t.Errorf("Tags mismatch: got %v", decoded.Tags)
	}
	if decoded.DetectedFrom != profile.DetectedFrom {
		t.Errorf("DetectedFrom mismatch: got %q, want %q", decoded.DetectedFrom, profile.DetectedFrom)
	}
	if decoded.Order != profile.Order {
		t.Errorf("Order mismatch: got %d, want %d", decoded.Order, profile.Order)
	}
}

func TestCompoundProfileJSONRoundTrip(t *testing.T) {
	profile := RunProfile{
		ID:     "compound-1",
		Name:   "Build & Test",
		Type:   ProfileTypeCompound,
		Source: ProfileSourceUser,
		Steps:  []string{"build-1", "test-1"},
		Tags:   []ProfileTag{TagBuild, TagTest},
	}

	data, err := json.Marshal(profile)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	var decoded RunProfile
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if len(decoded.Steps) != 2 {
		t.Fatalf("Steps length mismatch: got %d, want 2", len(decoded.Steps))
	}
	if decoded.Steps[0] != "build-1" || decoded.Steps[1] != "test-1" {
		t.Errorf("Steps mismatch: got %v", decoded.Steps)
	}
}

func TestOmitemptyFieldsExcludedFromJSON(t *testing.T) {
	profile := RunProfile{
		ID:     "minimal",
		Name:   "Minimal",
		Type:   ProfileTypeSingle,
		Source: ProfileSourceUser,
	}

	data, err := json.Marshal(profile)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("Unmarshal to map failed: %v", err)
	}

	omitFields := []string{"command", "workingDir", "env", "envFile", "envVariants", "activeVariant", "tags", "steps", "detectedFrom"}
	for _, field := range omitFields {
		if _, exists := raw[field]; exists {
			t.Errorf("expected field %q to be omitted from JSON, but it was present", field)
		}
	}

	// order is 0 which is the zero value for int, so it should be omitted too
	if _, exists := raw["order"]; exists {
		t.Errorf("expected field 'order' to be omitted when zero")
	}
}

func TestProfilesFileJSONRoundTrip(t *testing.T) {
	pf := ProfilesFile{
		Version: 1,
		Profiles: []RunProfile{
			{ID: "p1", Name: "Build", Type: ProfileTypeSingle, Source: ProfileSourceUser, Command: "make build"},
		},
	}

	data, err := json.Marshal(pf)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	var decoded ProfilesFile
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if decoded.Version != 1 {
		t.Errorf("Version mismatch: got %d, want 1", decoded.Version)
	}
	if len(decoded.Profiles) != 1 {
		t.Fatalf("Profiles length mismatch: got %d, want 1", len(decoded.Profiles))
	}
	if decoded.Profiles[0].ID != "p1" {
		t.Errorf("Profile ID mismatch: got %q, want %q", decoded.Profiles[0].ID, "p1")
	}
}

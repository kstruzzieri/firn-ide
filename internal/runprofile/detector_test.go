package runprofile

import (
	"firn/internal/filesystem"
	"io/fs"
	"testing"
	"time"
)

type mockFileInfo struct {
	name string
	dir  bool
}

func (m mockFileInfo) Name() string       { return m.name }
func (m mockFileInfo) Size() int64        { return 0 }
func (m mockFileInfo) Mode() fs.FileMode  { return 0o644 }
func (m mockFileInfo) ModTime() time.Time { return time.Time{} }
func (m mockFileInfo) IsDir() bool        { return m.dir }
func (m mockFileInfo) Sys() interface{}   { return nil }

func newDetectorMockFS(files map[string][]byte) *filesystem.Mock {
	return &filesystem.Mock{
		ReadFileFunc: func(path string) ([]byte, error) {
			data, ok := files[path]
			if !ok {
				return nil, fs.ErrNotExist
			}
			return data, nil
		},
		StatFunc: func(path string) (fs.FileInfo, error) {
			if _, ok := files[path]; ok {
				return mockFileInfo{name: path}, nil
			}
			return nil, fs.ErrNotExist
		},
	}
}

func TestDetectPackageJSON(t *testing.T) {
	files := map[string][]byte{
		"/workspace/package.json": []byte(`{
			"scripts": {
				"build": "tsc",
				"test": "jest",
				"dev": "vite",
				"lint": "eslint ."
			}
		}`),
	}
	mockFS := newDetectorMockFS(files)
	detector := NewDetector(mockFS, "/workspace")

	profiles := detector.DetectAll()
	if len(profiles) != 4 {
		t.Fatalf("expected 4 profiles, got %d", len(profiles))
	}

	// Check that all are detected from package.json
	for _, p := range profiles {
		if p.DetectedFrom != "package.json" {
			t.Errorf("expected DetectedFrom 'package.json', got %q", p.DetectedFrom)
		}
		if p.Source != ProfileSourceDetected {
			t.Errorf("expected source 'detected', got %q", p.Source)
		}
		if p.Type != ProfileTypeSingle {
			t.Errorf("expected type 'single', got %q", p.Type)
		}
	}

	// Check tag inference for known script names
	tagsByName := map[string][]ProfileTag{}
	for _, p := range profiles {
		tagsByName[p.Name] = p.Tags
	}

	if tags, ok := tagsByName["npm run build"]; !ok || !containsTag(tags, TagBuild) {
		t.Error("expected 'build' script to have build tag")
	}
	if tags, ok := tagsByName["npm run test"]; !ok || !containsTag(tags, TagTest) {
		t.Error("expected 'test' script to have test tag")
	}
	if tags, ok := tagsByName["npm run dev"]; !ok || !containsTag(tags, TagDev) {
		t.Error("expected 'dev' script to have dev tag")
	}
	if tags, ok := tagsByName["npm run lint"]; !ok || !containsTag(tags, TagLint) {
		t.Error("expected 'lint' script to have lint tag")
	}
}

func TestDetectPackageJSONSkipsLifecycleScripts(t *testing.T) {
	files := map[string][]byte{
		"/workspace/package.json": []byte(`{
			"scripts": {
				"prepare": "husky",
				"preinstall": "echo pre",
				"postinstall": "echo post",
				"prepublishOnly": "echo pub",
				"build": "tsc",
				"start": "node .",
				"test": "jest"
			}
		}`),
	}
	detector := NewDetector(newDetectorMockFS(files), "/workspace")

	names := map[string]bool{}
	for _, p := range detector.DetectAll() {
		names[p.Name] = true
	}

	// Real run targets are still detected (start/test are not lifecycle hooks).
	for _, want := range []string{"npm run build", "npm run start", "npm run test"} {
		if !names[want] {
			t.Errorf("expected %q to be detected", want)
		}
	}
	// npm install/publish lifecycle hooks run automatically and are not run
	// targets, so they must not surface as profiles (e.g. husky "prepare").
	for _, skip := range []string{
		"npm run prepare", "npm run preinstall", "npm run postinstall", "npm run prepublishOnly",
	} {
		if names[skip] {
			t.Errorf("expected lifecycle script %q to be skipped", skip)
		}
	}
}

func TestDetectGoMod(t *testing.T) {
	files := map[string][]byte{
		"/workspace/go.mod": []byte("module example.com/foo\n\ngo 1.21\n"),
	}
	mockFS := newDetectorMockFS(files)
	detector := NewDetector(mockFS, "/workspace")

	profiles := detector.DetectAll()
	if len(profiles) != 4 {
		t.Fatalf("expected 4 profiles for go.mod, got %d", len(profiles))
	}

	commands := map[string]bool{}
	for _, p := range profiles {
		commands[p.Command] = true
	}

	expected := []string{"go build ./...", "go test ./...", "go vet ./...", "go run ."}
	for _, cmd := range expected {
		if !commands[cmd] {
			t.Errorf("expected command %q in detected profiles", cmd)
		}
	}
}

func TestDetectMakefile(t *testing.T) {
	files := map[string][]byte{
		"/workspace/Makefile": []byte(`CC := gcc
CFLAGS := -Wall

build:
	go build ./...

test:
	go test ./...

.PHONY: build test

clean:
	rm -rf dist/
`),
	}
	mockFS := newDetectorMockFS(files)
	detector := NewDetector(mockFS, "/workspace")

	profiles := detector.DetectAll()

	// Should detect: build, test, clean
	// Should NOT detect: CC, CFLAGS (variable assignments), .PHONY (dot-prefixed)
	if len(profiles) != 3 {
		t.Fatalf("expected 3 profiles, got %d: %v", len(profiles), profileNames(profiles))
	}

	names := map[string]bool{}
	for _, p := range profiles {
		names[p.Name] = true
	}

	if !names["make build"] {
		t.Error("expected 'make build' profile")
	}
	if !names["make test"] {
		t.Error("expected 'make test' profile")
	}
	if !names["make clean"] {
		t.Error("expected 'make clean' profile")
	}
	if names["make CC"] {
		t.Error("should not detect variable assignment 'CC := gcc' as target")
	}
	if names["make CFLAGS"] {
		t.Error("should not detect variable assignment 'CFLAGS := ...' as target")
	}
}

func TestDetectNoConfigFiles(t *testing.T) {
	mockFS := newDetectorMockFS(map[string][]byte{})
	detector := NewDetector(mockFS, "/workspace")

	profiles := detector.DetectAll()
	if len(profiles) != 0 {
		t.Errorf("expected 0 profiles, got %d", len(profiles))
	}
}

func TestDetectPyproject(t *testing.T) {
	files := map[string][]byte{
		"/workspace/pyproject.toml": []byte(`[project]
name = "demo"
version = "0.1.0"
`),
	}
	mockFS := newDetectorMockFS(files)
	detector := NewDetector(mockFS, "/workspace")

	profiles := detector.DetectAll()
	if len(profiles) != 2 {
		t.Fatalf("expected 2 profiles for pyproject.toml, got %d", len(profiles))
	}

	commands := map[string]bool{}
	for _, p := range profiles {
		commands[p.Command] = true
	}
	if !commands["pytest"] {
		t.Error("expected pytest profile for pyproject.toml")
	}
	if !commands["python ."] {
		t.Error("expected 'python .' profile for pyproject.toml")
	}
}

func TestIsConfigFile(t *testing.T) {
	tests := []struct {
		filename string
		expected bool
	}{
		{"package.json", true},
		{"go.mod", true},
		{"Makefile", true},
		{"pyproject.toml", true},
		{"docker-compose.yml", true},
		{"docker-compose.yaml", true},
		{"README.md", false},
		{"/some/path/package.json", true},
		{"/some/path/go.mod", true},
		{"tsconfig.json", false},
	}

	for _, tc := range tests {
		got := IsConfigFile(tc.filename)
		if got != tc.expected {
			t.Errorf("IsConfigFile(%q) = %v, want %v", tc.filename, got, tc.expected)
		}
	}
}

func TestGenerateIDIsDeterministic(t *testing.T) {
	id1 := generateID("package.json", "build")
	id2 := generateID("package.json", "build")
	if id1 != id2 {
		t.Errorf("generateID should be deterministic: got %q and %q", id1, id2)
	}

	id3 := generateID("package.json", "test")
	if id1 == id3 {
		t.Error("generateID should produce different IDs for different names")
	}
}

func TestGenerateIDDisambiguatesNormalizedCollisions(t *testing.T) {
	idDash := generateID("package.json", "lint-fix")
	idColon := generateID("package.json", "lint:fix")

	if idDash == idColon {
		t.Fatalf("expected distinct IDs for lint-fix and lint:fix, got %q", idDash)
	}
}

func TestInferTags(t *testing.T) {
	tests := []struct {
		name     string
		expected ProfileTag
	}{
		{"build", TagBuild},
		{"test", TagTest},
		{"dev", TagDev},
		{"start", TagDev},
		{"deploy", TagDeploy},
		{"lint", TagLint},
		{"lint:fix", TagLint},
		{"pre-build", TagBuild},
		{"test/unit", TagTest},
	}

	for _, tc := range tests {
		tags := inferTags(tc.name)
		if !containsTag(tags, tc.expected) {
			t.Errorf("inferTags(%q) = %v, expected to contain %q", tc.name, tags, tc.expected)
		}
	}
}

func TestInferTagsNoFalsePositives(t *testing.T) {
	// These words contain tag keywords as substrings but should NOT match
	noMatch := []struct {
		name        string
		shouldNotBe ProfileTag
	}{
		{"checkpoint", TagLint},  // "check" is embedded, not a word boundary
		{"developer", TagDev},    // "dev" is embedded in "developer"
		{"attestation", TagTest}, // "test" is embedded in "attestation"
		{"rebuild", TagBuild},    // "build" is embedded in "rebuild"
	}

	for _, tc := range noMatch {
		tags := inferTags(tc.name)
		if containsTag(tags, tc.shouldNotBe) {
			t.Errorf("inferTags(%q) = %v, should NOT contain %q (false positive)", tc.name, tags, tc.shouldNotBe)
		}
	}

	// These use separators and SHOULD match
	yesMatch := []struct {
		name     string
		expected ProfileTag
	}{
		{"pre-build", TagBuild}, // "build" after separator
		{"build-all", TagBuild}, // "build" before separator
		{"lint:fix", TagLint},   // "lint" before separator
		{"test/unit", TagTest},  // "test" before separator
		{"dev-server", TagDev},  // "dev" before separator
	}

	for _, tc := range yesMatch {
		tags := inferTags(tc.name)
		if !containsTag(tags, tc.expected) {
			t.Errorf("inferTags(%q) = %v, expected to contain %q", tc.name, tags, tc.expected)
		}
	}
}

func containsTag(tags []ProfileTag, target ProfileTag) bool {
	for _, t := range tags {
		if t == target {
			return true
		}
	}
	return false
}

func profileNames(profiles []RunProfile) []string {
	names := make([]string, len(profiles))
	for i, p := range profiles {
		names[i] = p.Name
	}
	return names
}

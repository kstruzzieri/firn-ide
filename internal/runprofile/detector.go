package runprofile

import (
	"encoding/json"
	"errors"
	"firn/internal/filesystem"
	"fmt"
	"io/fs"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// ConfigFiles lists the project config files that trigger detection.
var ConfigFiles = []string{
	"package.json",
	"go.mod",
	"Makefile",
	"pyproject.toml",
	"docker-compose.yml",
	"docker-compose.yaml",
}

// Detector auto-detects run profiles from project config files.
type Detector struct {
	fs            filesystem.FileSystem
	workspaceRoot string
	Warnings      []string
}

// NewDetector creates a Detector for the given workspace root.
func NewDetector(fsys filesystem.FileSystem, workspaceRoot string) *Detector {
	return &Detector{
		fs:            fsys,
		workspaceRoot: workspaceRoot,
	}
}

// DetectAll scans for all recognized config files and returns detected profiles.
// Non-fatal errors (e.g. unreadable files) are collected in d.Warnings.
func (d *Detector) DetectAll() []RunProfile {
	var profiles []RunProfile
	d.Warnings = nil
	dockerComposeDetected := false

	for _, configFile := range ConfigFiles {
		path := filepath.Join(d.workspaceRoot, configFile)
		if _, err := d.fs.Stat(path); err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				d.Warnings = append(d.Warnings, fmt.Sprintf("cannot access %s: %v", configFile, err))
			}
			continue
		}

		var detected []RunProfile
		switch configFile {
		case "package.json":
			detected = d.detectPackageJSON(path)
		case "go.mod":
			detected = d.detectGoMod()
		case "Makefile":
			detected = d.detectMakefile(path)
		case "pyproject.toml":
			detected = d.detectPyproject()
		case "docker-compose.yml", "docker-compose.yaml":
			if dockerComposeDetected {
				continue
			}
			dockerComposeDetected = true
			detected = d.detectDockerCompose(configFile)
		}

		profiles = append(profiles, detected...)
	}

	return profiles
}

// IsConfigFile returns true if the filename matches a recognized config file.
func IsConfigFile(filename string) bool {
	base := filepath.Base(filename)
	for _, cf := range ConfigFiles {
		if base == cf {
			return true
		}
	}
	return false
}

func (d *Detector) detectPackageJSON(path string) []RunProfile {
	data, err := d.fs.ReadFile(path)
	if err != nil {
		d.Warnings = append(d.Warnings, fmt.Sprintf("failed to read package.json: %v", err))
		return nil
	}

	var pkg struct {
		Scripts map[string]string `json:"scripts"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		d.Warnings = append(d.Warnings, fmt.Sprintf("failed to parse package.json: %v", err))
		return nil
	}

	// Sort script names for deterministic ordering across detections
	scriptNames := make([]string, 0, len(pkg.Scripts))
	for name := range pkg.Scripts {
		scriptNames = append(scriptNames, name)
	}
	sort.Strings(scriptNames)

	var profiles []RunProfile
	order := 0
	for _, name := range scriptNames {
		order++
		profiles = append(profiles, RunProfile{
			ID:           generateID("package.json", name),
			Name:         "npm run " + name,
			Type:         ProfileTypeSingle,
			Source:       ProfileSourceDetected,
			Command:      "npm run " + name,
			DetectedFrom: "package.json",
			Tags:         inferTags(name),
			Order:        order,
		})
	}

	return profiles
}

func (d *Detector) detectGoMod() []RunProfile {
	return []RunProfile{
		{
			ID:           generateID("go.mod", "build"),
			Name:         "go build",
			Type:         ProfileTypeSingle,
			Source:       ProfileSourceDetected,
			Command:      "go build ./...",
			DetectedFrom: "go.mod",
			Tags:         []ProfileTag{TagBuild},
			Order:        1,
		},
		{
			ID:           generateID("go.mod", "test"),
			Name:         "go test",
			Type:         ProfileTypeSingle,
			Source:       ProfileSourceDetected,
			Command:      "go test ./...",
			DetectedFrom: "go.mod",
			Tags:         []ProfileTag{TagTest},
			Order:        2,
		},
		{
			ID:           generateID("go.mod", "vet"),
			Name:         "go vet",
			Type:         ProfileTypeSingle,
			Source:       ProfileSourceDetected,
			Command:      "go vet ./...",
			DetectedFrom: "go.mod",
			Tags:         []ProfileTag{TagLint},
			Order:        3,
		},
		{
			ID:           generateID("go.mod", "run"),
			Name:         "go run",
			Type:         ProfileTypeSingle,
			Source:       ProfileSourceDetected,
			Command:      "go run .",
			DetectedFrom: "go.mod",
			Tags:         []ProfileTag{TagDev},
			Order:        4,
		},
	}
}

// Matches Makefile targets like "build:" but excludes variable assignments
// like "CC := gcc" (`:=`) and double-colon rules like "all::" (`::`).
// Uses a negative lookahead-equivalent: matches `:` only when NOT followed by `=` or `:`.
// The `(?:...)` group handles both "target: deps" and bare "target:" at end of line.
var makeTargetRegex = regexp.MustCompile(`^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:(?:[^:=]|$)`)

func (d *Detector) detectMakefile(path string) []RunProfile {
	data, err := d.fs.ReadFile(path)
	if err != nil {
		d.Warnings = append(d.Warnings, fmt.Sprintf("failed to read Makefile: %v", err))
		return nil
	}

	var profiles []RunProfile
	order := 0
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		matches := makeTargetRegex.FindStringSubmatch(line)
		if matches == nil {
			continue
		}
		target := matches[1]

		// Skip hidden/internal targets
		if strings.HasPrefix(target, ".") {
			continue
		}

		order++
		profiles = append(profiles, RunProfile{
			ID:           generateID("Makefile", target),
			Name:         "make " + target,
			Type:         ProfileTypeSingle,
			Source:       ProfileSourceDetected,
			Command:      "make " + target,
			DetectedFrom: "Makefile",
			Tags:         inferTags(target),
			Order:        order,
		})
	}

	return profiles
}

func (d *Detector) detectPyproject() []RunProfile {
	return []RunProfile{
		{
			ID:           generateID("pyproject.toml", "test"),
			Name:         "pytest",
			Type:         ProfileTypeSingle,
			Source:       ProfileSourceDetected,
			Command:      "pytest",
			DetectedFrom: "pyproject.toml",
			Tags:         []ProfileTag{TagTest},
			Order:        1,
		},
		{
			ID:           generateID("pyproject.toml", "run"),
			Name:         "python -m",
			Type:         ProfileTypeSingle,
			Source:       ProfileSourceDetected,
			Command:      "python -m .",
			DetectedFrom: "pyproject.toml",
			Tags:         []ProfileTag{TagDev},
			Order:        2,
		},
	}
}

func (d *Detector) detectDockerCompose(filename string) []RunProfile {
	return []RunProfile{
		{
			ID:           generateID("docker-compose", "up"),
			Name:         "docker compose up",
			Type:         ProfileTypeSingle,
			Source:       ProfileSourceDetected,
			Command:      "docker compose up",
			DetectedFrom: filename,
			Tags:         []ProfileTag{TagDev},
			Order:        1,
		},
		{
			ID:           generateID("docker-compose", "down"),
			Name:         "docker compose down",
			Type:         ProfileTypeSingle,
			Source:       ProfileSourceDetected,
			Command:      "docker compose down",
			DetectedFrom: filename,
			Tags:         []ProfileTag{TagDeploy},
			Order:        2,
		},
		{
			ID:           generateID("docker-compose", "build"),
			Name:         "docker compose build",
			Type:         ProfileTypeSingle,
			Source:       ProfileSourceDetected,
			Command:      "docker compose build",
			DetectedFrom: filename,
			Tags:         []ProfileTag{TagBuild},
			Order:        3,
		},
	}
}

// generateID produces a deterministic ID for a detected profile.
func generateID(source, name string) string {
	sanitized := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' {
			return r
		}
		return '-'
	}, name)
	sanitized = strings.ToLower(sanitized)
	return "detected-" + sanitizeDashes(source) + "-" + sanitizeDashes(sanitized)
}

// sanitizeDashes collapses consecutive dashes and trims leading/trailing dashes.
func sanitizeDashes(s string) string {
	s = strings.ToLower(s)
	// Replace non-alphanumeric with dashes
	s = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			return r
		}
		return '-'
	}, s)
	// Collapse consecutive dashes
	for strings.Contains(s, "--") {
		s = strings.ReplaceAll(s, "--", "-")
	}
	return strings.Trim(s, "-")
}

// tagPatterns maps tags to regex patterns that match whole words in script/target names.
// Word boundaries use separator characters common in script names: -, :, /, _, or string edges.
var tagPatterns = map[ProfileTag]*regexp.Regexp{
	TagBuild:  regexp.MustCompile(`(?:^|[-:/_])(?:build|compile)(?:$|[-:/_])`),
	TagTest:   regexp.MustCompile(`(?:^|[-:/_])(?:test|spec)(?:$|[-:/_])`),
	TagDev:    regexp.MustCompile(`(?:^|[-:/_])(?:dev|start|serve|watch)(?:$|[-:/_])`),
	TagDeploy: regexp.MustCompile(`(?:^|[-:/_])(?:deploy|release|publish)(?:$|[-:/_])`),
	TagLint:   regexp.MustCompile(`(?:^|[-:/_])(?:lint|check|format|vet)(?:$|[-:/_])`),
}

// inferTags guesses tags from a script/target name using word-boundary matching.
// This avoids false positives like "checkpoint" matching "check" or "developer" matching "dev".
func inferTags(name string) []ProfileTag {
	lower := strings.ToLower(name)
	var tags []ProfileTag

	for tag, pattern := range tagPatterns {
		if pattern.MatchString(lower) {
			tags = append(tags, tag)
		}
	}

	// Sort for deterministic output
	sort.Slice(tags, func(i, j int) bool {
		return tags[i] < tags[j]
	})

	return tags
}

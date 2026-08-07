package ai

import (
	"errors"
	"io/fs"
	"log"
	"path"
	"path/filepath"
	"strings"
	"sync"

	"firn/internal/filesystem"
	agenttools "github.com/kstruzzieri/go-llm/agent/tools"
	"gopkg.in/yaml.v3"
)

// policyManifestLimit bounds each manifest read; enforcement happens during
// the read via filesystem.ReadFileBounded, which also rejects symlinked and
// non-regular manifests.
const policyManifestLimit = 256 << 10

// maxRuleSegments caps one compiled rule's segment count so a hostile
// manifest cannot inflate per-guard-call matching cost; deeper rules are
// rejected like any other invalid rule.
const maxRuleSegments = 64

// policyManifestLabels are the only manifest locations consulted and the only
// values ever placed in PolicyWarning.Path.
var policyManifestLabels = []string{"ai-kit.yaml", "docs/ai/ai-kit.yaml"}

// Fixed user-visible warning categories. Never raw error text, never manifest
// values; raw causes are logged host-side only.
const (
	warnManifestMissing    = "no AI policy manifest found; only built-in protections apply"
	warnManifestEmpty      = "AI policy manifest defines no sensitive paths; only built-in protections apply"
	warnManifestUnreadable = "AI policy manifest could not be read; its rules were ignored"
	warnManifestMalformed  = "AI policy manifest could not be parsed; its rules were ignored"
	warnRuleRejected       = "AI policy manifest contains an invalid sensitive path rule; it was ignored"
)

var (
	// errPolicyDenied is the host-side denial cause. go-llm's tool layer maps
	// any guard error to its own fixed model-visible message.
	errPolicyDenied = errors.New("path denied by firn scope policy")
	// errPolicyDetached is the stable denial while no repository is attached.
	errPolicyDetached = errors.New("reopen repository to resume file access")
)

// firnSensitiveFloor is the immutable deny floor. Repository policy can only
// add rules, never subtract these. The **/x plus **/x/** pairs matter: the
// go-llm guard contract passes only the final cleaned relative path, never
// its ancestors, so descendants must be denied by pattern.
var firnSensitiveFloor = []string{
	"**/.env*",
	"**/*.pem",
	"**/*.key",
	"**/*.p12",
	"**/*.pfx",
	"**/id_rsa*",
	"**/id_ed25519*",
	"**/id_ecdsa*",
	"**/id_dsa*",
	"**/credentials",
	"**/credentials.*",
	"**/*credential*",
	"**/*credential*/**",
	"**/*secret*",
	"**/*secret*/**",
	".git",
	".git/**",
	"**/.git",
	"**/.git/**",
	".firn",
	".firn/**",
	"**/.firn",
	"**/.firn/**",
	".agent",
	".agent/**",
	"**/.agent",
	"**/.agent/**",
}

var floorPatterns = func() [][]string {
	pats := make([][]string, len(firnSensitiveFloor))
	for i, rule := range firnSensitiveFloor {
		pats[i] = strings.Split(rule, "/")
	}
	return pats
}()

// PolicyWarning is a UI-visible policy load problem. Path is a fixed
// repo-relative manifest label only; Message is a fixed category string.
type PolicyWarning struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// ScopePolicy is the fail-closed read-egress policy for one bound repository:
// the immutable floor plus the current additive manifest rules, protected
// config sources, and load warnings. Guards issued by Guard read live state,
// so Reload/Detach/Attach affect every already-issued closure.
type ScopePolicy struct {
	fsys     filesystem.FileSystem
	repoRoot string

	mu        sync.Mutex
	detached  bool
	additive  [][]string
	warnings  []PolicyWarning
	protected map[string]struct{} // lowercased slash repo-relative exact denies; never reloaded
}

// LoadScopePolicy builds the policy for repoRoot and performs the initial
// bounded manifest load. Load failure of any kind retains the floor.
// repoRoot must be the canonical (EvalSymlinks) repository root — the same
// root the go-llm Workspace resolves — or the Rel-based containment in
// ProtectConfigSource/Watches and the guard's prefix mapping diverge.
func LoadScopePolicy(fsys filesystem.FileSystem, repoRoot string) *ScopePolicy {
	p := &ScopePolicy{fsys: fsys, repoRoot: repoRoot, protected: make(map[string]struct{})}
	p.Reload()
	return p
}

// Reload re-reads the manifests and replaces the additive rules and warnings.
// The floor and protected config sources are untouched.
func (p *ScopePolicy) Reload() {
	rules, warnings := loadManifests(p.fsys, p.repoRoot)
	p.mu.Lock()
	p.additive = rules
	p.warnings = warnings
	p.mu.Unlock()
}

// Detach makes every issued guard fail closed for all file paths until Attach.
func (p *ScopePolicy) Detach() {
	p.mu.Lock()
	p.detached = true
	p.mu.Unlock()
}

// Attach performs a bounded manifest reload, then restores ordinary
// floor-plus-additive evaluation.
func (p *ScopePolicy) Attach() {
	rules, warnings := loadManifests(p.fsys, p.repoRoot)
	p.mu.Lock()
	p.additive = rules
	p.warnings = warnings
	p.detached = false
	p.mu.Unlock()
}

// Warnings returns a copy of the current load warnings.
func (p *ScopePolicy) Warnings() []PolicyWarning {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]PolicyWarning(nil), p.warnings...)
}

// Watches reports whether absPath is one of the manifest locations this
// policy reloads from. Comparison is case-insensitive: a spurious reload
// trigger is harmless, a missed one is not.
func (p *ScopePolicy) Watches(absPath string) bool {
	cleaned := filepath.Clean(absPath)
	for _, label := range policyManifestLabels {
		if strings.EqualFold(cleaned, filepath.Join(p.repoRoot, filepath.FromSlash(label))) {
			return true
		}
	}
	return false
}

// ProtectConfigSource permanently denies workspace access to a config source
// file inside the repository. Input must be an absolute, NUL-free, lexically
// canonical path. A source outside repoRoot (including a different Windows
// volume) is a successful no-op: it is already unreachable from the
// workspace. Protected paths survive Reload.
func (p *ScopePolicy) ProtectConfigSource(canonicalSourcePath string) error {
	if strings.IndexByte(canonicalSourcePath, 0) >= 0 {
		return errors.New("config source path contains a NUL byte")
	}
	if !filepath.IsAbs(canonicalSourcePath) {
		return errors.New("config source path is not absolute")
	}
	if filepath.Clean(canonicalSourcePath) != canonicalSourcePath {
		return errors.New("config source path is not lexically canonical")
	}
	rel, err := filepath.Rel(p.repoRoot, canonicalSourcePath)
	if err != nil {
		return nil // different volume: unreachable from the workspace
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return nil // outside the repository: unreachable from the workspace
	}
	key := strings.ToLower(filepath.ToSlash(rel))
	p.mu.Lock()
	p.protected[key] = struct{}{}
	p.mu.Unlock()
	return nil
}

// Guard returns the go-llm scope guard for a workspace rooted at workspaceRel
// (slash-relative to the repository root, "" for the repository itself). The
// closure reads live policy state on every call.
func (p *ScopePolicy) Guard(workspaceRel string) agenttools.ScopeGuard {
	prefix, ok := workspacePrefix(workspaceRel)
	if !ok {
		// ponytail: a workspaceRel with ".." is an identity-layer bug; fail
		// closed for everything rather than guess a repo-relative mapping.
		return func(string, bool) error { return errPolicyDenied }
	}
	return func(rel string, _ bool) error {
		return p.check(prefix, rel)
	}
}

// check evaluates one candidate. Runs under the policy mutex: matching is
// cheap and the lock keeps Reload/Detach/ProtectConfigSource race-free.
func (p *ScopePolicy) check(prefix []string, rel string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.detached {
		return errPolicyDetached
	}
	segs, ok := candidateSegments(prefix, rel)
	if !ok {
		return errPolicyDenied // absolute, escaping, or NUL input: fail closed
	}
	joined := strings.Join(segs, "/")
	for prot := range p.protected {
		if joined == prot || strings.HasPrefix(joined, prot+"/") {
			return errPolicyDenied
		}
	}
	for _, pat := range floorPatterns {
		if matchPattern(pat, segs) {
			return errPolicyDenied
		}
	}
	for _, pat := range p.additive {
		if matchPattern(pat, segs) {
			return errPolicyDenied
		}
	}
	return nil
}

// workspacePrefix normalizes a repo-relative workspace directory into
// lowercase slash segments. ok is false when the input carries a ".."
// component.
func workspacePrefix(workspaceRel string) ([]string, bool) {
	var prefix []string
	for _, seg := range strings.Split(strings.ToLower(strings.ReplaceAll(workspaceRel, `\`, "/")), "/") {
		if seg == "" || seg == "." {
			continue
		}
		if seg == ".." {
			return nil, false
		}
		prefix = append(prefix, seg)
	}
	return prefix, true
}

// candidateSegments converts a tool-relative path into lowercase slash
// repo-relative segments. Both separators are treated as separators and the
// result is lowercased so neither separator tricks nor case can bypass a
// denial on any platform. ok is false for NUL, absolute, or escaping input.
func candidateSegments(prefix []string, rel string) ([]string, bool) {
	if strings.IndexByte(rel, 0) >= 0 {
		return nil, false
	}
	s := strings.ToLower(strings.ReplaceAll(rel, `\`, "/"))
	if strings.HasPrefix(s, "/") || (len(s) >= 2 && s[1] == ':') {
		return nil, false
	}
	segs := append([]string(nil), prefix...)
	for _, seg := range strings.Split(s, "/") {
		if seg == "" || seg == "." {
			continue
		}
		if seg == ".." {
			return nil, false
		}
		segs = append(segs, seg)
	}
	return segs, true
}

// matchPattern matches pattern segments against path segments. "**" matches
// zero or more whole segments; every other segment goes through path.Match.
// States are memoized on (patternIndex, pathIndex) so stacked "**" segments
// stay polynomial. No suffix matching.
func matchPattern(pat, name []string) bool {
	w := len(name) + 1
	memo := make([]int8, (len(pat)+1)*w) // 0 unknown, 1 match, 2 no match
	var rec func(pi, ni int) bool
	rec = func(pi, ni int) bool {
		idx := pi*w + ni
		if v := memo[idx]; v != 0 {
			return v == 1
		}
		var ok bool
		switch {
		case pi == len(pat):
			ok = ni == len(name)
		case pat[pi] == "**":
			ok = rec(pi+1, ni) || (ni < len(name) && rec(pi, ni+1))
		case ni < len(name):
			m, err := path.Match(pat[pi], name[ni])
			ok = err == nil && m && rec(pi+1, ni+1)
		}
		if ok {
			memo[idx] = 1
		} else {
			memo[idx] = 2
		}
		return ok
	}
	return rec(0, 0)
}

// policyManifest is the only manifest shape parsed: top-level sensitive_paths.
type policyManifest struct {
	SensitivePaths []string `yaml:"sensitive_paths"`
}

// loadManifests reads both supported manifests and unions their valid rules.
// Every failure mode contributes a fixed-category warning and no rules.
func loadManifests(fsys filesystem.FileSystem, repoRoot string) ([][]string, []PolicyWarning) {
	var rules [][]string
	var warnings []PolicyWarning
	found := false
	for _, label := range policyManifestLabels {
		full := filepath.Join(repoRoot, filepath.FromSlash(label))
		data, _, err := filesystem.ReadFileBounded(fsys, full, policyManifestLimit)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				continue
			}
			found = true
			log.Printf("ai: policy manifest %s unreadable: %v", label, err)
			warnings = append(warnings, PolicyWarning{Path: label, Message: warnManifestUnreadable})
			continue
		}
		found = true
		var doc policyManifest
		if err := yaml.Unmarshal(data, &doc); err != nil {
			log.Printf("ai: policy manifest %s malformed: %v", label, err)
			warnings = append(warnings, PolicyWarning{Path: label, Message: warnManifestMalformed})
			continue
		}
		accepted := 0
		for _, raw := range doc.SensitivePaths {
			pats, ok := compileRule(raw)
			if !ok {
				log.Printf("ai: policy manifest %s: rejected sensitive path rule %q", label, raw)
				warnings = append(warnings, PolicyWarning{Path: label, Message: warnRuleRejected})
				continue
			}
			rules = append(rules, pats...)
			accepted++
		}
		if accepted == 0 {
			warnings = append(warnings, PolicyWarning{Path: label, Message: warnManifestEmpty})
		}
	}
	if !found {
		warnings = append(warnings, PolicyWarning{Path: policyManifestLabels[0], Message: warnManifestMissing})
	}
	return rules, warnings
}

// compileRule validates and compiles one additive rule into its pattern and,
// unless it already ends in "**", a descendant "/**" variant — the guard is
// never called for ancestors, so a rule naming a directory must deny its
// contents itself. Absolute, NUL, ".." and invalid-glob rules are rejected.
func compileRule(raw string) ([][]string, bool) {
	if strings.IndexByte(raw, 0) >= 0 {
		return nil, false
	}
	s := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(raw, `\`, "/")))
	s = strings.TrimRight(s, "/")
	if s == "" || s == "." {
		return nil, false
	}
	if strings.HasPrefix(s, "/") || (len(s) >= 2 && s[1] == ':') {
		return nil, false
	}
	var segs []string
	for _, seg := range strings.Split(s, "/") {
		if seg == "" || seg == "." {
			continue
		}
		if seg == ".." {
			return nil, false
		}
		if seg == "**" {
			// "**/**" ≡ "**" (each matches zero or more segments): collapse so
			// a hostile manifest cannot stack thousands of "**" segments into
			// a per-guard-call matcher blowup under the policy mutex.
			if len(segs) > 0 && segs[len(segs)-1] == "**" {
				continue
			}
		} else if _, err := path.Match(seg, "probe"); err != nil {
			return nil, false
		}
		segs = append(segs, seg)
	}
	if len(segs) == 0 || len(segs) > maxRuleSegments {
		return nil, false
	}
	patterns := [][]string{segs}
	if segs[len(segs)-1] != "**" {
		desc := make([]string, len(segs)+1)
		copy(desc, segs)
		desc[len(segs)] = "**"
		patterns = append(patterns, desc)
	}
	return patterns, true
}

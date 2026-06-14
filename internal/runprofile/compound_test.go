package runprofile

import "testing"

func TestResolveSteps(t *testing.T) {
	singleA := RunProfile{ID: "build", Name: "Build", Type: ProfileTypeSingle, Command: "echo build"}
	singleB := RunProfile{ID: "test", Name: "Test", Type: ProfileTypeSingle, Command: "echo test"}
	nested := RunProfile{ID: "nested", Name: "Nested", Type: ProfileTypeCompound, Steps: []string{"build"}}

	tests := []struct {
		name      string
		compound  RunProfile
		all       []RunProfile
		wantIDs   []string
		wantError string
	}{
		{
			name:     "ordered duplicate steps are preserved",
			compound: RunProfile{ID: "ci", Name: "CI", Type: ProfileTypeCompound, Steps: []string{"build", "test", "build"}},
			all:      []RunProfile{singleA, singleB},
			wantIDs:  []string{"build", "test", "build"},
		},
		{
			name:      "missing step fails",
			compound:  RunProfile{ID: "ci", Name: "CI", Type: ProfileTypeCompound, Steps: []string{"missing"}},
			all:       []RunProfile{singleA},
			wantError: `compound profile "ci" references missing step "missing"`,
		},
		{
			name:      "compound step fails",
			compound:  RunProfile{ID: "ci", Name: "CI", Type: ProfileTypeCompound, Steps: []string{"nested"}},
			all:       []RunProfile{singleA, nested},
			wantError: `compound profile "ci" step "nested" is compound; only single profiles are supported`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ResolveSteps(tt.compound, tt.all)
			if tt.wantError != "" {
				if err == nil || err.Error() != tt.wantError {
					t.Fatalf("error = %v, want %q", err, tt.wantError)
				}
				return
			}
			if err != nil {
				t.Fatalf("ResolveSteps returned error: %v", err)
			}
			if len(got) != len(tt.wantIDs) {
				t.Fatalf("got %d steps, want %d", len(got), len(tt.wantIDs))
			}
			for i, wantID := range tt.wantIDs {
				if got[i].ID != wantID {
					t.Fatalf("step %d ID = %q, want %q", i, got[i].ID, wantID)
				}
			}
		})
	}
}

func TestCompoundStepKeyRoundTrip(t *testing.T) {
	key := compoundStepKey("ci", 12)
	if key != "compound:Y2k:12" {
		t.Fatalf("key = %q, want compound:Y2k:12", key)
	}

	compoundID, idx, ok := parseCompoundStepKey(key)
	if !ok {
		t.Fatal("parseCompoundStepKey returned ok=false")
	}
	if compoundID != "ci" || idx != 12 {
		t.Fatalf("parsed (%q, %d), want (ci, 12)", compoundID, idx)
	}
}

func TestCompoundStepKeyAllowsSeparatorsInCompoundID(t *testing.T) {
	key := compoundStepKey("ci#release:prod", 3)
	if key != "compound:Y2kjcmVsZWFzZTpwcm9k:3" {
		t.Fatalf("key = %q, want compound:Y2kjcmVsZWFzZTpwcm9k:3", key)
	}

	compoundID, idx, ok := parseCompoundStepKey(key)
	if !ok {
		t.Fatal("parseCompoundStepKey returned ok=false")
	}
	if compoundID != "ci#release:prod" || idx != 3 {
		t.Fatalf("parsed (%q, %d), want (ci#release:prod, 3)", compoundID, idx)
	}
}

func TestCompoundStepKeyAllowsUnicodeInCompoundID(t *testing.T) {
	key := compoundStepKey("ci-🚀", 4)

	compoundID, idx, ok := parseCompoundStepKey(key)
	if !ok {
		t.Fatal("parseCompoundStepKey returned ok=false")
	}
	if compoundID != "ci-🚀" || idx != 4 {
		t.Fatalf("parsed (%q, %d), want (ci-🚀, 4)", compoundID, idx)
	}
}

func TestParseCompoundStepKeyRejectsInvalid(t *testing.T) {
	for _, key := range []string{
		"",
		"ci",
		"ci#1",
		"compound",
		"compound:",
		"compound::1",
		"compound:@@@:1",
		"compound:Y2k",
		"compound:Y2k:",
		"compound:Y2k:x",
		"compound:Y2k:-1",
		"compound:Y2k:1:extra",
	} {
		if _, _, ok := parseCompoundStepKey(key); ok {
			t.Fatalf("parseCompoundStepKey(%q) returned ok=true", key)
		}
	}
}

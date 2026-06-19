package runprofile

import "testing"

func TestValidateSingleProfile(t *testing.T) {
	p := RunProfile{
		ID:      "test",
		Name:    "Build",
		Type:    ProfileTypeSingle,
		Source:  ProfileSourceUser,
		Command: "go build ./...",
		Tags:    []ProfileTag{TagBuild},
	}
	result := Validate(p)
	if !result.Valid {
		t.Errorf("expected valid, got errors: %v", result.Errors)
	}
}

func TestValidateCompoundProfile(t *testing.T) {
	p := RunProfile{
		ID:     "test",
		Name:   "Build & Test",
		Type:   ProfileTypeCompound,
		Source: ProfileSourceUser,
		Steps:  []string{"build-1", "test-1"},
	}
	result := Validate(p)
	if !result.Valid {
		t.Errorf("expected valid, got errors: %v", result.Errors)
	}
}

func TestValidateMissingID(t *testing.T) {
	p := RunProfile{
		Name:    "Build",
		Type:    ProfileTypeSingle,
		Command: "echo hello",
	}
	result := Validate(p)
	if result.Valid {
		t.Fatal("expected invalid for missing id")
	}
	assertHasFieldError(t, result, "id")
}

func TestValidateReservedCompoundProfileID(t *testing.T) {
	p := RunProfile{
		ID:      "compound:Y2k:0",
		Name:    "Build",
		Type:    ProfileTypeSingle,
		Command: "echo hello",
	}
	result := Validate(p)
	if result.Valid {
		t.Fatal("expected invalid for reserved compound profile id")
	}
	assertHasFieldError(t, result, "id")
}

func TestValidateMissingName(t *testing.T) {
	p := RunProfile{
		ID:      "test-1",
		Type:    ProfileTypeSingle,
		Command: "echo hello",
	}
	result := Validate(p)
	if result.Valid {
		t.Fatal("expected invalid for missing name")
	}
	assertHasFieldError(t, result, "name")
}

func TestValidateWhitespaceName(t *testing.T) {
	p := RunProfile{
		ID:      "test-1",
		Name:    "   ",
		Type:    ProfileTypeSingle,
		Command: "echo hello",
	}
	result := Validate(p)
	if result.Valid {
		t.Fatal("expected invalid for whitespace-only name")
	}
	assertHasFieldError(t, result, "name")
}

func TestValidateSingleMissingCommand(t *testing.T) {
	p := RunProfile{
		ID:   "test-1",
		Name: "Build",
		Type: ProfileTypeSingle,
	}
	result := Validate(p)
	if result.Valid {
		t.Fatal("expected invalid for single profile without command")
	}
	assertHasFieldError(t, result, "command")
}

func TestValidateCompoundEmptySteps(t *testing.T) {
	p := RunProfile{
		ID:    "test-1",
		Name:  "Pipeline",
		Type:  ProfileTypeCompound,
		Steps: []string{},
	}
	result := Validate(p)
	if result.Valid {
		t.Fatal("expected invalid for compound profile with empty steps")
	}
	assertHasFieldError(t, result, "steps")
}

func TestValidateInvalidType(t *testing.T) {
	p := RunProfile{
		ID:      "test-1",
		Name:    "Build",
		Type:    "invalid",
		Command: "echo hello",
	}
	result := Validate(p)
	if result.Valid {
		t.Fatal("expected invalid for unknown type")
	}
	assertHasFieldError(t, result, "type")
}

func TestValidateInvalidTag(t *testing.T) {
	p := RunProfile{
		ID:      "test-1",
		Name:    "Build",
		Type:    ProfileTypeSingle,
		Command: "echo hello",
		Tags:    []ProfileTag{"unknown"},
	}
	result := Validate(p)
	if result.Valid {
		t.Fatal("expected invalid for unknown tag")
	}
	assertHasFieldError(t, result, "tags")
}

func TestValidateEnvVariantsMissingName(t *testing.T) {
	p := RunProfile{
		ID:      "test-1",
		Name:    "Build",
		Type:    ProfileTypeSingle,
		Command: "echo hello",
		EnvVariants: []EnvVariant{
			{Name: "", EnvFile: ".env.staging"},
		},
	}
	result := Validate(p)
	if result.Valid {
		t.Fatal("expected invalid for env variant with empty name")
	}
	assertHasFieldError(t, result, "envVariants")
}

func TestValidateEnvVariantsMissingEnvFile(t *testing.T) {
	p := RunProfile{
		ID:      "test-1",
		Name:    "Build",
		Type:    ProfileTypeSingle,
		Command: "echo hello",
		EnvVariants: []EnvVariant{
			{Name: "staging", EnvFile: ""},
		},
	}
	result := Validate(p)
	if result.Valid {
		t.Fatal("expected invalid for env variant with empty envFile")
	}
	assertHasFieldError(t, result, "envVariants")
}

func TestValidateActiveVariantMustMatchConfiguredVariant(t *testing.T) {
	p := RunProfile{
		ID:            "test-1",
		Name:          "Build",
		Type:          ProfileTypeSingle,
		Command:       "echo hello",
		ActiveVariant: "prod",
		EnvVariants: []EnvVariant{
			{Name: "staging", EnvFile: ".env.staging"},
		},
	}
	result := Validate(p)
	if result.Valid {
		t.Fatal("expected invalid for active variant without matching env variant")
	}
	assertHasFieldError(t, result, "activeVariant")
}

func TestValidateActiveVariantAllowsConfiguredVariant(t *testing.T) {
	p := RunProfile{
		ID:            "test-1",
		Name:          "Build",
		Type:          ProfileTypeSingle,
		Command:       "echo hello",
		ActiveVariant: "staging",
		EnvVariants: []EnvVariant{
			{Name: "staging", EnvFile: ".env.staging"},
		},
	}
	result := Validate(p)
	if !result.Valid {
		t.Fatalf("expected valid active variant, got errors: %v", result.Errors)
	}
}

func TestValidateMultipleErrors(t *testing.T) {
	p := RunProfile{
		Type: "bad",
		Tags: []ProfileTag{"unknown"},
	}
	result := Validate(p)
	if result.Valid {
		t.Fatal("expected invalid")
	}
	// Should have errors for: id, name, type, tags
	if len(result.Errors) < 4 {
		t.Errorf("expected at least 4 errors, got %d: %v", len(result.Errors), result.Errors)
	}
	assertHasFieldError(t, result, "id")
	assertHasFieldError(t, result, "name")
	assertHasFieldError(t, result, "type")
	assertHasFieldError(t, result, "tags")
}

func assertHasFieldError(t *testing.T, result ValidationResult, field string) {
	t.Helper()
	for _, e := range result.Errors {
		if e.Field == field {
			return
		}
	}
	t.Errorf("expected error for field %q, got errors: %v", field, result.Errors)
}

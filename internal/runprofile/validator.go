package runprofile

import (
	"strconv"
	"strings"
)

// ValidationError describes a single validation failure.
type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// ValidationResult holds the outcome of profile validation.
type ValidationResult struct {
	Valid  bool              `json:"valid"`
	Errors []ValidationError `json:"errors"`
}

// Validate checks a RunProfile for correctness and returns any validation errors.
func Validate(profile RunProfile) ValidationResult {
	var errs []ValidationError

	if strings.TrimSpace(profile.ID) == "" {
		errs = append(errs, ValidationError{Field: "id", Message: "id is required"})
	}

	if strings.TrimSpace(profile.Name) == "" {
		errs = append(errs, ValidationError{Field: "name", Message: "name is required"})
	}

	switch profile.Type {
	case ProfileTypeSingle:
		if strings.TrimSpace(profile.Command) == "" {
			errs = append(errs, ValidationError{Field: "command", Message: "command is required for single profiles"})
		}
	case ProfileTypeCompound:
		if len(profile.Steps) == 0 {
			errs = append(errs, ValidationError{Field: "steps", Message: "compound profiles must have at least one step"})
		}
		// Note: Step ID references are not validated here because the full
		// profile list is not available. The execution engine (Issue #15) will
		// validate step references at runtime.
	default:
		errs = append(errs, ValidationError{Field: "type", Message: "type must be \"single\" or \"compound\""})
	}

	for i, v := range profile.EnvVariants {
		if strings.TrimSpace(v.Name) == "" {
			errs = append(errs, ValidationError{
				Field:   "envVariants",
				Message: "envVariants[" + strconv.Itoa(i) + "].name must not be empty",
			})
		}
		if strings.TrimSpace(v.EnvFile) == "" {
			errs = append(errs, ValidationError{
				Field:   "envVariants",
				Message: "envVariants[" + strconv.Itoa(i) + "].envFile must not be empty",
			})
		}
	}

	for _, tag := range profile.Tags {
		if !ValidTags[tag] {
			errs = append(errs, ValidationError{
				Field:   "tags",
				Message: "unknown tag: " + string(tag),
			})
		}
	}

	return ValidationResult{
		Valid:  len(errs) == 0,
		Errors: errs,
	}
}


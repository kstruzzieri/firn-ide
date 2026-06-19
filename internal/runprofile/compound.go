package runprofile

import (
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
)

const compoundStepKeyPrefix = "compound:"

func isReservedProfileID(id string) bool {
	return strings.HasPrefix(id, compoundStepKeyPrefix)
}

func rejectReservedProfileID(id string) error {
	if isReservedProfileID(id) {
		return fmt.Errorf("profile id uses reserved namespace %q: %s", compoundStepKeyPrefix, id)
	}
	return nil
}

func ResolveSteps(compound RunProfile, all []RunProfile) ([]RunProfile, error) {
	// Reject empty step lists defensively. Validate enforces this for the UI, but
	// a hand-edited or stale .firn/run-profiles.json can reach the runtime path;
	// without this guard StartCompound would emit running then an immediate
	// success aggregate without executing anything (a false green).
	if len(compound.Steps) == 0 {
		return nil, fmt.Errorf("compound profile %q must have at least one step", compound.ID)
	}

	byID := make(map[string]RunProfile, len(all))
	for _, profile := range all {
		byID[profile.ID] = profile
	}

	steps := make([]RunProfile, 0, len(compound.Steps))
	for _, stepID := range compound.Steps {
		step, ok := byID[stepID]
		if !ok {
			return nil, fmt.Errorf("compound profile %q references missing step %q", compound.ID, stepID)
		}
		if step.Type == ProfileTypeCompound {
			return nil, fmt.Errorf("compound profile %q step %q is compound; only single profiles are supported", compound.ID, stepID)
		}
		if err := rejectReservedProfileID(step.ID); err != nil {
			return nil, err
		}
		steps = append(steps, step)
	}
	return steps, nil
}

func compoundStepKey(compoundID string, stepIdx int) string {
	encodedID := base64.RawURLEncoding.EncodeToString([]byte(compoundID))
	return compoundStepKeyPrefix + encodedID + ":" + strconv.Itoa(stepIdx)
}

func parseCompoundStepKey(key string) (compoundID string, stepIdx int, ok bool) {
	if !strings.HasPrefix(key, compoundStepKeyPrefix) {
		return "", 0, false
	}

	rest := strings.TrimPrefix(key, compoundStepKeyPrefix)
	encodedID, idxText, found := strings.Cut(rest, ":")
	if !found || encodedID == "" || idxText == "" || strings.Contains(idxText, ":") {
		return "", 0, false
	}

	decodedID, err := base64.RawURLEncoding.DecodeString(encodedID)
	if err != nil || len(decodedID) == 0 {
		return "", 0, false
	}

	idx, err := strconv.Atoi(idxText)
	if err != nil || idx < 0 {
		return "", 0, false
	}
	return string(decodedID), idx, true
}

package runprofile

import (
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
)

const compoundStepKeyPrefix = "compound:"

func ResolveSteps(compound RunProfile, all []RunProfile) ([]RunProfile, error) {
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

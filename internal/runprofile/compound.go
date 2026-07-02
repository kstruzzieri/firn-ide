package runprofile

import "fmt"

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
		steps = append(steps, step)
	}
	return steps, nil
}

// Package workspace provides workspace state persistence for Firn IDE.
// Workspace state (open files, panel layout, cursor positions) is saved to
// ~/.firn/workspaces/ so sessions can be restored across app restarts.
package workspace

// StateFile is the on-disk JSON format with a version envelope.
type StateFile struct {
	Version int   `json:"version"`
	State   State `json:"state"`
}

// State is the complete persisted state for one workspace.
type State struct {
	WorkspacePath    string      `json:"workspacePath"`
	WorkspaceName    string      `json:"workspaceName"`
	LastOpened       string      `json:"lastOpened"` // RFC 3339
	Layout           Layout      `json:"layout"`
	Editor           EditorState `json:"editor"`
	Explorer         Explorer    `json:"explorer"`
	ActiveSidebar    string      `json:"activeSidebar"`
	HiddenProfileIDs []string    `json:"hiddenProfileIds,omitempty"`
}

// Layout captures panel sizes and collapsed states.
type Layout struct {
	PanelSizes      PanelSizes `json:"panelSizes"`
	LeftCollapsed   bool       `json:"leftCollapsed"`
	RightCollapsed  bool       `json:"rightCollapsed"`
	BottomCollapsed bool       `json:"bottomCollapsed"`
}

// PanelSizes stores pixel sizes for the three resizable panels.
type PanelSizes struct {
	Left   int `json:"left"`
	Right  int `json:"right"`
	Bottom int `json:"bottom"`
}

// EditorState captures open files and the active tab.
type EditorState struct {
	ActiveFilePath string      `json:"activeFilePath"`
	OpenFiles      []FileState `json:"openFiles"`
}

// FileState captures per-file cursor and scroll position.
type FileState struct {
	Path         string `json:"path"`
	CursorLine   int    `json:"cursorLine"`
	CursorColumn int    `json:"cursorColumn"`
	ScrollTop    int    `json:"scrollTop"`
}

// Explorer captures file tree expand/collapse state.
type Explorer struct {
	ExpandedPaths []string `json:"expandedPaths"`
	RootExpanded  bool     `json:"rootExpanded"`
}

// Summary is a lightweight struct for listing recent workspaces.
type Summary struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	LastOpened string `json:"lastOpened"`
}

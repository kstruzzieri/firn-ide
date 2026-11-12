package terminal

import "os"

// pollableMaster does nothing on Windows: creack/pty cannot start a terminal
// there, so no master ever reaches it.
func pollableMaster(ptmx *os.File) *os.File { return ptmx }

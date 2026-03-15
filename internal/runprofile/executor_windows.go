//go:build windows

package runprofile

import (
	"fmt"
	"os/exec"
	"strconv"
	"syscall"
)

func setSysProcAttr(cmd *exec.Cmd) {
	// CREATE_NEW_PROCESS_GROUP so the wrapper and its children share a group.
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}

func shellCommand(command string) *exec.Cmd {
	return exec.Command("cmd", "/C", command)
}

// killProcessGroup performs a graceful tree kill via taskkill /T (tree) without /F (force).
// taskkill /T terminates the process and all child processes spawned by it.
func killProcessGroup(pid int) error {
	kill := exec.Command("taskkill", "/T", "/PID", strconv.Itoa(pid))
	if out, err := kill.CombinedOutput(); err != nil {
		return fmt.Errorf("taskkill: %s: %w", out, err)
	}
	return nil
}

// forceKillProcessGroup performs a forced tree kill via taskkill /T /F.
func forceKillProcessGroup(pid int) error {
	kill := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(pid))
	if out, err := kill.CombinedOutput(); err != nil {
		return fmt.Errorf("taskkill /F: %s: %w", out, err)
	}
	return nil
}

// Package process provides process management interfaces for Arc IDE.
package process

// Manager defines the interface for managing external processes.
// This allows for easy mocking in tests.
type Manager interface {
	// Start starts a new process with the given command and arguments.
	Start(name string, args ...string) (Process, error)
}

// Process represents a running process.
type Process interface {
	// Wait waits for the process to exit and returns the exit code.
	Wait() (int, error)

	// Kill terminates the process.
	Kill() error

	// Pid returns the process ID.
	Pid() int
}

package process

import "testing"

func TestMockManagerImplementsInterface(t *testing.T) {
	var _ Manager = (*MockManager)(nil)
}

func TestMockProcessImplementsInterface(t *testing.T) {
	var _ Process = (*MockProcess)(nil)
}

func TestMockManagerStart(t *testing.T) {
	mock := &MockManager{
		StartFunc: func(name string, args ...string) (Process, error) {
			return &MockProcess{
				PidFunc: func() int { return 12345 },
			}, nil
		},
	}

	process, err := mock.Start("echo", "hello")
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}
	if process.Pid() != 12345 {
		t.Errorf("Expected PID 12345, got %d", process.Pid())
	}
}

package process

// MockProcess is a test implementation of the Process interface.
type MockProcess struct {
	WaitFunc func() (int, error)
	KillFunc func() error
	PidFunc  func() int
}

func (m *MockProcess) Wait() (int, error) {
	if m.WaitFunc != nil {
		return m.WaitFunc()
	}
	return 0, nil
}

func (m *MockProcess) Kill() error {
	if m.KillFunc != nil {
		return m.KillFunc()
	}
	return nil
}

func (m *MockProcess) Pid() int {
	if m.PidFunc != nil {
		return m.PidFunc()
	}
	return 0
}

// MockManager is a test implementation of the Manager interface.
type MockManager struct {
	StartFunc func(name string, args ...string) (Process, error)
}

func (m *MockManager) Start(name string, args ...string) (Process, error) {
	if m.StartFunc != nil {
		return m.StartFunc(name, args...)
	}
	return &MockProcess{}, nil
}

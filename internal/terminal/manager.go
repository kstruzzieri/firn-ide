package terminal

import "fmt"

type Manager struct {
	sessions map[string]*Session
}

func NewManager() *Manager {
	return &Manager{sessions: make(map[string]*Session)}
}

// Create creates a new terminal session and returns its ID.
func (m *Manager) Create() (string, error) {
	session, err := NewSession()
	if err != nil {
		return "", err
	}

	sessionID := fmt.Sprintf("term-%d", len(m.sessions)+1)
	m.sessions[sessionID] = session
	return sessionID, nil
}

// Get returns the session for the given ID, or false if not found.
func (m *Manager) Get(id string) (*Session, bool) {
	val, ok := m.sessions[id]
	return val, ok
}

// Write sends input data to the terminal with the given ID.
func (m *Manager) Write(id string, data []byte) error {
	session, ok := m.Get(id)
	if !ok {
		return fmt.Errorf("session not found: %s", id)
	}

	_, err := session.Write(data)
	return err
}

// Resize updates the terminal dimensions for the given ID.
func (m *Manager) Resize(id string, rows uint16, cols uint16) error {
	session, ok := m.Get(id)
	if !ok {
		return fmt.Errorf("session not found: %s", id)
	}

	return session.Resize(rows, cols)
}

// Close terminates the terminal session and removes it from the manager.
func (m *Manager) Close(id string) error {
	session, ok := m.Get(id)
	if !ok {
		return fmt.Errorf("session not found: %s", id)
	}

	err := session.Close()
	delete(m.sessions, id)
	return err
}

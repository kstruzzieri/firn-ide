package terminal

import (
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
)

type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	nextID   atomic.Uint64
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

	id := m.nextID.Add(1)
	sessionID := fmt.Sprintf("term-%d", id)

	m.mu.Lock()
	m.sessions[sessionID] = session
	m.mu.Unlock()

	return sessionID, nil
}

// Get returns the session for the given ID, or false if not found.
func (m *Manager) Get(id string) (*Session, bool) {
	m.mu.RLock()
	val, ok := m.sessions[id]
	m.mu.RUnlock()
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
	m.mu.Lock()
	session, ok := m.sessions[id]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("session not found: %s", id)
	}
	delete(m.sessions, id)
	m.mu.Unlock()

	return session.Close()
}

// CloseAll terminates all terminal sessions and returns any errors encountered.
func (m *Manager) CloseAll() error {
	m.mu.Lock()
	sessions := make(map[string]*Session, len(m.sessions))
	for k, v := range m.sessions {
		sessions[k] = v
	}
	m.sessions = make(map[string]*Session)
	m.mu.Unlock()

	var errs []error
	for id, session := range sessions {
		if err := session.Close(); err != nil {
			errs = append(errs, fmt.Errorf("closing session %s: %w", id, err))
		}
	}
	return errors.Join(errs...)
}

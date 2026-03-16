import { useState, useRef, useEffect } from 'react';
import { useIDEStore } from '../../stores/ideStore';
import type { RunProfile } from '../../types/runProfile';

interface ProfileBrowserProps {
  allProfiles: RunProfile[];
  hiddenProfileIds: string[];
}

export function ProfileBrowser({ allProfiles, hiddenProfileIds }: ProfileBrowserProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const hiddenProfiles = allProfiles.filter((p) => hiddenProfileIds.includes(p.id));

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          borderRadius: 4,
          background: 'rgba(255,255,255,0.04)',
          border: 'none',
          color: '#555',
          cursor: 'pointer',
          fontSize: 14,
        }}
        aria-label="Browse all profiles"
        title="Browse all profiles"
      >
        +
      </button>
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            width: 240,
            maxHeight: 300,
            overflowY: 'auto',
            background: '#161616',
            border: '1px solid #2a2a2a',
            borderRadius: 8,
            padding: 8,
            zIndex: 100,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: '#444',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 8,
            }}
          >
            {hiddenProfiles.length > 0 ? 'Hidden Profiles' : 'All Profiles Visible'}
          </div>
          {hiddenProfiles.length === 0 && (
            <div style={{ fontSize: 11, color: '#555', padding: '8px 0' }}>
              No hidden profiles. All discovered profiles are visible in the sidebar.
            </div>
          )}
          {hiddenProfiles.map((profile) => (
            <div
              key={profile.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 8px',
                borderRadius: 4,
                marginBottom: 2,
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: '#ccc' }}>{profile.name}</div>
                {profile.command && (
                  <div style={{ fontSize: 9, color: '#444', fontFamily: 'monospace' }}>
                    {profile.command}
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  useIDEStore.getState().unhideProfile(profile.id);
                }}
                style={{
                  fontSize: 9,
                  fontWeight: 500,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: 'rgba(56,189,248,0.10)',
                  color: '#38bdf8',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Show
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

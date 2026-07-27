//go:build windows

package filesystem

// syncDir is a no-op on Windows. FlushFileBuffers rejects directory handles, so
// there is no supported way to flush a directory's entries; MoveFileEx already
// orders the rename's metadata against the file data we fsynced before it.
func syncDir(string) error {
	return nil
}

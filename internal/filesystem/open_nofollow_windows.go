//go:build windows

package filesystem

import (
	"fmt"
	"os"
	"syscall"
)

func openReadNoFollow(path string, directory bool) (*os.File, error) {
	name, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	access := uint32(syscall.GENERIC_READ)
	flags := uint32(syscall.FILE_FLAG_OPEN_REPARSE_POINT)
	if directory {
		access = syscall.FILE_LIST_DIRECTORY
		flags |= syscall.FILE_FLAG_BACKUP_SEMANTICS
	}
	handle, err := syscall.CreateFile(
		name,
		access,
		syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE|syscall.FILE_SHARE_DELETE,
		nil,
		syscall.OPEN_EXISTING,
		flags,
		0,
	)
	if err != nil {
		return nil, &os.PathError{Op: "open", Path: path, Err: err}
	}
	// FILE_FLAG_OPEN_REPARSE_POINT is the half of O_NOFOLLOW that declines to
	// traverse; unlike O_NOFOLLOW it then hands back the link itself rather than
	// failing. Without this check the handle is a symlink and the caller reads
	// through it, so refuse here and match the unix ELOOP behavior. os.File.Stat
	// on a raw CreateFile handle does not carry the reparse tag, so ask Windows
	// directly instead of inferring the type downstream.
	var info syscall.ByHandleFileInformation
	if err := syscall.GetFileInformationByHandle(handle, &info); err != nil {
		_ = syscall.CloseHandle(handle)
		return nil, &os.PathError{Op: "stat", Path: path, Err: err}
	}
	if info.FileAttributes&syscall.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		// Not every reparse point redirects: OneDrive placeholders, dedup, and
		// WIM-backed files all carry the attribute, and refusing those would
		// break run history for anyone whose home sits under cloud sync. Only
		// the tags that actually point elsewhere are unsafe, so let os.Lstat
		// decode the tag — it reports ModeSymlink for exactly those, and the Go
		// runtime keeps that classification current as Windows adds tags. Fail
		// closed if the tag cannot be read.
		link, lerr := os.Lstat(path)
		if lerr != nil || link.Mode()&os.ModeSymlink != 0 {
			_ = syscall.CloseHandle(handle)
			return nil, fmt.Errorf("%w: %s", ErrSymlinkRefused, path)
		}
	}
	file := os.NewFile(uintptr(handle), path)
	if file == nil {
		_ = syscall.CloseHandle(handle)
		return nil, fmt.Errorf("opening %s returned an invalid handle", path)
	}
	return file, nil
}

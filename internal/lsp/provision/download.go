package provision

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// ChecksumError marks a SHA256 verification failure so callers can map it to a
// security stop (StateChecksumFailed) rather than a transient network failure.
type ChecksumError struct {
	URL  string
	Got  string
	Want string
}

func (e *ChecksumError) Error() string {
	return fmt.Sprintf("checksum mismatch for %s: got %s want %s", e.URL, e.Got, e.Want)
}

// DownloadAndVerify streams url to a temp file, verifies its SHA256 against
// wantHex (case-insensitive), and only then atomically renames it to dest. On
// any failure the temp file is removed and dest is left untouched. Caller must
// ensure dest's parent directory exists.
func DownloadAndVerify(ctx context.Context, client *http.Client, url, wantHex, dest string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("download %s: %w", url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download %s: status %d", url, resp.StatusCode)
	}

	tmp, err := os.CreateTemp(filepath.Dir(dest), ".dl-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }() // no-op after successful rename

	h := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmp, h), resp.Body); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if got := hex.EncodeToString(h.Sum(nil)); !strings.EqualFold(got, wantHex) {
		return &ChecksumError{URL: url, Got: got, Want: wantHex}
	}
	return os.Rename(tmpName, dest)
}

package provision

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// defaultFetch downloads+verifies one artifact and unzips it into destDir.
// Used when PythonDeps.Fetch is nil (production path).
func defaultFetch(ctx context.Context, a Artifact, destDir string) error {
	client := &http.Client{Timeout: 5 * time.Minute}
	tmp := filepath.Join(destDir, ".whl-"+a.SHA256[:12])
	if err := DownloadAndVerify(ctx, client, a.URL, a.SHA256, tmp); err != nil {
		return err
	}
	defer os.Remove(tmp)
	return UnzipWheel(tmp, destDir)
}

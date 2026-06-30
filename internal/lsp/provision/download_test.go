package provision

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func sha256Hex(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

func TestDownloadAndVerify_ok(t *testing.T) {
	body := []byte("fake-wheel-bytes")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(body) }))
	defer srv.Close()
	dest := filepath.Join(t.TempDir(), "out.whl")
	if err := DownloadAndVerify(context.Background(), http.DefaultClient, srv.URL, sha256Hex(body), dest); err != nil {
		t.Fatalf("DownloadAndVerify: %v", err)
	}
	got, _ := os.ReadFile(dest)
	if string(got) != string(body) {
		t.Errorf("dest contents = %q", got)
	}
}

func TestDownloadAndVerify_checksumMismatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("tampered")) }))
	defer srv.Close()
	dest := filepath.Join(t.TempDir(), "out.whl")
	err := DownloadAndVerify(context.Background(), http.DefaultClient, srv.URL, sha256Hex([]byte("expected")), dest)
	if err == nil {
		t.Fatal("expected checksum error")
	}
	var ce *ChecksumError
	if !errors.As(err, &ce) {
		t.Errorf("err = %v, want *ChecksumError", err)
	}
	if _, statErr := os.Stat(dest); statErr == nil {
		t.Error("dest must not exist after checksum failure")
	}
}

func TestDownloadAndVerify_httpError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusInternalServerError) }))
	defer srv.Close()
	dest := filepath.Join(t.TempDir(), "out.whl")
	if err := DownloadAndVerify(context.Background(), http.DefaultClient, srv.URL, "abc", dest); err == nil {
		t.Fatal("expected http error")
	}
}

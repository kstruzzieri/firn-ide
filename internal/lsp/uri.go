package lsp

import (
	"fmt"
	"net/url"
	"path/filepath"
	"runtime"
	"strings"
)

// FileToURI converts an absolute file path to a file:// URI.
// Returns an error if the path is not absolute.
// Handles platform differences: on Windows, drive letters are lowercased
// and backslashes are converted to forward slashes.
func FileToURI(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("FileToURI requires an absolute path, got %q", path)
	}

	path = filepath.ToSlash(path)

	// On Windows, paths start with a drive letter (e.g., C:/...)
	// and need an extra leading slash in the URI: file:///C:/...
	if len(path) >= 2 && path[1] == ':' {
		path = "/" + strings.ToLower(path[:1]) + path[1:]
	}

	// Percent-encode path segments but preserve slashes
	segments := strings.Split(path, "/")
	for i, seg := range segments {
		segments[i] = url.PathEscape(seg)
	}

	return "file://" + strings.Join(segments, "/"), nil
}

// URIToFile converts a file:// URI back to a native file path.
// Returns an error if the URI scheme is not "file" or contains a hostname.
func URIToFile(uri string) (string, error) {
	parsed, err := url.Parse(uri)
	if err != nil {
		return "", fmt.Errorf("invalid URI %q: %w", uri, err)
	}
	if parsed.Scheme != "file" {
		return "", fmt.Errorf("unsupported URI scheme %q (expected \"file\")", parsed.Scheme)
	}
	if parsed.Host != "" {
		return "", fmt.Errorf("file URI with host %q not supported", parsed.Host)
	}

	path := parsed.Path

	// On Windows, the path will be /C:/... — strip the leading slash
	if runtime.GOOS == "windows" && len(path) >= 3 && path[0] == '/' && path[2] == ':' {
		path = path[1:]
	}

	// Unescape percent-encoded characters
	path, err = url.PathUnescape(path)
	if err != nil {
		return "", fmt.Errorf("failed to unescape URI path %q: %w", parsed.Path, err)
	}

	path = filepath.Clean(filepath.FromSlash(path))
	return path, nil
}

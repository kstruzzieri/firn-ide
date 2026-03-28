package lsp

import (
	"runtime"
	"testing"
)

func TestFileToURI_Unix(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix path test")
	}

	tests := []struct {
		path string
		want string
	}{
		{"/home/user/project/main.go", "file:///home/user/project/main.go"},
		{"/tmp/file with spaces.ts", "file:///tmp/file%20with%20spaces.ts"},
		{"/usr/local/bin/test", "file:///usr/local/bin/test"},
	}

	for _, tt := range tests {
		got, err := FileToURI(tt.path)
		if err != nil {
			t.Errorf("FileToURI(%q) error: %v", tt.path, err)
			continue
		}
		if got != tt.want {
			t.Errorf("FileToURI(%q) = %q, want %q", tt.path, got, tt.want)
		}
	}
}

func TestFileToURI_RejectsRelativePath(t *testing.T) {
	_, err := FileToURI("relative/path.ts")
	if err == nil {
		t.Error("expected error for relative path")
	}
}

func TestURIToFile_Unix(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix path test")
	}

	tests := []struct {
		uri  string
		want string
	}{
		{"file:///home/user/project/main.go", "/home/user/project/main.go"},
		{"file:///tmp/file%20with%20spaces.ts", "/tmp/file with spaces.ts"},
	}

	for _, tt := range tests {
		got, err := URIToFile(tt.uri)
		if err != nil {
			t.Errorf("URIToFile(%q) error: %v", tt.uri, err)
			continue
		}
		if got != tt.want {
			t.Errorf("URIToFile(%q) = %q, want %q", tt.uri, got, tt.want)
		}
	}
}

func TestURIToFile_RejectsHostAuthority(t *testing.T) {
	_, err := URIToFile("file://remote-host/share/file.txt")
	if err == nil {
		t.Error("expected error for file URI with host authority")
	}
}

func TestURIToFile_WindowsFormat(t *testing.T) {
	uri := "file:///c:/Users/test/project/main.ts"
	got, err := URIToFile(uri)
	if err != nil {
		t.Fatalf("URIToFile(%q) error: %v", uri, err)
	}

	if runtime.GOOS == "windows" {
		if got != `c:\Users\test\project\main.ts` {
			t.Errorf("URIToFile(%q) = %q, want %q", uri, got, `c:\Users\test\project\main.ts`)
		}
	} else {
		if got != "/c:/Users/test/project/main.ts" {
			t.Errorf("URIToFile(%q) = %q, want %q", uri, got, "/c:/Users/test/project/main.ts")
		}
	}
}

func TestURIToFile_Roundtrip(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix roundtrip test")
	}

	paths := []string{
		"/home/user/project/main.go",
		"/tmp/test file.ts",
		"/var/data/café.txt",
	}

	for _, path := range paths {
		uri, err := FileToURI(path)
		if err != nil {
			t.Errorf("FileToURI(%q) error: %v", path, err)
			continue
		}
		got, err := URIToFile(uri)
		if err != nil {
			t.Errorf("roundtrip %q: URIToFile error: %v", path, err)
			continue
		}
		if got != path {
			t.Errorf("roundtrip %q: got %q via URI %q", path, got, uri)
		}
	}
}

func TestURIToFile_InvalidScheme(t *testing.T) {
	_, err := URIToFile("https://example.com/file.ts")
	if err == nil {
		t.Error("expected error for non-file URI scheme")
	}
}

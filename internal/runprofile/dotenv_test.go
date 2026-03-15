package runprofile

import (
	"os"
	"path/filepath"
	"testing"
)

func writeTempEnv(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestParseEnvFile_BasicPairs(t *testing.T) {
	path := writeTempEnv(t, "KEY=VALUE\nFOO=BAR\n")
	env, err := ParseEnvFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if env["KEY"] != "VALUE" {
		t.Errorf("KEY = %q, want %q", env["KEY"], "VALUE")
	}
	if env["FOO"] != "BAR" {
		t.Errorf("FOO = %q, want %q", env["FOO"], "BAR")
	}
}

func TestParseEnvFile_Comments(t *testing.T) {
	path := writeTempEnv(t, "# this is a comment\nKEY=VALUE\n  # indented comment\n")
	env, err := ParseEnvFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(env) != 1 {
		t.Errorf("got %d entries, want 1", len(env))
	}
	if env["KEY"] != "VALUE" {
		t.Errorf("KEY = %q, want %q", env["KEY"], "VALUE")
	}
}

func TestParseEnvFile_BlankLines(t *testing.T) {
	path := writeTempEnv(t, "\n\nKEY=VALUE\n\n")
	env, err := ParseEnvFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(env) != 1 {
		t.Errorf("got %d entries, want 1", len(env))
	}
}

func TestParseEnvFile_DoubleQuoted(t *testing.T) {
	path := writeTempEnv(t, `KEY="hello world"`)
	env, err := ParseEnvFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if env["KEY"] != "hello world" {
		t.Errorf("KEY = %q, want %q", env["KEY"], "hello world")
	}
}

func TestParseEnvFile_SingleQuoted(t *testing.T) {
	path := writeTempEnv(t, `KEY='hello'`)
	env, err := ParseEnvFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if env["KEY"] != "hello" {
		t.Errorf("KEY = %q, want %q", env["KEY"], "hello")
	}
}

func TestParseEnvFile_NoEqualsSkipped(t *testing.T) {
	path := writeTempEnv(t, "INVALID LINE\nKEY=VALUE\n")
	env, err := ParseEnvFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(env) != 1 {
		t.Errorf("got %d entries, want 1", len(env))
	}
	if env["KEY"] != "VALUE" {
		t.Errorf("KEY = %q, want %q", env["KEY"], "VALUE")
	}
}

func TestParseEnvFile_Whitespace(t *testing.T) {
	path := writeTempEnv(t, "  KEY = VALUE  \n")
	env, err := ParseEnvFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if env["KEY"] != "VALUE" {
		t.Errorf("KEY = %q, want %q", env["KEY"], "VALUE")
	}
}

func TestParseEnvFile_ExportPrefix(t *testing.T) {
	path := writeTempEnv(t, "export KEY=VALUE\nexport FOO=\"bar\"\n")
	env, err := ParseEnvFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if env["KEY"] != "VALUE" {
		t.Errorf("KEY = %q, want %q", env["KEY"], "VALUE")
	}
	if env["FOO"] != "bar" {
		t.Errorf("FOO = %q, want %q", env["FOO"], "bar")
	}
}

func TestParseEnvFile_MissingFile(t *testing.T) {
	_, err := ParseEnvFile("/nonexistent/.env")
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestParseEnvFile_EmptyFile(t *testing.T) {
	path := writeTempEnv(t, "")
	env, err := ParseEnvFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(env) != 0 {
		t.Errorf("got %d entries, want 0", len(env))
	}
}

func TestParseEnvFile_ValueWithEquals(t *testing.T) {
	path := writeTempEnv(t, "DATABASE_URL=postgres://user:pass@host/db?sslmode=require\n")
	env, err := ParseEnvFile(path)
	if err != nil {
		t.Fatal(err)
	}
	want := "postgres://user:pass@host/db?sslmode=require"
	if env["DATABASE_URL"] != want {
		t.Errorf("DATABASE_URL = %q, want %q", env["DATABASE_URL"], want)
	}
}

func TestParseEnvFile_EmptyValue(t *testing.T) {
	path := writeTempEnv(t, "KEY=\n")
	env, err := ParseEnvFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if env["KEY"] != "" {
		t.Errorf("KEY = %q, want empty string", env["KEY"])
	}
}

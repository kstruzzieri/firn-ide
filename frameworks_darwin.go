//go:build darwin

package main

// macOS dev builds (`wails dev`, i.e. `-tags dev`) pull in devserver code that
// references the UniformTypeIdentifiers framework (the UTType class). Recent
// Go/macOS toolchains no longer auto-link that framework, so the dev build fails
// at link time with "Undefined symbols: _OBJC_CLASS_$_UTType". Linking it here
// fixes the dev build; it is a harmless no-op for production builds that don't
// reference UTType.

/*
#cgo LDFLAGS: -framework UniformTypeIdentifiers
*/
import "C"

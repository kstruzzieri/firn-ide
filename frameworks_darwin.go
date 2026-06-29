//go:build darwin && dev

package main

// Dev builds only (`wails dev`, i.e. `-tags dev`). The dev devserver pulls in
// code that references the UniformTypeIdentifiers framework (the UTType class);
// recent Go/macOS toolchains no longer auto-link it, so the dev build fails at
// link time with "Undefined symbols: _OBJC_CLASS_$_UTType". This links it.
//
// It is deliberately gated to the `dev` tag: production builds (`wails build`)
// never reference UTType and must NOT strong-link UniformTypeIdentifiers, which
// only exists on macOS 11+. Info.plist advertises LSMinimumSystemVersion 10.13,
// and a strong `-framework` load dependency would abort release binaries at
// launch on macOS 10.13–10.15.

/*
#cgo LDFLAGS: -framework UniformTypeIdentifiers
*/
import "C"

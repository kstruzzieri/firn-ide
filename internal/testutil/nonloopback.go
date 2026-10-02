// Package testutil holds small test helpers shared across internal packages.
// It must import only the standard library so every internal package can
// depend on it without risking an import cycle.
package testutil

import (
	"net"
	"os"
	"testing"
)

// ListenNonLoopback binds a listener on the host's first non-loopback IPv4
// address so a stub server is classified REMOTE by go-llm's destination
// admission (classification is lexical: only literal loopback/localhost is
// local) yet is actually reachable from this process. Skips the test when
// the host has no non-loopback IPv4 interface -- unless FIRN_REQUIRE_NONLOOPBACK
// is set to "1" (CI sets it on the backend-tests job), in which case that
// absence fails the test instead: a runner silently missing the interface
// must not let the REMOTE-classification coverage quietly disappear.
func ListenNonLoopback(t testing.TB) (net.Listener, string) {
	t.Helper()
	stop := t.Skip
	if os.Getenv("FIRN_REQUIRE_NONLOOPBACK") == "1" {
		stop = t.Fatal
	}
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		stop("interfaces unavailable: " + err.Error())
	}
	for _, a := range addrs {
		ipn, ok := a.(*net.IPNet)
		if !ok || ipn.IP.IsLoopback() || ipn.IP.To4() == nil {
			continue
		}
		ln, err := net.Listen("tcp", net.JoinHostPort(ipn.IP.String(), "0"))
		if err != nil {
			continue
		}
		t.Cleanup(func() { _ = ln.Close() })
		return ln, "http://" + ln.Addr().String()
	}
	stop("no non-loopback IPv4 interface")
	return nil, ""
}

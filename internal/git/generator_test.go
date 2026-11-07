package git

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/kstruzzieri/go-llm/agent"
	"github.com/kstruzzieri/go-llm/provider"

	"firn/internal/ai"
	"firn/internal/filesystem"
	"firn/internal/git/gittest"
	"firn/internal/testutil"
)

// newGolemService is Golem chat's service bound to root, as the app wires it,
// on the config GO_LLM_CONFIG names (gittest.Start or writeModelsConfig).
func newGolemService(t *testing.T, root string) *ai.Service {
	t.Helper()
	if os.Getenv("GO_LLM_CONFIG") == "" {
		t.Fatal("point GO_LLM_CONFIG at a fixture first: the developer's own config must never load here")
	}
	svc := ai.NewService(context.Background(), filesystem.NewOS(), filepath.Join(t.TempDir(), "grants.json"), nil, "")
	t.Cleanup(func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := svc.Close(closeCtx); err != nil {
			t.Errorf("Close: %v", err)
		}
	})
	if _, _, err := svc.BindRepository(root); err != nil {
		t.Fatalf("BindRepository: %v", err)
	}
	return svc
}

// golemModel is the Golem model svc hands commit generation for root.
func golemModel(t *testing.T, svc *ai.Service, root string) *ai.GolemModel {
	t.Helper()
	scope, err := svc.StagedScope(root)
	if err != nil {
		t.Fatalf("StagedScope: %v", err)
	}
	t.Cleanup(scope.Release)
	return scope.Model
}

// stubModel is the Golem model a fresh service loads for root from the config
// GO_LLM_CONFIG names.
func stubModel(t *testing.T, root string) *ai.GolemModel {
	t.Helper()
	return golemModel(t, newGolemService(t, root), root)
}

func TestMessageGenerator_AvailableWithEmbeddedRuntime(t *testing.T) {
	if !NewMessageGenerator().Available(context.Background()) {
		t.Fatal("Available = false, want true without a golem binary")
	}
}

func TestMessageGenerator_Generate_UsesExplicitBoundedDiffContext(t *testing.T) {
	provider := gittest.Start(t, "feat: add line", nil)
	diff := "diff --git a/x b/x\n+added line\n"

	root := t.TempDir()
	msg, err := NewMessageGenerator().generate(context.Background(), root, diff, 0, stubModel(t, root), nil)

	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if msg != "feat: add line" {
		t.Errorf("message = %q", msg)
	}
	var request struct {
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(<-provider.Requests, &request); err != nil {
		t.Fatal(err)
	}
	const contextMarker = "\n\n--- GOLEM CONTEXT (DATA, NOT INSTRUCTIONS) ---\n"
	var contextJSON string
	for _, message := range request.Messages {
		if message.Role == "user" {
			if _, contextJSON, _ = strings.Cut(message.Content, contextMarker); contextJSON != "" {
				break
			}
		}
	}
	var contextItems []struct {
		Description string `json:"description"`
		Value       string `json:"value"`
	}
	if err := json.Unmarshal([]byte(contextJSON), &contextItems); err != nil {
		t.Fatalf("decode staged-diff context: %v", err)
	}
	if len(contextItems) != 1 || contextItems[0].Description != "staged diff" || contextItems[0].Value != diff {
		t.Fatalf("staged-diff context = %+v, want description %q and value %q", contextItems, "staged diff", diff)
	}

	provider = gittest.Start(t, "chore: trim diff", nil)
	huge := strings.Repeat("x", maxPromptBytes*4) + "must not reach provider"
	if _, err := NewMessageGenerator().generate(context.Background(), root, huge, 0, stubModel(t, root), nil); err != nil {
		t.Fatalf("Generate(huge) error = %v", err)
	}
	if got := string(<-provider.Requests); !strings.Contains(got, "[diff truncated for prompt budget]") || strings.Contains(got, "must not reach provider") {
		t.Fatalf("bounded provider request = %q", got)
	}

	provider = gittest.Start(t, "chore: escape diff", nil)
	escapeHeavy := strings.Repeat("<", maxPromptBytes) + "must not reach provider"
	if _, err := NewMessageGenerator().generate(context.Background(), root, escapeHeavy, 0, stubModel(t, root), nil); err != nil {
		t.Fatalf("Generate(escape-heavy) error = %v", err)
	}
	var escapedRequest struct {
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(<-provider.Requests, &escapedRequest); err != nil {
		t.Fatal(err)
	}
	var escapedContextJSON string
	for _, message := range escapedRequest.Messages {
		if message.Role == "user" {
			if _, escapedContextJSON, _ = strings.Cut(message.Content, contextMarker); escapedContextJSON != "" {
				break
			}
		}
	}
	var escapedContext []struct {
		Description string `json:"description"`
		Value       string `json:"value"`
	}
	if err := json.Unmarshal([]byte(escapedContextJSON), &escapedContext); err != nil {
		t.Fatalf("decode escaped staged-diff context: %v", err)
	}
	if len(escapedContext) != 1 || !strings.Contains(escapedContext[0].Value, "[diff truncated for prompt budget]") || strings.Contains(escapedContext[0].Value, "must not reach provider") {
		t.Fatalf("escaped staged-diff context = %+v", escapedContext)
	}
	serializedContext, err := json.Marshal(escapedContext)
	if err != nil {
		t.Fatal(err)
	}
	if len(serializedContext) > maxPromptBytes {
		t.Fatalf("serialized staged-diff context is %d bytes, want at most %d", len(serializedContext), maxPromptBytes)
	}
}

func TestMessageGenerator_Generate_EmptyDiff(t *testing.T) {
	_, err := NewMessageGenerator().generate(context.Background(), t.TempDir(), " \n\t", 0, nil, nil)
	if err == nil || !strings.Contains(err.Error(), "nothing staged") {
		t.Fatalf("Generate() error = %v, want nothing-staged error", err)
	}
}

func TestMessageGenerator_Generate_NoModelSendsNothing(t *testing.T) {
	_, err := NewMessageGenerator().generate(context.Background(), t.TempDir(), "+change\n", 0, nil, nil)

	if !errors.Is(err, errNoGolemModel) {
		t.Fatalf("Generate() error = %v, want errNoGolemModel", err)
	}
}

func TestMessageGenerator_Generate_RuntimeFailure(t *testing.T) {
	gittest.Start(t, "", func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "model unavailable", http.StatusServiceUnavailable)
	})
	root := t.TempDir()

	_, err := NewMessageGenerator().generate(context.Background(), root, "+change\n", 0, stubModel(t, root), nil)

	if err == nil || !strings.Contains(err.Error(), "golem runtime") {
		t.Fatalf("Generate() error = %v, want golem runtime failure", err)
	}
}

// The input budget follows the Golem model's declared window; with none, the
// model still answers (#506) and the provider's own limit applies. A prompt
// that cannot fit, or a window too small to budget, sends nothing.
func TestMessageGenerator_Generate_ContextBudget(t *testing.T) {
	bigDiff := "diff --git a/x b/x\n" + strings.Repeat("+a line the model has to read\n", 600)
	for _, tc := range []struct {
		name    string
		window  int
		diff    string
		refused bool
	}{
		{name: "no declared window", diff: sampleDiff},
		{name: "declared window", window: 32768, diff: bigDiff},
		{name: "window smaller than the prompt", window: 2048, diff: bigDiff, refused: true},
		{name: "window of one", window: 1, diff: sampleDiff, refused: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/v1/chat/completions" {
					calls.Add(1)
				}
				chatStubHandler("feat: budgeted").ServeHTTP(w, r)
			}))
			t.Cleanup(server.Close)
			window := ""
			if tc.window != 0 {
				window = fmt.Sprintf(`"context_window":%d,`, tc.window)
			}
			writeModelsConfig(t, fmt.Sprintf(`{
				"providers":{"primary":{"base_url":%q,"api_format":"openai-compat","timeout":"2s"}},
				"models":{"primary":{"name":"chat-model","provider":"primary","type":"dense",%s"capabilities":["chat","stream","tool_call"]}},
				"defaults":{"agent":"primary"}
			}`, server.URL, window))
			root := t.TempDir()

			message, err := NewMessageGenerator().generate(context.Background(), root, tc.diff, 0, stubModel(t, root), nil)

			if !tc.refused {
				if err != nil || message != "feat: budgeted" || calls.Load() != 1 {
					t.Fatalf("Generate() = %q, %v; calls = %d, want the message from one request", message, err, calls.Load())
				}
				return
			}
			if message != "" || !errors.Is(err, ai.ErrContextWindowTooSmall) || calls.Load() != 0 {
				t.Fatalf("Generate() = %q, %v; calls = %d, want a refusal before any request", message, err, calls.Load())
			}
			if want := fmt.Sprintf("context window (context_window %d)", tc.window); !strings.Contains(err.Error(), want) {
				t.Errorf("Generate() error = %v, want it to name %q", err, want)
			}
		})
	}
}

func TestRunError_CancellationOutranksContextWindow(t *testing.T) {
	for _, tc := range []struct {
		name       string
		err        error
		wantSentry error
		wantWindow bool
	}{
		{"exhausted alone", agent.ErrContextExhausted, ai.ErrContextWindowTooSmall, true},
		{"exhausted joined with cancel", errors.Join(agent.ErrContextExhausted, context.Canceled), context.Canceled, false},
		{"exhausted joined with deadline", errors.Join(agent.ErrContextExhausted, context.DeadlineExceeded), context.DeadlineExceeded, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := runError(tc.err, 1024)
			if !errors.Is(got, tc.wantSentry) {
				t.Errorf("runError() = %v, want it to wrap %v", got, tc.wantSentry)
			}
			if strings.Contains(got.Error(), "context window") != tc.wantWindow {
				t.Errorf("runError() = %v, context window advice want %v", got, tc.wantWindow)
			}
		})
	}
}

// A failing Golem model fails the generation: nothing falls back to another
// model, however the configuration chains them for the golem CLI.
func TestMessageGenerator_Generate_PrimaryFailureDoesNotFallBack(t *testing.T) {
	var fallbackCalls atomic.Int32
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "primary unavailable", http.StatusServiceUnavailable)
	}))
	t.Cleanup(primary.Close)
	startFallback := func() *httptest.Server {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fallbackCalls.Add(1)
			chatStubHandler("feat: fallback").ServeHTTP(w, r)
		}))
		t.Cleanup(server.Close)
		return server
	}
	fast, local := startFallback(), startFallback()
	writeModelsConfig(t, fmt.Sprintf(`{
		"providers":{
			"commandcode":{"base_url":%q,"api_format":"openai-compat","timeout":"2s"},
			"opencode":{"base_url":%q,"api_format":"openai-compat","timeout":"2s"},
			"lan":{"base_url":%q,"api_format":"openai-compat","timeout":"2s"}
		},
		"models":{
			"fast":{"name":"chat-model","provider":"commandcode","type":"dense","context_window":32768,"capabilities":["chat","stream","tool_call"],"fallbacks":["fast-go"]},
			"fast-go":{"name":"chat-model","provider":"opencode","type":"dense","context_window":32768,"capabilities":["chat","stream","tool_call"],"fallbacks":["fast-local"]},
			"fast-local":{"name":"chat-model","provider":"lan","type":"dense","context_window":32768,"capabilities":["chat","stream","tool_call"]}
		},
		"defaults":{"agent":"fast"}
	}`, primary.URL, fast.URL, local.URL))
	root := t.TempDir()

	message, err := NewMessageGenerator().generate(context.Background(), root, sampleDiff, 0, stubModel(t, root), nil)

	if message != "" || err == nil || !strings.Contains(err.Error(), "503") {
		t.Fatalf("Generate() = %q, %v, want the primary's 503", message, err)
	}
	if got := fallbackCalls.Load(); got != 0 {
		t.Fatalf("fallback stubs received %d request(s)", got)
	}

	primary.Close()
	message, err = NewMessageGenerator().generate(context.Background(), root, sampleDiff, 0, stubModel(t, root), nil)
	if message != "" || !errors.Is(err, syscall.ECONNREFUSED) {
		t.Fatalf("Generate() with a closed primary = %q, %v, want connection refused", message, err)
	}
	if got := fallbackCalls.Load(); got != 0 {
		t.Fatalf("fallback stubs received %d request(s) after the primary closed", got)
	}
}

// A generation is its own conversation: its random thread lives only in
// memory, and like chat it sends no session header to an endpoint that is not
// opencode itself.
func TestMessageGenerator_Generate_UsesEphemeralSession(t *testing.T) {
	sessions := make(chan string, 8)
	handler := chatStubHandler("chore: generated message")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/chat/completions" {
			sessions <- r.Header.Get("x-opencode-session")
		}
		handler.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	writeModelsConfig(t, fmt.Sprintf(`{
		"providers":{"primary":{"base_url":%q,"api_format":"openai-compat","timeout":"2s"}},
		"models":{"primary":{"name":"chat-model","provider":"primary","type":"dense","context_window":32768,"capabilities":["chat","stream","tool_call"]}},
		"defaults":{"agent":"primary"}
	}`, server.URL))
	dataDir := t.TempDir()
	t.Setenv("XDG_DATA_HOME", dataDir)
	root := t.TempDir()
	model := stubModel(t, root)
	gen := NewMessageGenerator()
	for range 2 {
		message, err := gen.generate(context.Background(), root, sampleDiff, 0, model, nil)
		if err != nil || message != "chore: generated message" {
			t.Fatalf("Generate() = %q, %v", message, err)
		}
		if session := <-sessions; session != "" {
			t.Fatalf("session header %q reached an endpoint that is not opencode", session)
		}
	}
	entries, err := os.ReadDir(dataDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("generation persisted data: entries = %v, err = %v", entries, err)
	}
}

// At opencode a generation is a conversation of its own: each one sends a
// session header of its own, blinded as chat's are. The transport dials an
// in-process TLS server while the request URL stays https://opencode.ai.
func TestMessageGenerator_Generate_SendsOpencodeAFreshSessionPerGeneration(t *testing.T) {
	sessions := make(chan string, 4)
	handler := chatStubHandler("feat: opencode message")
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/chat/completions") {
			sessions <- r.Header.Get("x-opencode-session")
			r.URL.Path = "/v1/chat/completions"
		}
		handler.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	// The model's transport is a hardened clone of http.DefaultTransport: make
	// every dial reach the test server, its certificate verified under the
	// name it was issued for.
	base := server.Client().Transport.(*http.Transport).Clone()
	base.TLSClientConfig.ServerName = "example.com"
	base.DialContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
	}
	previous := http.DefaultTransport
	http.DefaultTransport = base
	t.Cleanup(func() { http.DefaultTransport = previous })
	writeModelsConfig(t, `{
		"providers":{"zen":{"base_url":"https://opencode.ai/zen/v1","api_format":"openai-compat","timeout":"5s"}},
		"models":{"coder":{"name":"chat-model","provider":"zen","type":"dense","context_window":32768,"capabilities":["chat","stream","tool_call"]}},
		"defaults":{"agent":"coder"}
	}`)
	root := t.TempDir()
	svc := newGolemService(t, root)
	prepared, err := svc.PrepareDestinationGrants()
	if err != nil || prepared.Status != "consent_required" {
		t.Fatalf("PrepareDestinationGrants = %+v, %v", prepared, err)
	}
	if granted, err := svc.ConfirmDestinationGrants(prepared.Challenge.Token); err != nil || granted.Status != "granted" {
		t.Fatalf("ConfirmDestinationGrants = %+v, %v", granted, err)
	}
	model := golemModel(t, svc, root)
	gen := NewMessageGenerator()

	var seen []string
	for range 2 {
		if message, err := gen.generate(context.Background(), root, sampleDiff, 0, model, nil); err != nil || message != "feat: opencode message" {
			t.Fatalf("Generate() = %q, %v", message, err)
		}
		seen = append(seen, <-sessions)
	}

	for _, session := range seen {
		if !strings.HasPrefix(session, "firn-") || strings.HasPrefix(session, "firn-commit-") {
			t.Fatalf("session header %q, want a blinded firn- value, never the thread ID", session)
		}
	}
	if seen[0] == seen[1] {
		t.Fatal("two generations sent opencode the same session")
	}
}

func TestMessageGenerator_Generate_DoesNotSendToolReadResultsToProvider(t *testing.T) {
	const secret = "firn-provider-boundary-secret"
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "secret.txt"), []byte(secret), 0o600); err != nil {
		t.Fatal(err)
	}

	var calls atomic.Int32
	provider := gittest.Start(t, "", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		if calls.Add(1) == 1 {
			_, _ = fmt.Fprint(w, "data: {\"model\":\"qwen3-coder-next:latest\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"tool_calls\":[{\"index\":0,\"id\":\"call_secret\",\"type\":\"function\",\"function\":{\"name\":\"read_file\",\"arguments\":\"{\\\"path\\\":\\\"secret.txt\\\"}\"}}]},\"finish_reason\":null}]}\n\n")
			_, _ = fmt.Fprint(w, "data: {\"model\":\"qwen3-coder-next:latest\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n")
		} else {
			_, _ = fmt.Fprint(w, "data: {\"model\":\"qwen3-coder-next:latest\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"chore: avoid leak\"},\"finish_reason\":\"stop\"}]}\n\n")
		}
		_, _ = fmt.Fprint(w, "data: {\"model\":\"qwen3-coder-next:latest\",\"choices\":[],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":2,\"total_tokens\":4}}\n\n")
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	})

	if _, err := NewMessageGenerator().generate(context.Background(), root, "+change\n", 0, stubModel(t, root), nil); err == nil || !strings.Contains(err.Error(), "unusable") {
		t.Errorf("Generate() error = %v, want tool-only turn rejected as unusable", err)
	}

	var requests [][]byte
	for len(provider.Requests) > 0 {
		requests = append(requests, <-provider.Requests)
	}
	if len(requests) != 1 {
		t.Errorf("provider requests = %d, want one", len(requests))
	}
	for i, request := range requests {
		if strings.Contains(string(request), secret) {
			t.Errorf("provider request %d contains workspace secret", i+1)
		}
	}
}

func TestMessageGenerator_Generate_PropagatesCancellation(t *testing.T) {
	started := make(chan struct{})
	gittest.Start(t, "", func(_ http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
	})
	root := t.TempDir()
	model := stubModel(t, root)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	errCh := make(chan error, 1)
	go func() {
		_, err := NewMessageGenerator().generate(ctx, root, "+change\n", 0, model, nil)
		errCh <- err
	}()
	<-started
	cancel()
	if err := <-errCh; !errors.Is(err, context.Canceled) {
		t.Fatalf("Generate() error = %v, want context.Canceled", err)
	}
}

func TestMessageGenerator_Generate_RejectsUnusableOutput(t *testing.T) {
	for _, answer := range []string{" \n\t", "feat: bad\x00message"} {
		t.Run(fmt.Sprintf("%q", answer), func(t *testing.T) {
			gittest.Start(t, answer, nil)
			root := t.TempDir()
			_, err := NewMessageGenerator().generate(context.Background(), root, "+change\n", 0, stubModel(t, root), nil)
			if err == nil || !strings.Contains(err.Error(), "golem returned") {
				t.Fatalf("Generate() error = %v, want unusable-output error", err)
			}
		})
	}
}

// sampleDiff is a minimal staged-diff fixture shared by the destination-
// policy tests below; it mirrors the inline literal already used by
// TestMessageGenerator_Generate_UsesExplicitBoundedDiffContext above.
const sampleDiff = "diff --git a/x b/x\n+added line\n"

// writeModelsConfig writes a models.json fixture and points GO_LLM_CONFIG at
// it for the duration of the test.
func writeModelsConfig(t *testing.T, body string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "models.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GO_LLM_CONFIG", path)
}

// chatStubModel is the model name every fixture's model "name" field uses.
const chatStubModel = "chat-model"

// chatStubHandler answers the OpenAI-compatible chat-completion endpoint,
// streaming answer as the assistant's reply, and the models listing, which
// generation must never need.
func chatStubHandler(answer string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/models", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"data":[{"id":%q}]}`, chatStubModel)
	})
	mux.HandleFunc("/v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		encoded, _ := json.Marshal(answer)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprintf(w, "data: {\"model\":%q,\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":%s},\"finish_reason\":\"stop\"}]}\n\n", chatStubModel, encoded)
		_, _ = fmt.Fprintf(w, "data: {\"model\":%q,\"choices\":[],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":2,\"total_tokens\":4}}\n\n", chatStubModel)
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	})
	return mux
}

// startRemoteStub serves answer on a non-loopback listener (a remote
// destination) and counts every request it receives.
func startRemoteStub(t *testing.T, answer string) (baseURL string, requests *atomic.Int32) {
	t.Helper()
	ln, baseURL := testutil.ListenNonLoopback(t)
	requests = &atomic.Int32{}
	handler := chatStubHandler(answer)
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		handler.ServeHTTP(w, r)
	})}
	go func() { _ = server.Serve(ln) }()
	t.Cleanup(func() { _ = server.Close() })
	writeModelsConfig(t, fmt.Sprintf(`{
		"providers":{"remote":{"base_url":%q,"api_format":"openai-compat","timeout":"2s","api_key":"sk-test-secret"}},
		"models":{"chat-model":{"name":"chat-model","provider":"remote","type":"dense","context_window":32768,"capabilities":["chat","stream","tool_call"]}},
		"defaults":{"agent":"chat-model"}
	}`, baseURL))
	return baseURL, requests
}

// A remote Golem model without a grant is refused before any byte reaches
// it, with the message generation has always shown for a denied destination.
func TestGenerateDeniesUngrantedRemoteDestination(t *testing.T) {
	baseURL, requests := startRemoteStub(t, "feat: must not be asked")
	root := t.TempDir()

	_, err := NewMessageGenerator().generate(context.Background(), root, sampleDiff, 0, stubModel(t, root), nil)

	if !errors.Is(err, provider.ErrDestinationDenied) {
		t.Fatalf("want destination denial, got %v", err)
	}
	canonical, _, nerr := ai.NormalizeEndpoint(baseURL)
	if nerr != nil {
		t.Fatal(nerr)
	}
	want := "commit message generation blocked: destination remote/" + canonical +
		" is not consented for agent; use Approve missing destinations in the Golem configuration view"
	if !strings.HasPrefix(err.Error(), want) {
		t.Fatalf("error = %q, want it to start %q", err, want)
	}
	if strings.Contains(err.Error(), "sk-test-secret") {
		t.Fatal("denial message leaked config material")
	}
	if got := requests.Load(); got != 0 {
		t.Fatalf("the remote stub received %d request(s)", got)
	}
}

// Once approved, as the Golem configuration view approves it, the remote
// Golem model answers.
func TestGenerateSucceedsAgainstGrantedRemoteListener(t *testing.T) {
	_, requests := startRemoteStub(t, "feat: remote message")
	root := t.TempDir()
	svc := newGolemService(t, root)
	prepared, err := svc.PrepareDestinationGrants()
	if err != nil || prepared.Status != "consent_required" || len(prepared.Challenge.Destinations) != 1 {
		t.Fatalf("PrepareDestinationGrants = %+v, %v, want the one remote", prepared, err)
	}
	if granted, err := svc.ConfirmDestinationGrants(prepared.Challenge.Token); err != nil || granted.Status != "granted" {
		t.Fatalf("ConfirmDestinationGrants = %+v, %v", granted, err)
	}

	msg, err := NewMessageGenerator().generate(context.Background(), root, sampleDiff, 0, golemModel(t, svc, root), nil)

	if err != nil || msg != "feat: remote message" || requests.Load() != 1 {
		t.Fatalf("want a message from one request, got %q, %v, %d request(s)", msg, err, requests.Load())
	}
}

// Generating reads nothing back from the configuration and writes nothing to it.
func TestGenerateLeavesTheConfigurationUnchanged(t *testing.T) {
	gittest.Start(t, "feat: unchanged", nil)
	before, err := os.ReadFile(os.Getenv("GO_LLM_CONFIG"))
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()

	if _, err := NewMessageGenerator().generate(context.Background(), root, sampleDiff, 0, stubModel(t, root), nil); err != nil {
		t.Fatal(err)
	}

	if after, err := os.ReadFile(os.Getenv("GO_LLM_CONFIG")); err != nil || !bytes.Equal(after, before) {
		t.Fatalf("configuration after generation = %q, %v, want its bytes unchanged", after, err)
	}
}

// F14: scrubbed, bounded, rune-safe, sentinel-preserving.
func TestDestinationDeniedMessageIsScrubbedAndBounded(t *testing.T) {
	inner := &provider.DestinationDeniedError{Provider: "p", Purpose: "agent\nx\u2028y\u200b"}
	msg, ok := destinationDeniedMessage(fmt.Errorf("wrapper sk-synthetic-secret: %w", inner))
	if !ok || strings.Contains(msg, "sk-synthetic-secret") || strings.ContainsAny(msg, "\n\u2028\u200b") {
		t.Fatalf("scrub failed: %q %v", msg, ok)
	}

	// baseline measures the fixed-prose length with a purpose that scrubs to
	// empty (a lone Cf rune, not the "" input -- that takes the "unknown
	// purpose" fallback instead), so the cap's contribution below is derived
	// rather than a hand-computed magic number.
	baseline, _ := destinationDeniedMessage(&provider.DestinationDeniedError{Provider: "p", Purpose: "\u200b"})
	want := utf8.RuneCountInString(baseline) + deniedFieldCap

	long := strings.Repeat("中", 2*deniedFieldCap)
	msg, _ = destinationDeniedMessage(&provider.DestinationDeniedError{Provider: "p", Purpose: long})
	if utf8.RuneCountInString(msg) != want || !utf8.ValidString(msg) {
		t.Fatalf("truncation not rune-safe/bounded: got %d runes (want %d), valid=%v", utf8.RuneCountInString(msg), want, utf8.ValidString(msg))
	}

	wrapped := fmt.Errorf("commit message generation blocked: %s: %w", msg, provider.ErrDestinationDenied)
	if !errors.Is(wrapped, provider.ErrDestinationDenied) {
		t.Fatal("sentinel must survive composition")
	}
}

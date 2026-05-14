package server

import (
	"context"
	"fmt"
	"net/http"
)

// Server wraps an HTTP mux with port configuration and lifecycle methods.
type Server struct {
	port    int
	mux     *http.ServeMux
	httpSrv *http.Server
}

// NewServer creates a new Server bound to the given port with an initialized mux.
func NewServer(port int) *Server {
	mux := http.NewServeMux()
	return &Server{
		port: port,
		mux:  mux,
		httpSrv: &http.Server{
			Addr:    fmt.Sprintf(":%d", port),
			Handler: mux,
		},
	}
}

// Start begins listening for HTTP connections and blocks until the context is cancelled.
func (s *Server) Start(ctx context.Context) error {
	go func() {
		<-ctx.Done()
		_ = s.httpSrv.Shutdown(context.Background())
	}()
	return s.httpSrv.ListenAndServe()
}

// RegisterRoute wires a handler to a specific HTTP method and URL path pattern.
func (s *Server) RegisterRoute(method, path string, handler http.HandlerFunc) {
	s.mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		handler(w, r)
	})
}

// healthCheck responds with 200 OK and a JSON body to confirm the server is alive.
func healthCheck(w http.ResponseWriter, r *http.Request) {
	_ = r
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"ok":true}`))
}

package api

import (
	"github.com/pulsejet/memories/go-vod/config"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestExpectedMemoriesVersionHealthGuard(t *testing.T) {
	for _, tc := range []struct {
		version string
		status  int
	}{{"10.2.0", 200}, {"10.3.0", 500}} {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"version":"` + tc.version + `"}`))
		}))
		c := config.Defaults("0.6.3")
		c.TempDir = t.TempDir()
		c.NextcloudURL = upstream.URL
		c.ExpectedAppVersion = "10.2.0"
		server := NewServer(c)
		response := httptest.NewRecorder()
		server.handleHealth(response, httptest.NewRequest("GET", "/health", nil))
		require.Equal(t, tc.status, response.Code)
		upstream.Close()
	}
}

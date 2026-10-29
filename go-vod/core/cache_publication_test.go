package core

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCachePublicationNeverExposesPartialJSON(t *testing.T) {
	dir := t.TempDir()
	keys := make([]float64, 5000)
	for i := range keys {
		keys[i] = float64(i) / 3
	}
	require.NoError(t, StoreCachedKeyframes(dir, 7, "same-etag", keys))
	path := KeyframeCachePath(dir, 7)
	done := make(chan struct{})
	failures := make(chan error, 1)
	var readers sync.WaitGroup
	for range 4 {
		readers.Add(1)
		go func() {
			defer readers.Done()
			for {
				select {
				case <-done:
					return
				default:
				}
				data, err := os.ReadFile(path)
				if err != nil || !json.Valid(data) {
					select {
					case failures <- fmt.Errorf("partial cache read: %v (%d bytes)", err, len(data)):
					default:
					}
					return
				}
			}
		}()
	}
	for range 100 {
		if err := StoreCachedKeyframes(dir, 7, "same-etag", keys); err != nil {
			close(done)
			readers.Wait()
			t.Fatal(err)
		}
	}
	close(done)
	readers.Wait()
	select {
	case err := <-failures:
		t.Fatal(err)
	default:
	}
}

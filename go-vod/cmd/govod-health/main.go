package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

func main() {
	client := &http.Client{Timeout: 4 * time.Second}
	res, err := client.Get("http://127.0.0.1:47788/health")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer res.Body.Close()
	var health struct {
		Status  string `json:"status"`
		Version string `json:"version"`
	}
	if err := json.NewDecoder(res.Body).Decode(&health); err != nil ||
		res.StatusCode != http.StatusOK || health.Status != "healthy" || health.Version != "0.7.0" {
		fmt.Fprintf(os.Stderr, "go-vod health: HTTP %d status=%s version=%s error=%v\n", res.StatusCode, health.Status, health.Version, err)
		os.Exit(1)
	}
	fmt.Println("go-vod 0.7.0 healthy; Nextcloud reachable")
}

package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/pulsejet/memories/go-vod/api"
	"github.com/pulsejet/memories/go-vod/config"
)

const VERSION = "0.6.3"

func main() {
	c := config.Defaults(VERSION)

	for _, arg := range os.Args[1:] {
		switch arg {
		case "-healthcheck":
			client := http.Client{Timeout: 3 * time.Second}
			res, err := client.Get("http://127.0.0.1:47788/health")
			if err != nil {
				os.Exit(1)
			}
			body, readErr := io.ReadAll(io.LimitReader(res.Body, 65536))
			res.Body.Close()
			if readErr != nil {
				os.Exit(1)
			}
			if res.StatusCode != http.StatusOK {
				fmt.Fprintln(os.Stderr, string(body))
				os.Exit(1)
			}
			return
		case "-version-monitor":
			c.VersionMonitor = true
		case "-version":
			fmt.Print("go-vod " + VERSION)
			return
		default:
			if err := c.LoadFile(arg); err != nil {
				log.Fatal("Error loading config: ", err)
			}
		}
	}

	if err := c.AutoDetect(); err != nil {
		log.Fatal("Error detecting environment: ", err)
	}

	if err := c.Validate(); err != nil {
		log.Fatal("Invalid config: ", err)
	}

	code := api.NewServer(c).Start()

	log.Println("Exiting go-vod with status code", code)
	os.Exit(code)
}

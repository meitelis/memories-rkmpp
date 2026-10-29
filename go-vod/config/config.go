// Package config loads and validates go-vod configuration.
// Loading and validation return errors instead of exiting the process.
package config

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"github.com/go-playground/validator/v10"
)

type Config struct {
	Bind string `json:"bind" validate:"required"`

	FFmpeg    string `json:"ffmpeg" validate:"required"`
	FFprobe   string `json:"ffprobe" validate:"required"`
	TempDir   string `json:"tempdir" validate:"required"`
	CacheDir_ string `json:"cacheDir"`

	ExpectedAppVersion string `json:"expectedMemoriesVersion"`
	NextcloudURL       string `json:"nextcloudUrl" validate:"required,http_url"`

	LookBehind      int `json:"lookBehind" validate:"gte=0"`
	GoalBufferMin   int `json:"goalBufferMin" validate:"gte=0"`
	GoalBufferMax   int `json:"goalBufferMax" validate:"gtefield=GoalBufferMin"`
	StreamIdleTime  int `json:"streamIdleTime" validate:"gte=0"`
	ManagerIdleTime int `json:"managerIdleTime" validate:"gte=0"`

	Version          string `json:"-"`
	VersionMonitor   bool   `json:"-"`
	RKMPP            bool   `json:"-"`
	RKMPPOpenCL      bool   `json:"rkmppOpenCL"`
	RKMPPOutputCodec string `json:"rkmppOutputCodec" validate:"omitempty,oneof=h264 hevc"`
}

func Defaults(version string) *Config {
	c := &Config{
		Version:          version,
		Bind:             ":47788",
		LookBehind:       3,
		GoalBufferMin:    1,
		GoalBufferMax:    4,
		StreamIdleTime:   60,
		ManagerIdleTime:  60,
		RKMPP:            os.Getenv("MEMORIES_RKMPP") == "1",
		RKMPPOpenCL:      true,
		RKMPPOutputCodec: "hevc",
	}
	if c.RKMPP {
		c.GoalBufferMax = 2
		c.StreamIdleTime = 15
	}
	return c
}

func (c *Config) LoadFile(path string) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("open config %s: %w", path, err)
	}
	if err := json.Unmarshal(content, c); err != nil {
		return fmt.Errorf("parse config %s: %w", path, err)
	}
	return nil
}

var validate = validator.New()

func (c *Config) Validate() error {
	return validate.Struct(c)
}

func (c *Config) CacheDir() string {
	if v, ok := os.LookupEnv("CACHE_DIR"); ok && v != "" {
		return v
	}
	return c.CacheDir_
}

func (c *Config) FileURL(fileid int64) string {
	return strings.TrimSuffix(c.NextcloudURL, "/") +
		"/index.php/apps/memories/api/stream/" + strconv.FormatInt(fileid, 10)
}

func (c *Config) LiveURL(fileid int64, liveid string) string {
	return strings.TrimSuffix(c.NextcloudURL, "/") +
		"/index.php/apps/memories/api/video/livephoto/" + strconv.FormatInt(fileid, 10) +
		"?liveid=" + url.QueryEscape(liveid)
}

func (c *Config) DescribeURL() string {
	return strings.TrimSuffix(c.NextcloudURL, "/") +
		"/index.php/apps/memories/api/describe"
}

func (c *Config) AutoDetect() error {
	if value := os.Getenv("MEMORIES_RKMPP_OPENCL"); value != "" {
		enabled, err := strconv.ParseBool(value)
		if err != nil {
			return fmt.Errorf("invalid MEMORIES_RKMPP_OPENCL: %w", err)
		}
		c.RKMPPOpenCL = enabled
	}
	if v := os.Getenv("MEMORIES_RKMPP_CODEC"); v != "" {
		c.RKMPPOutputCodec = v
	}
	if v := os.Getenv("MEMORIES_EXPECTED_APP_VERSION"); v != "" {
		c.ExpectedAppVersion = v
	}
	if c.FFmpeg == "" {
		ffmpeg, err := exec.LookPath("ffmpeg")
		if err != nil {
			return fmt.Errorf("find ffmpeg: %w", err)
		}
		c.FFmpeg = ffmpeg
	}
	if c.FFprobe == "" {
		ffprobe, err := exec.LookPath("ffprobe")
		if err != nil {
			return fmt.Errorf("find ffprobe: %w", err)
		}
		c.FFprobe = ffprobe
	}
	if c.TempDir == "" {
		c.TempDir = os.TempDir() + "/go-vod"
	}
	if v, ok := os.LookupEnv("NEXTCLOUD_HOST"); ok && v != "" {
		c.NextcloudURL = v
	}
	return nil
}

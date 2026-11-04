package main

import (
	"strings"
	"testing"
)

func TestFinalPlaylist(t *testing.T) {
	final := "#EXTM3U\n#EXT-X-MAP:URI=\"test-init.mp4\"\n#EXTINF:3,\ntest-000000.m4s\n#EXT-X-ENDLIST\n"
	got, err := finalPlaylist([]byte("#EXTM3U\npartial\n" + final))
	if err != nil || string(got) != final || strings.Count(string(got), "#EXTM3U") != 1 {
		t.Fatalf("incorrect final playlist: %q, %v", got, err)
	}
	for _, incomplete := range []string{"", "#EXTM3U\npartial\n", "#EXT-X-ENDLIST\n"} {
		if _, err := finalPlaylist([]byte(incomplete)); err == nil {
			t.Fatalf("accepted incomplete playlist %q", incomplete)
		}
	}
}

func TestTargetDimensions(t *testing.T) {
	for _, tc := range []struct{ w, h, wantW, wantH int }{
		{3840, 2160, 1280, 720},
		{2160, 3840, 720, 1280},
		{1280, 720, 1280, 720},
		{1000, 1920, 666, 1280},
		{641, 359, 640, 358},
		{1, 1, 0, 0},
	} {
		w, h := targetDimensions(tc.w, tc.h)
		if w != tc.wantW || h != tc.wantH {
			t.Errorf("%dx%d -> %dx%d; want %dx%d", tc.w, tc.h, w, h, tc.wantW, tc.wantH)
		}
	}
}

func TestHasFlagValue(t *testing.T) {
	args := []string{"-codec", "h264_rkmpp", "-c:v", "hevc_rkmpp"}
	if !hasFlagValue(args, "-c:v", "hevc_rkmpp") || hasFlagValue(args, "-c:v", "h264_rkmpp") {
		t.Fatal("did not compare exact command argument pairs")
	}
}

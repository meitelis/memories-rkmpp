package main

import "testing"

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

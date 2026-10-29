# Verification: Memories 10.2.0 / go-vod 0.6.3

The matching container is deployed in the existing Portainer stack. Memories' own compatibility check accepts 0.6.3. The running service is healthy, with zero restarts and no OOM event at verification.

- Go race tests and go vet passed.
- All 63 library videos passed 180 individually decoded startup, cold-middle, and cold-end segments.
- Quality changes 1080p → 1440p → 720p → 1080p passed individual decoding and boundary timing checks.
- A 25-second pause followed by a cold encoder restart resumed in 1.859 seconds.
- Long-camera-video and other library previews, and progressive playback, passed.
- Six additional segments decoded successfully through the deployed container.
- Source file sizes and modification times stayed unchanged. Nextcloud's external photo mount remains read-only.
- Kernel samples recorded MPP decoder/encoder and RGA activity. See verification/summary.json for measured peaks.

The final image is 109171649 bytes, ID sha256:728e836fef050168c26463876d1b1b6e6bf5ec8b35f4e1913d4e9c206d844523. It needs only its cache volume; photo/data mounts were removed from the transcoder. The previous image and stack definition were retained.

## Timing checks and limits

A short final fragment legitimately contains one video frame and no audio samples. The validator was corrected to decode streams with actual packets. An audio-padding experiment was rejected because it changed cold-seek timestamps; the deployed build preserves source timing.

Joining independent HLS transport-stream files as one raw stream gave misleading continuity-counter and AAC-delay errors. Each fragment is decoded independently, and boundary timestamps are checked separately. Measured switch differences were within ±22 ms for video and −59/+24 ms for audio. These server checks do not prove every browser/network will switch without buffering.

Browser playback verification: User confirms the videos checked played smoothly without pausing. Server logs verified hardware output through the final segment. This is user-reported playback verification; automated browser observation was blocked after user input..

The latest user playback produced 1080p and 1440p output through the final segment, with no transcoder errors or recent Memories warnings. Nginx recorded 85 successful video requests and 3 client-closed requests in the inspected interval; client cancellations can occur during quality changes. The container remained healthy with zero restarts and no OOM event.

The new health check detects an unexpected Memories app version. It cannot prevent a manual app update. Future upgrades need a tested app/backend pair and the supplied preflight check.

This is an experimental community project, not an official Memories release.

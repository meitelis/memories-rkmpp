# Memories 11.0.2 player integration

The upstream v11 player is `PsVideo.ts`: native HTML video, Safari native HLS,
and hls.js elsewhere. `PsVideoQuality.ts` owns the quality selection. The old
10.2 Vidstack helper cannot be reused. No production player files are changed
by this hardware audit.

## Server contract covered by the isolated tests

- `/ping` and `X-Go-Vod-Version` use **0.7.0**.
- `/vod` retains the v11 JSON request, profile names, init segments, query
  tokens and service-token file callbacks. The API hardware test serves actual
  video/normalized-audio seek segments through this interface.
- A reported HEVC-capable client can receive a Main-profile `hvc1` ladder;
  missing capability reports select AVC. Safari uses native HLS, so the master
  playlist must remain valid without hls.js-specific recovery.
- Normalized audio is one `EXT-X-MEDIA` group. Every encoded quality links to
  that group, allowing the audio timeline to continue while video levels change.
  Copyable AAC-LC currently stays muxed and is copied from the source.
- The upstream initial-load HLS/direct failover remains intact. The port does
  not implement seamless mid-playback source replacement.

## Remaining implementation and staging work

Keep the upstream player initially. Avoid DOM injections and player rewrites
until the stock v11 path has been measured with the validated backend.

1. Build a separate v11 staging service using the tested runtime, 0.7.0 binary
   and device permissions. Test the real PHP `/bridge` and callbacks before
   changing the configured production go-vod address.
2. Verify the emitted HEVC/AVC codec declarations against browser capability
   probes and real bitstreams. Test Safari/iOS, Chromium, Firefox and Android.
   The current RKMPP master hides direct-copy HLS and uses the encoded ladder;
   restoring upstream HEVC/AV1/VP9 direct HLS needs codec, HDR, audio and
   keyframe-grid eligibility decisions rather than simply adding a variant.
3. Measure startup time, first-frame time, cold seeks and buffer stalls. Then
   tune the existing hls.js ABR policy with those measurements. Decoder speed
   and network throughput are different sources of segment latency.
4. Perform 100+ automatic/manual quality switches with AAC-LC, normalized
   multichannel audio, 44.1/48 kHz sources and shorter audio tracks. Record
   stalls, audio gaps, A/V drift and `bufferAppendingError`. The server tests
   verify stream lifetime and seek timestamps, not what a listener hears.
5. Verify authenticated sessions, public shares, bridge reconnects, cancelled
   requests, simultaneous viewers and network loss. Then create a versioned
   v11 production Compose/release with an explicit rollback.

The 4 November inspection found Memories **11.0.2** installed on the board but
the running transcoder reporting **0.6.3** and an unhealthy container status.
That mismatch needs a coordinated staging-to-production upgrade; changing the
version string of the old engine is not a compatibility fix. The audit left
the running services and their configuration untouched.
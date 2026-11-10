# Auto startup and Original playback

Helper 1.1.27 removes a redundant lowest-rendition bandwidth test after the
same-origin connection probe has already measured capacity. With hls.js 1.7.4,
that test starts a cold 480p encoder and can put its next fragment into an
otherwise 4K timeline. Auto remains native hls.js ABR, including its slow-link
and buffer-starvation handling.

Original is labelled in the native quality menu. Auto considers it after its
copy-grid playlist is ready. The helper changes the label inside this video's
controls and leaves the existing radio actions, keyboard behavior and selection
handlers intact; it does not replace signed Memories assets.

SDR Main10 HEVC is eligible only after the browser explicitly reports Main10
MediaSource support. The existing authenticated master URL then carries the
`hevc10` capability. Legacy clients still use the previous eligibility rules.
Copied Main10 and encoded Main renditions advertise their respective profiles.
Unsupported bit depths, HDR mapping and rotation restrictions remain unchanged.
If a copy timeline cannot be established, the Original playlist is unavailable
rather than silently re-encoding under an Original label. Auto can use encoded
renditions while Original is pending or unavailable.

The deployed 3.5x catch-up pacing is retained in the source and its regression.

## Checks

`npm ci --ignore-scripts && npm test` runs the unit suite and pinned hls.js 1.7.4
controllers with an in-memory master-playlist loader. It covers the previous
lowest-rendition startup, fast and slow connection measurements, failed probes,
ready/pending Original, Main10 negotiation, and subsequent native downshifts.
Debug fragment traces are opt-in, bounded, and omit URLs and authentication data.

ARM64 Go source tests, race tests, vet and builds passed on the target board.
The Main10 tests cover capability gating, HDR/unsupported-depth exclusion,
stream-copy selection and correct Main/Main10 HLS codec declarations.

Live browser checks on the target installation established that the affected
4K SDR Main10 clip completes in Auto/Original with no buffering events or
dropped frames. Before enabling Original, two runs with the startup correction
also remained at encoded 4K, including an immediate start after reload. Server
logs distinguish `-c:v copy` from hardware video encoding. These checks establish
the observed browser/device behavior, not universal playback guarantees.

## Existing Portainer installations

Keep the service in its existing Portainer stack. Build the candidate from the
reviewed source and update that service's image in the saved stack definition,
preserving its mounts, devices, network, environment and cache. Install the
matching `memories_rkmpp_v11` helper in Nextcloud's existing writable app path,
apply its normal app upgrade, and advance the template asset cache. Back up the
stack definition and previous helper, and retain the prior image for rollback.
Do not run a deployment script that would adopt the service into another Compose
project. Test playback after updating both engine and helper.

# Memories on RK3588

Hardware video transcoding and Original playback for **Nextcloud Memories 11.1.4 / go-vod 0.7.3**. The tested host is a ROCK 5B+ on Armbian's 6.1 vendor kernel with Rockchip MPP/RGA and Mali-G610 OpenCL.

- **Original** copies compatible source video instead of re-encoding it. Auto can select it when browser support and bandwidth allow, including explicitly supported SDR Main10 HEVC.
- **Auto** uses native hls.js adaptation. Manual resolution choices keep the existing playback buffer and shared audio track.
- Encoded video uses MPP decoding/encoding, RGA transforms and Mali HDR-to-SDR mapping. Strict mode rejects unsupported hardware video. Audio follows its separate compatibility and padding policy.

The current 11.1.4 release includes [PR #29's serialized HLS restart fix](https://github.com/meitelis/memories-rkmpp/pull/29), accepted on **15 November 2026** after GitHub ARM64 CI, the complete isolated ROCK 5B+ hardware matrix and successful live playback. Earlier [11.1.2 compatibility notes](docs/verification/memories-11.1.2.md) remain historical evidence, not current deployment instructions.

## Start here

| Task | Guide |
| --- | --- |
| Update an existing Portainer stack or install standalone | [Deployment](docs/deployment.md) |
| Understand Original, Auto, codecs and buffering | [Playback](docs/playback.md) |
| Run source checks and board/browser validation | [Testing](docs/testing/README.md) |
| Review the latest on-board release and acceptance | [15 November PR #29 verification](docs/verification/memories-11.1.4-pr29.md) |
| Find older experiments and measurements | [Historical records](docs/history/README.md) |

**Existing Portainer installations:** build the image, update the service in its current stack, then install the matching browser helper. Follow the deployment guide; the standalone deploy script refuses to take over another Compose project.

## Repository layout

| Path | Purpose |
| --- | --- |
| [go-vod/](go-vod/) | Go engine, protocol, media pipeline and Go tests |
| [memories_rkmpp_v11/](memories_rkmpp_v11/) | Nextcloud browser helper |
| [scripts/](scripts/) | Build, install, deployment and board/network checks |
| [tests/](tests/) | Integration tests against pinned hls.js |
| [docs/](docs/) | Current guides, verification and historical records |
| [compose.yml](compose.yml) | Standalone service definition |

## Development

~~~sh
npm ci --ignore-scripts
npm test
cd go-vod
go test -race ./...
go vet ./...
go build ./...
~~~

Use a Linux environment for the Go integration tests. See the testing guide for hardware and PHP checks. Native Android development is separate from this server/browser tree; its unmerged work is retained on its existing branches.

Validation includes ARM64 Go, browser and helper checks; the 15 November 2026 RK3588 FFmpeg/core/API hardware matrix; and the owner's successful real playback of PR #29. Earlier 11.1.1/11.1.2 tests remain archived. This does not establish native Android, Safari, public-share, all network conditions or perceptual HDR/audio acceptance.

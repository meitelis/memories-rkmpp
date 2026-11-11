# Memories on RK3588

Hardware video transcoding and Original playback for **Nextcloud Memories 11.1.2 / go-vod 0.7.1**. The tested host is a ROCK 5B+ on Armbian's 6.1 vendor kernel with Rockchip MPP/RGA and Mali-G610 OpenCL.

- **Original** copies compatible source video instead of re-encoding it. Auto can select it when browser support and bandwidth allow, including explicitly supported SDR Main10 HEVC.
- **Auto** uses native hls.js adaptation. Manual resolution choices keep the existing playback buffer and shared audio track.
- Encoded video uses MPP decoding/encoding, RGA transforms and Mali HDR-to-SDR mapping. Strict mode rejects unsupported hardware video. Audio follows its separate compatibility and padding policy.

Memories 11.1.2 compatibility and the upstream go-vod 0.7.1 HTTP-option hotfix are documented in [the compatibility notes](docs/verification/memories-11.1.2.md). The detailed playback measurements below remain from 11.1.1; the owner also reports that the 11.1.2 update works on the ROCK 5B+.

## Start here

| Task | Guide |
| --- | --- |
| Update an existing Portainer stack or install standalone | [Deployment](docs/deployment.md) |
| Understand Original, Auto, codecs and buffering | [Playback](docs/playback.md) |
| Run source checks and board/browser validation | [Testing](docs/testing/README.md) |
| Review the latest deployed playback fix and its evidence | [10 November verification](docs/verification/auto-original-2026-11-10.md) |
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

Validation includes detailed live Memories 11.1.1 Original/Auto checks, an ARM64 build, and an owner-reported successful 11.1.2 deployment. The larger synthetic hardware matrix has its own dated evidence; browser results do not establish native Android, Safari, public-share or perceptual HDR/audio acceptance.

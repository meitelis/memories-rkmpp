# Deployment

This source targets **Memories 11.1.1 / go-vod 0.7.0**. Upgrade the official Memories app through Nextcloud's normal update process before installing this integration. The helper installer checks the Memories version; it does not upgrade the official app.

The defaults use LinuxServer Nextcloud, container `nextcloud`, document root `/app/www/public`, and web-server user `abc`. The engine requires the device nodes and Docker configuration in [compose.yml](../compose.yml). Check the network and numeric device groups against [.env.example](../.env.example).

## Existing Portainer stack

Keep the service in its existing stack so its mounts, devices, network, environment and cache are retained.

1. Save the current stack definition, retain its current image, and back up the installed `memories_rkmpp_v11` helper before updating it.
2. From a reviewed checkout on the ARM64 Docker host, build a distinct image:

   ```sh
   export MEMORIES_RKMPP_IMAGE=local/memories-rkmpp:my-tested-build
   sh scripts/build-v11.sh
   ```

   This builds and tests the engine and packages its existing pinned multimedia runtime. It does not create volumes, install the helper, or start/replace services. The shell script reads exported variables; it does not load `.env` automatically.

3. In the existing Portainer stack editor, change only this service's image to the built tag and update the stack. A local-only image should use the existing `pull_policy: never`; leave image re-pull disabled. Keep the existing cache mount and all device/network settings.
4. Install the helper from that same checkout:

   ```sh
   NEXTCLOUD_CONTAINER=nextcloud sh scripts/install-player-v11.sh
   ```

   This preserves the engine's Compose project. It installs the helper, applies its Nextcloud app upgrade, refreshes the static-asset cache and checks the go-vod handshake. It also applies the integration's existing Memories external-transcoder settings.

5. Check that the service is healthy, reload Memories, and verify Auto, Original, manual selection, seeking and playback to the end. Use [the browser checklist](testing/README.md#live-browser-checks).

The bundled `compose.yml` is a standalone example, not a replacement for an existing multi-service Portainer stack. `deploy-v11.sh` stops before builds or mutations if `memories-rkmpp` belongs to another project, including a Portainer-managed project.

## New standalone Compose installation

Use this path only when Portainer does not already manage the service. Copy `.env.example` to `.env` and set the network/device groups for the host.

```sh
sh scripts/deploy-v11.sh
```

The script verifies Memories 11.1.1, builds the engine, creates the standalone cache volume if needed, starts the service under project `memories_v11`, and installs the helper. Existing containers outside that project are left in place and cause an early exit. To override the image, export `MEMORIES_RKMPP_IMAGE` before invoking the script; it passes the same tag to the build and Compose.

## Updating only the helper

If the engine already matches the helper's protocol/source requirements:

```sh
NEXTCLOUD_CONTAINER=nextcloud sh scripts/install-player-v11.sh
```

Retain the previous helper first. This command changes Nextcloud app/configuration state but does not deploy a container. No server action is needed for documentation-only repository updates.

## Rollback

Restore the old image through the same stack/project. Restore the backed-up helper to its original app path and web-server ownership, restore its saved `installed_version` if the app version advanced, and refresh Nextcloud's template asset cache. Retain the existing cache volume and original media. Verify the service health, protocol handshake and browser playback after rollback.

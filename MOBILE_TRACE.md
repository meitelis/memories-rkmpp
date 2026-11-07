# Mobile-browser playback diagnostics

This branch records a bounded in-memory HLS event ring on the device doing playback. A **logged-in mobile browser** automatically uploads the last 60 sanitized events to the **same Nextcloud server** after an actual playback stall or fatal HLS error. There is no third-party telemetry service.

- The receiver is `POST /index.php/apps/memories_rkmpp_v11/trace`; it enforces Nextcloud authentication and normal CSRF protection. It accepts only enumerated events and numeric measurements, never a media URL or video filename.
- Client reports are throttled to at most one per 30 seconds per playback session. It sends after resuming from a stall (or after eight seconds of uninterrupted waiting), not on each HLS segment.
- Server logs are prefixed `RKMMPP_MOBILE_TRACE` in the normal Nextcloud log, at WARNING severity, so the usual deployment log level will include them. The Nextcloud administrator controls log retention. Normal Nextcloud request metadata may still be present in the enclosing log record.
- It applies to **mobile browser playback** using the JavaScript helper. It does not instrument the official Nextcloud/Memories native Android application's separate ExoPlayer path.

## Retrieve logs from your laptop over SSH to the ROCK 5B+

After reproducing a stall on the phone, run on the ROCK:

```sh
docker exec nextcloud sh -c 'grep -h "RKMMPP_MOBILE_TRACE" /data/nextcloud.log /config/log/nextcloud.log 2>/dev/null | tail -n 3'
```

If these files are empty or not present, inspect the configured Nextcloud logfile:

```sh
docker exec -u abc nextcloud php /app/www/public/occ config:system:get logfile
```

The browser badge includes `data-trace-send="saved"` once Nextcloud acknowledges the report. Other values (e.g. `missing-csrf`, `http-403`) mean the event did **not** reach the server.

For urgent rollback or while running PR #12, the previous client-only `video._rkmppTrace` is not sufficient to transfer diagnostics between a phone and laptop. Only this branch's server upload closes that gap.

Do not install this test branch until its source/ARM64 checks pass and its Nextcloud route has been installed alongside the JS. A JS-only copy cannot install a new PHP route.

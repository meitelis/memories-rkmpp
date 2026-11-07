package gallery.memories.ui.video

import androidx.media3.common.C
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsManifest
import androidx.media3.exoplayer.trackselection.AdaptiveTrackSelection
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.upstream.DefaultBandwidthMeter
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import gallery.memories.MainActivity
import org.json.JSONArray
import org.json.JSONObject

/**
 * Native adaptive track selection, analogous to hls.js Auto:
 * throughput, buffered duration, headroom and responsive downshifts.
 * No second controller that periodically pins video resolutions.
 * No initial remote speed probe: retain the upstream playback lifecycle.
 * Audio remains independent and is never modified by quality switching.
 */
@UnstableApi
class NativeVideoPlayback(private val activity: MainActivity) {
    private var bandwidthMeter: DefaultBandwidthMeter? = null
    private var selected = "auto"

    fun reset() { selected = "auto" }

    fun createPlayer(): ExoPlayer {
        selected = "auto"
        val meter = DefaultBandwidthMeter.Builder(activity)
            .setResetOnNetworkTypeChange(true).build()
        bandwidthMeter = meter
        val selector = DefaultTrackSelector(
            activity,
            AdaptiveTrackSelection.Factory(
                5000,  // buffer threshold before higher quality is considered
                15000, // downshift as buffer becomes endangered
                5000,  // retention when higher quality replaces future buffer
                0.75f, // leave transfer headroom
            ),
        )
        selector.parameters = selector.buildUponParameters()
            .clearViewportSizeConstraints().build()
        val load = DefaultLoadControl.Builder()
            .setBufferDurationsMs(6000, 18000, 1000, 2000)
            .setTargetBufferBytes(48 * 1024 * 1024)
            .setPrioritizeTimeOverSizeThresholds(false)
            .setBackBuffer(3000, false).build()
        return ExoPlayer.Builder(activity)
            .setTrackSelector(selector)
            .setBandwidthMeter(meter)
            .setLoadControl(load)
            .build()
    }

    /** go-vod may return 409 while Original's copy grid is prepared. */
    val loadErrors = object : DefaultLoadErrorHandlingPolicy() {
        override fun getFallbackSelectionFor(
            options: LoadErrorHandlingPolicy.FallbackOptions,
            info: LoadErrorHandlingPolicy.LoadErrorInfo,
        ): LoadErrorHandlingPolicy.FallbackSelection? {
            if ((info.exception as? InvalidResponseCodeException)?.responseCode == 409 &&
                info.loadEventInfo.dataSpec.uri.path?.endsWith("/direct.m3u8") == true &&
                options.isFallbackAvailable(LoadErrorHandlingPolicy.FALLBACK_TYPE_TRACK)
            ) {
                return LoadErrorHandlingPolicy.FallbackSelection(
                    LoadErrorHandlingPolicy.FALLBACK_TYPE_TRACK, 5000,
                )
            }
            return super.getFallbackSelectionFor(options, info)
        }
    }

    /** Manual pins one supported video track; Auto removes ONLY video overrides. */
    fun select(player: ExoPlayer, id: String): Boolean {
        val parameters = player.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
        if (id != "auto") {
            val videoGroup = player.currentTracks.groups.find { group ->
                group.type == C.TRACK_TYPE_VIDEO &&
                    (0 until group.length).any { index ->
                        id == group.mediaTrackGroup.id + ":" + index &&
                            group.isTrackSupported(index)
                    }
            } ?: return false
            val index = (0 until videoGroup.length).first { i ->
                id == videoGroup.mediaTrackGroup.id + ":" + i
            }
            parameters.setOverrideForType(
                TrackSelectionOverride(videoGroup.mediaTrackGroup, index),
            )
        }
        player.trackSelectionParameters = parameters.build()
        selected = id
        return true
    }

    /** Immutable JSON snapshot: safely read from WebView's JS bridge thread. */
    fun snapshot(player: ExoPlayer?, url: String?): String {
        val qualities = JSONArray().put(JSONObject()
            .put("id", "auto").put("size", -1))
        player?.currentTracks?.groups
            ?.filter { it.type == C.TRACK_TYPE_VIDEO }
            ?.forEach { group ->
                for (index in 0 until group.length) {
                    val fmt = group.getTrackFormat(index)
                    if (!group.isTrackSupported(index) || fmt.width <= 0 || fmt.height <= 0) continue
                    qualities.put(JSONObject()
                        .put("id", group.mediaTrackGroup.id + ":" + index)
                        .put("size", minOf(fmt.width, fmt.height))
                        .put("bitrate", maxOf(0, fmt.bitrate)))
                }
            }
        val fmt = player?.videoFormat
        val playlist = player?.currentManifest as? HlsManifest
        val direct = fmt?.id?.takeIf { it.isNotEmpty() }?.let { id ->
            playlist?.multivariantPlaylist?.variants?.any { variant ->
                variant.format.id == id &&
                    variant.url.path?.endsWith("/direct.m3u8") == true
            }
        } ?: false

        return JSONObject()
            .put("url", url)
            .put("selected", selected)
            .put("qualities", qualities)
            .put("width", player?.videoSize?.width ?: 0)
            .put("height", player?.videoSize?.height ?: 0)
            .put("codec", fmt?.sampleMimeType ?: "")
            .put("original", direct)
            .put("bandwidth", bandwidthMeter?.bitrateEstimate ?: 0)
            .toString()
    }
}

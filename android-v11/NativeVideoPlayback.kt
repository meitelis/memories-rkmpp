package gallery.memories.ui.video

import android.os.SystemClock
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
import gallery.memories.data.remote.http.AuthState
import gallery.memories.data.remote.http.HttpClients
import okhttp3.Call
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Media3 owns buffering and adaptation; this supplies startup and UI policy. */
@UnstableApi
class NativeVideoPlayback(
    private val activity: MainActivity,
    private val clients: HttpClients,
    private val auth: AuthState,
) {
    @Volatile private var generation = 0
    @Volatile private var probe: Call? = null
    private var meter: DefaultBandwidthMeter? = null
    private var audio = AudioBudget(750000)
    private var selected = "auto"

    fun cancel() {
        generation++
        probe?.cancel()
        probe = null
        selected = "auto"
    }

    /** Bound traffic to 2 MiB and startup to 2.2 seconds, including failures. */
    fun start(remoteHls: Boolean, ready: (Long) -> Unit) {
        cancel()
        val ticket = generation
        val base = auth.baseUrl()?.trimEnd('/')
        val authorization = auth.authHeader()
        if (!remoteHls || base == null || authorization == null) {
            ready(750000)
            return
        }
        activity.threadPool.execute {
            val deadline = SystemClock.elapsedRealtime() + 2200
            var estimate = 750000L
            try {
                for (size in listOf(65536, 393216, 1572864)) {
                    val remaining = deadline - SystemClock.elapsedRealtime()
                    if (remaining <= 0 || ticket != generation) break
                    val client = clients.client().newBuilder()
                        .followRedirects(false).followSslRedirects(false)
                        .callTimeout(remaining, TimeUnit.MILLISECONDS).build()
                    val request = Request.Builder()
                        .url("$base/index.php/apps/memories_rkmpp_v11/probe?bytes=$size&t=${System.nanoTime()}")
                        .header("Authorization", authorization)
                        .header("Cache-Control", "no-cache")
                        .header("Accept-Encoding", "identity").build()
                    val call = client.newCall(request)
                    probe = call
                    if (ticket != generation) { call.cancel(); break }
                    call.execute().use { response ->
                        if (!response.isSuccessful || !response.header("Content-Type", "")!!.startsWith("application/octet-stream")) return@use
                        val body = response.body ?: return@use
                        val start = SystemClock.elapsedRealtime()
                        var count = 0L
                        try {
                            val buffer = ByteArray(16384)
                            val input = body.byteStream()
                            while (true) {
                                val n = input.read(buffer)
                                if (n < 0) break
                                count += n
                            }
                        } finally {
                            if (count > 0) estimate = count * 8000 / maxOf(25, SystemClock.elapsedRealtime() - start)
                        }
                    }
                }
            } catch (_: Exception) {
                // Partial measurements survive the deadline; missing helper/auth starts low.
            }
            activity.runOnUiThread {
                if (ticket == generation && !activity.isDestroyed) ready(estimate)
            }
        }
    }

    fun createPlayer(initialBps: Long): ExoPlayer {
        audio = AudioBudget(initialBps)
        val bandwidth = DefaultBandwidthMeter.Builder(activity)
            .setInitialBitrateEstimate(initialBps).build()
        meter = bandwidth
        val selector = DefaultTrackSelector(activity, AdaptiveTrackSelection.Factory(10000, 10000, 10000, 0.72f))
        selector.parameters = selector.buildUponParameters().clearViewportSizeConstraints().build()
        val load = DefaultLoadControl.Builder()
            .setBufferDurationsMs(6000, 18000, 1000, 2000)
            .setTargetBufferBytes(48 * 1024 * 1024)
            .setPrioritizeTimeOverSizeThresholds(false).setBackBuffer(3000, false).build()
        return ExoPlayer.Builder(activity).setTrackSelector(selector)
            .setBandwidthMeter(bandwidth).setLoadControl(load).build()
    }

    /** The source can report 409 while its Original keyframe index is warming. */
    val loadErrors = object : DefaultLoadErrorHandlingPolicy() {
        override fun getFallbackSelectionFor(options: LoadErrorHandlingPolicy.FallbackOptions, info: LoadErrorHandlingPolicy.LoadErrorInfo): LoadErrorHandlingPolicy.FallbackSelection? {
            if ((info.exception as? InvalidResponseCodeException)?.responseCode == 409 &&
                info.loadEventInfo.dataSpec.uri.path?.endsWith("/direct.m3u8") == true &&
                options.isFallbackAvailable(LoadErrorHandlingPolicy.FALLBACK_TYPE_TRACK)) {
                return LoadErrorHandlingPolicy.FallbackSelection(LoadErrorHandlingPolicy.FALLBACK_TYPE_TRACK, 5000)
            }
            return super.getFallbackSelectionFor(options, info)
        }
    }

    fun select(player: ExoPlayer, id: String): Boolean {
        val parameters = player.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_VIDEO)
        if (id != "auto") {
            val group = player.currentTracks.groups.find { g ->
                g.type == C.TRACK_TYPE_VIDEO && (0 until g.length).any { id == "${g.mediaTrackGroup.id}:$it" && g.isTrackSupported(it) }
            } ?: return false
            val track = (0 until group.length).first { id == "${group.mediaTrackGroup.id}:$it" }
            parameters.setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, track))
        }
        selected = id
        player.trackSelectionParameters = parameters.build()
        return true
    }

    fun updateAudio(player: ExoPlayer, seeking: Boolean) {
        if (seeking) return
        val rate = audio.update(meter?.bitrateEstimate ?: 750000, SystemClock.elapsedRealtime())
        val label = if (rate == 192000) "Original / high" else "${rate / 1000} kbps"
        for (group in player.currentTracks.groups) {
            if (group.type != C.TRACK_TYPE_AUDIO) continue
            for (i in 0 until group.length) {
                if (!group.isTrackSupported(i) || group.getTrackFormat(i).label != label) continue
                val override = player.trackSelectionParameters.overrides[group.mediaTrackGroup]
                if (override?.trackIndices?.contains(i) == true) return
                player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                    .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, i)).build()
                return
            }
        }
    }

    /** Called only on the UI thread; NativeX reads an immutable cached string. */
    fun snapshot(player: ExoPlayer?, url: String?): String {
        val list = JSONArray().put(JSONObject().put("id", "auto").put("size", -1))
        player?.currentTracks?.groups?.filter { it.type == C.TRACK_TYPE_VIDEO }?.forEach { group ->
            for (i in 0 until group.length) {
                val format = group.getTrackFormat(i)
                if (!group.isTrackSupported(i) || format.width <= 0 || format.height <= 0) continue
                list.put(JSONObject().put("id", "${group.mediaTrackGroup.id}:$i")
                    .put("size", minOf(format.width, format.height)).put("bitrate", maxOf(0, format.bitrate)))
            }
        }
        val format = player?.videoFormat
        val manifest = player?.currentManifest as? HlsManifest
        val original = if (manifest == null) player?.currentMediaItem != null else manifest.multivariantPlaylist.variants.any {
            it.format.id == format?.id && it.url.path?.endsWith("/direct.m3u8") == true
        }
        return JSONObject().put("url", url).put("selected", selected).put("qualities", list)
            .put("width", player?.videoSize?.width ?: 0).put("height", player?.videoSize?.height ?: 0)
            .put("codec", format?.sampleMimeType ?: "").put("original", original)
            .put("bandwidth", meter?.bitrateEstimate ?: 0).put("audioBudget", audio.rate).toString()
    }
}

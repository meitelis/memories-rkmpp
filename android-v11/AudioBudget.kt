package gallery.memories.ui.video

/** Independent AAC budget. A seek or a video-quality choice never changes it. */
class AudioBudget(initialBps: Long) {
    var rate = profile(initialBps)
        private set
    private var candidate = rate
    private var since = 0L

    fun update(bps: Long, now: Long): Int {
        val next = profile(bps)
        if (next != candidate) {
            candidate = next
            since = now
        }
        if (next != rate && now - since >= if (next < rate) 3000 else 10000) rate = next
        return rate
    }

    companion object {
        fun profile(bps: Long): Int = when {
            bps < 450000 -> 32000
            bps < 1000000 -> 64000
            bps < 4000000 -> 96000
            else -> 192000
        }
    }
}

(function (root) {
  'use strict';
  const bitrate = level => level?.bitrate || Number(level?.attrs?.BANDWIDTH) || Infinity;
  const original = level => (Array.isArray(level?.url) ? level.url : [level?.url])
    .some(url => /\/direct\.m3u8(?:\?|$)/.test(url || ''));

  // The one startup connection probe determines the initial rendition.
  function chooseLevel(levels, bps, ready = true, limit = Infinity) {
    let best = 0;
    levels.forEach((level, i) => {
      if (i <= limit && (ready || !original(level)) && bitrate(level) <= bps * 0.8) best = i;
    });
    return best;
  }

  // Buffer fluctuations alone are not congestion evidence: a completed
  // fragment proves whether the chosen rendition is sustainable in real time.
  class PlaybackPolicy {
    constructor(levels, initialBps, ready = false) {
      this.levels = levels;
      this.bps = initialBps;
      this.cap = chooseLevel(levels, initialBps, ready);
      this.phase = 'startup';
      this.warmStartedAt = null;
      this.presentedLevel = -1;
      this.goodFragments = 0;
      this.slowFragments = 0;
      this.lastSampledFragment = null;
      this.trialLevel = -1;
      this.failures = new Map();
      this.lastDownshiftAt = -Infinity;
      this.waiting = false;
    }

    beginSeek() {
      this.phase = 'seeking';
      this.warmStartedAt = null;
      this.presentedLevel = -1;
      this.goodFragments = 0;
      this.slowFragments = 0;
      this.lastSampledFragment = null;
      this.waiting = false;
      this.trialLevel = -1;
    }
    onWaiting() { this.waiting = true; }
    onPlaying() { this.waiting = false; }

    // Measure transport separately from RKMPP production. The hardware input
    // uses -readrate 1: a sustainable encoder often takes ~4s for a 4s segment.
    // HLS loader first/end timestamps isolate HTTP transfer from that pacing.
    onFragment({level, sn, duration, elapsedMs, transferMs, bytes, buffer}) {
      if (level !== this.cap || this.presentedLevel !== this.cap ||
          !(duration > 0 && elapsedMs > 0)) return;
      // hls.js can rebuffer or retry a completed fragment; don't count the
      // same segment twice as independent evidence for a quality upgrade.
      const key = Number.isInteger(sn) ? level + ':' + sn : null;
      if (key && this.lastSampledFragment === key) return;
      if (key) this.lastSampledFragment = key;
      const productionRate = duration * 1000 / elapsedMs;
      const next = this.cap + 1;
      const failure = this.failures.get(next) || 0;
      const nextBitrate = bitrate(this.levels[next]);
      const networkBps = transferMs > 0 && bytes >= 16384
        ? bytes * 8000 / Math.max(20, transferMs) : 0;
      // Without a reliable transfer measurement, we cannot infer that Wi-Fi
      // is faster merely because an on-demand encoder is keeping up.
      const healthy = buffer >= 3 && productionRate >= 0.8 &&
        networkBps >= nextBitrate * (failure ? 1.7 : 1.4);
      this.goodFragments = healthy ? this.goodFragments + 1 : 0;
      this.slowFragments = buffer < 4 && (
        productionRate < 0.85 ||
        (networkBps > 0 && networkBps < bitrate(this.levels[this.cap]) * 0.85)
      ) ? this.slowFragments + 1 : 0;
      // A successful trial needs continued sustainable playback, not a timer.
      if (this.trialLevel === this.cap && this.goodFragments >= 2) {
        this.trialLevel = -1;
      }
    }

    step({now, buffer, playing, seeking, auto, originalReady = false,
          decoderCap = Infinity, requestAge = 0, currentLevel = -1}) {
      const originalIndex = this.levels.findIndex(original);
      const limit = Math.max(0, Math.min(decoderCap, originalReady || originalIndex < 0
        ? this.levels.length - 1 : originalIndex - 1));
      if (this.cap > limit) {
        this.cap = limit;
        this.resetEvidence();
        return this.result(true);
      }
      if (!auto || !playing || seeking) return this.result(false);

      if (this.phase === 'startup' || this.phase === 'seeking') {
        if (this.warmStartedAt === null) this.warmStartedAt = now;
        if (buffer < 2.5 && now - this.warmStartedAt < 6000) return this.result(false);
        this.phase = 'normal';
      }
      if (currentLevel === this.cap && this.presentedLevel !== this.cap) {
        this.presentedLevel = this.cap;
        this.goodFragments = 0;
        this.slowFragments = 0;
      }

      // Only threatened playback or repeated slow fragments justify going
      // lower. A normal HLS buffer sawtooth never triggers a switch.
      const danger = buffer < 0.5 ||
        (buffer < 2.3 && requestAge >= 1400) ||
        (this.waiting && buffer < 1.5) ||
        (this.slowFragments >= 2 && buffer < 4);
      if (this.cap > 0 && danger && now - this.lastDownshiftAt >= 2000) {
        const previous = this.cap;
        this.cap = Math.max(0, previous - (buffer < 0.5 ? 2 : 1));
        if (this.trialLevel === previous) {
          this.failures.set(previous, Math.min(2, (this.failures.get(previous) || 0) + 1));
        }
        this.resetEvidence();
        this.phase = 'recovering';
        this.lastDownshiftAt = now;
        return this.result(true);
      }

      // Only upgrade on repeated, measured network headroom and a sustainable
      // producer; RKMPP's 1x input pacing is not itself slow Wi-Fi.
      const next = this.cap + 1;
      const needed = Math.min(4, 2 + (this.failures.get(next) || 0));
      if (this.cap < limit && this.presentedLevel === this.cap &&
          this.goodFragments >= needed && buffer >= 3 && !this.waiting) {
        this.cap = next;
        this.resetEvidence();
        this.trialLevel = next;
        this.phase = 'normal';
        return this.result(true);
      }
      if (this.phase === 'recovering' && buffer >= 3) this.phase = 'normal';
      return this.result(false);
    }

    resetEvidence() {
      this.presentedLevel = -1;
      this.goodFragments = 0;
      this.slowFragments = 0;
      this.lastSampledFragment = null;
      this.trialLevel = -1;
    }
    result(change) { return {phase:this.phase, cap:this.cap, bps:this.bps, change}; }
  }
  const api = {PlaybackPolicy, chooseLevel};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MemoriesRkmppPolicy = api;
})(typeof window === 'undefined' ? null : window);

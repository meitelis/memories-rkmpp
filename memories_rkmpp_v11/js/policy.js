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
      this.waiting = false;
      this.trialLevel = -1;
    }
    onWaiting() { this.waiting = true; }
    onPlaying() { this.waiting = false; }

    // Measure wall-clock delivery of playable video, including RKMPP work.
    // Pure network bandwidth is not enough when segments are made on demand.
    onFragment({level, duration, elapsedMs, buffer}) {
      if (level !== this.cap || this.presentedLevel !== this.cap ||
          !(duration > 0 && elapsedMs > 0)) return;
      const rate = duration * 1000 / elapsedMs;
      const retry = (this.failures.get(this.cap + 1) || 0) > 0;
      const good = rate >= (retry ? 2 : 1.4) && buffer >= 3;
      this.goodFragments = good ? this.goodFragments + 1 : 0;
      this.slowFragments = rate < 1 && buffer < 4 ? this.slowFragments + 1 : 0;
      // Two sustainable fragments establish that this upgrade succeeded.
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
          this.failures.set(previous, (this.failures.get(previous) || 0) + 1);
        }
        this.resetEvidence();
        this.phase = 'recovering';
        this.lastDownshiftAt = now;
        return this.result(true);
      }

      // Don't try another rung until the current one is actually playing
      // and has supplied two fast segments. After a failed trial, require
      // more (and faster) evidence rather than an arbitrary long timeout.
      const next = this.cap + 1;
      const needed = Math.min(6, 2 + 2 * (this.failures.get(next) || 0));
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
      this.trialLevel = -1;
    }
    result(change) { return {phase:this.phase, cap:this.cap, bps:this.bps, change}; }
  }
  const api = {PlaybackPolicy, chooseLevel};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MemoriesRkmppPolicy = api;
})(typeof window === 'undefined' ? null : window);

(function (root) {
  'use strict';
  const bitrate = level => level?.bitrate || Number(level?.attrs?.BANDWIDTH) || Infinity;
  const original = level => (Array.isArray(level?.url) ? level.url : [level?.url])
    .some(url => /\/direct\.m3u8(?:\?|$)/.test(url || ''));

  // Only the initial connection check selects a starting rendition.
  // Later changes depend on playable buffer health, not FFmpeg throughput.
  function chooseLevel(levels, bps, ready = true, limit = Infinity) {
    let best = 0;
    levels.forEach((level, index) => {
      if (index <= limit && (ready || !original(level)) && bitrate(level) <= bps * 0.8) best = index;
    });
    return best;
  }
  const audioProfile = bps => bps < 450000 ? 'audio32'
    : bps < 1000000 ? 'audio64' : bps < 4000000 ? 'audio96' : 'audio';

  // One owner for Auto quality. hls.js schedules/downloads/fragments,
  // but its encoder-contaminated segment-rate estimate does not pick levels.
  class PlaybackPolicy {
    constructor(levels, initialBps, ready = false) {
      this.levels = levels;
      this.bps = initialBps;
      this.cap = chooseLevel(levels, initialBps, ready);
      this.phase = 'startup';
      this.samples = [];
      this.healthySince = null;
      this.dangerSince = null;
      this.lastChangeAt = 0;
      this.retryAfter = 0;
      this.lastUpgradeAt = -Infinity;
    }
    beginSeek() {
      this.phase = 'seeking';
      this.samples = [];
      this.healthySince = null;
      this.dangerSince = null;
    }
    step({now, buffer, playing, seeking, auto, originalReady = false,
          decoderCap = Infinity, requestAge = 0, currentLevel = this.cap}) {
      const originalIndex = this.levels.findIndex(original);
      const limit = Math.min(decoderCap, originalReady || originalIndex < 0
        ? this.levels.length - 1 : Math.max(0, originalIndex - 1));
      if (this.cap > limit) {
        this.cap = limit;
        this.healthySince = null;
      }
      if (!auto || !playing || seeking) {
        this.samples = [];
        this.healthySince = null;
        this.dangerSince = null;
        return this.result(false);
      }

      this.samples.push({now, buffer});
      this.samples = this.samples.filter(s => now - s.now <= 4000);
      const first = this.samples[0];
      const seconds = (now - first.now) / 1000;
      const trend = seconds >= 1 ? (buffer - first.buffer) / seconds : 0;

      // New streams and cold seeks need time for the first segment.
      // Do not misclassify slow RKMPP production as a slow connection.
      if (this.phase === 'startup' || this.phase === 'seeking') {
        if (buffer >= 6) this.phase = 'normal';
        else if (requestAge < (this.phase === 'seeking' ? 6000 : 9000)) return this.result(false);
        else this.phase = 'normal';
      }

      // Sustained loss of playable buffer is the only reason to downshift.
      // Avoid overreacting to the normal three-second fragment sawtooth.
      const danger = buffer < 0.5 ||
        (buffer < 2.5 && (trend < -0.4 || requestAge > 1800));
      if (!danger) this.dangerSince = null;
      else if (this.dangerSince === null) this.dangerSince = now;

      if (this.cap > 0 && this.dangerSince !== null &&
          (buffer < 0.5 || now - this.dangerSince >= 1000) &&
          now - this.lastChangeAt >= 2000) {
        this.cap = Math.max(0, this.cap - (buffer < 0.5 ? 2 : 1));
        this.phase = 'recovering';
        this.lastChangeAt = now;
        // Only a recent failed upgrade gets a short retry delay.
        if (now - this.lastUpgradeAt < 15000) this.retryAfter = now + 10000;
        this.healthySince = null;
        this.dangerSince = null;
        this.samples = [];
        return this.result(true);
      }

      // Three playable seconds during six-second buffering is sufficient
      // for a cautious one-rung quality trial.
      const healthy = buffer >= 3 && !danger;
      if (!healthy) this.healthySince = null;
      else if (this.healthySince === null) this.healthySince = now;
      if (this.healthySince !== null && now - this.healthySince >= 4000 &&
          now >= this.retryAfter && now - this.lastChangeAt >= 4000 &&
          currentLevel >= this.cap && this.cap < limit) {
        this.cap++;
        this.phase = 'normal';
        this.lastChangeAt = now;
        this.lastUpgradeAt = now;
        this.healthySince = null;
        return this.result(true);
      }
      if (this.phase === 'recovering' && healthy) this.phase = 'normal';
      return this.result(false);
    }
    result(change) {
      return {phase:this.phase, cap:this.cap, bps:this.bps,
        audio:audioProfile(bitrate(this.levels[this.cap])), change};
    }
  }
  const api = {PlaybackPolicy, chooseLevel, audioProfile};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MemoriesRkmppPolicy = api;
})(typeof window === 'undefined' ? null : window);

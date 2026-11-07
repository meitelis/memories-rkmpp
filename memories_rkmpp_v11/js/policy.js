(function (root) {
  'use strict';

  // One state machine. No separate timers or competing bandwidth controllers.
  const BAND = level => Number(level?.bitrate || level?.attrs?.BANDWIDTH) || Infinity;
  const ORIGINAL = level => (Array.isArray(level?.url) ? level.url : [level?.url])
    .some(url => /\/direct\.m3u8(?:\?|$)/.test(url || ''));

  function chooseLevel(levels, bps, ready = true, ceiling = Infinity) {
    let choice = 0;
    for (let i = 0; i < levels.length && i <= ceiling; i++) {
      if (BAND(levels[i]) <= bps * 0.72 && (ready || !ORIGINAL(levels[i]))) choice = i;
    }
    return choice;
  }

  class PlaybackPolicy {
    constructor(levels, measuredBps, originalReady = false) {
      this.levels = levels;
      this.target = chooseLevel(levels, measuredBps, originalReady);
      // A synthetic speed probe cannot prove that Original HLS is sustainable.
      // Start with an encoded rendition; earn Original from actual segments.
      this.originalIndex = levels.findIndex(ORIGINAL);
      if (this.originalIndex > 0 && this.target >= this.originalIndex)
        this.target = this.originalIndex - 1;
      this.phase = 'startup';
      this.samples = [];
      this.seen = new Set();
      this.playingLevel = -1;
      this.lastChange = -Infinity;
      this.blacklist = new Map();
      this.buffering = false;
      this.seek = false;
      this.started = false;
      this.lastReason = 'startup';
      this.upgradePending = false;
    }

    onPlaying() { this.started = true; this.buffering = false; }
    onWaiting() { this.buffering = true; this.samples = []; }
    beginSeek() { this.seek = true; this.samples = []; this.playingLevel = -1; this.upgradePending = false; }
    endSeek() { this.seek = false; this.buffering = false; this.samples = []; }

    onLevelPlayed(level) {
      this.playingLevel = level;
      if (level === this.target) this.upgradePending = false;
    }

    // Only completed and distinct main video fragments count as evidence.
    // Payload transfer is measured apart from FFmpeg startup and pacing.
    onFragment({level, sn, duration, bytes, loading, buffer, now}) {
      if (level !== this.target || !(duration > 0) || !loading) return;
      const id = Number.isInteger(sn) ? level + ':' + sn : null;
      if (id && this.seen.has(id)) return;
      if (id) {
        this.seen.add(id);
        if (this.seen.size > 64) this.seen.delete(this.seen.values().next().value);
      }
      const total = loading.end - loading.start;
      const transfer = loading.end - loading.first;
      const transferBps = bytes >= 16384 && transfer >= 20 && Number.isFinite(transfer)
        ? bytes * 8000 / transfer : 0;
      const rate = total > 0 ? duration * 1000 / total : 0;
      this.samples.push({level, sn, now, rate, transferBps, buffer});
      if (this.samples.length > 6) this.samples.shift();
    }

    // Called every 500 ms, and also after a completed video fragment.
    step({now, buffer, requestAge = 0, auto = true, playing = true,
          seeking = false, decoderCap = Infinity, originalReady = false,
          currentLevel = -1}) {
      if (Number.isInteger(currentLevel) && currentLevel >= 0 && currentLevel !== this.playingLevel) {
        this.onLevelPlayed(currentLevel);
      }
      const limit = Math.max(0, Math.min(
        decoderCap,
        originalReady || this.originalIndex < 0 ? this.levels.length - 1 : this.originalIndex - 1,
      ));
      if (!auto || !playing || seeking || this.seek) {
        this.samples = [];
        return this.result(false);
      }
      if (this.target > limit) return this.move(limit, now, 'decoder-or-original-unavailable');
      if (!this.started) return this.result(false);
      this.phase = this.buffering ? 'buffering' : 'steady';

      // The 20s forward target protects full-segment delivery. Below 9s and
      // with an outstanding slow fragment we are already losing that reserve.
      // Normal 4s segment sawteeth stay above this line.
      const urgent = buffer < 2.5 && (requestAge > 750 || this.buffering);
      const endangered = buffer < 9 && requestAge > 1800;
      const slow = this.samples.length >= 2 &&
        this.samples.slice(-2).every(s => s.rate > 0 && s.rate < 0.78 && s.buffer < 12);
      if (this.target > 0 && (urgent || endangered || slow)) {
        const old = this.target;
        const lower = Math.max(0, old - (urgent ? 2 : 1));
        // A failed higher-rendition trial gets a backoff; other levels aren't penalized.
        if (this.lastReason === 'upgrade' && now - this.lastChange < 25000)
          this.blacklist.set(old, now + (ORIGINAL(this.levels[old]) ? 60000 : 25000));
        return this.move(lower, now, urgent ? 'starvation' : 'slow-delivery');
      }

      // Do not chase buffer peaks. Upgrading requires a full reserve, three
      // independent video fragments, and demonstrable network headroom.
      // The previous rendition must actually be playing, not merely requested.
      const next = this.target + 1;
      if (next > limit || this.playingLevel !== this.target ||
          this.upgradePending || this.buffering ||
          buffer < (ORIGINAL(this.levels[next]) ? 16 : 14) ||
          now - this.lastChange < 12000 ||
          now < (this.blacklist.get(next) || 0) ||
          this.samples.length < 3) return this.result(false);
      const three = this.samples.slice(-3);
      const safe = three.every(s =>
        s.level === this.target && s.transferBps >= BAND(this.levels[next]) *
          (ORIGINAL(this.levels[next]) ? 2 : 1.65) &&
        s.rate >= 0.86 && s.buffer >= 11);
      if (safe) return this.move(next, now, 'upgrade');
      return this.result(false);
    }

    move(target, now, reason) {
      if (target === this.target) return this.result(false);
      this.target = target;
      this.lastChange = now;
      this.lastReason = reason;
      this.samples = [];
      this.seen.clear();
      this.upgradePending = reason === 'upgrade';
      this.phase = reason === 'upgrade' ? 'upgrading' : 'recovering';
      return this.result(true);
    }

    result(change) {
      return {cap:this.target, change, phase:this.phase, reason:this.lastReason};
    }
  }

  const api = {PlaybackPolicy, chooseLevel};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MemoriesRkmppPolicy = api;
})(typeof window === 'undefined' ? null : window);

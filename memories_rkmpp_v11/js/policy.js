(function (root) {
  'use strict';
  const bitrate = level => level?.bitrate || Number(level?.attrs?.BANDWIDTH) || Infinity;
  const original = level => (Array.isArray(level?.url) ? level.url : [level?.url]).some(url => /\/direct\.m3u8(?:\?|$)/.test(url || ''));
  function chooseLevel(levels, bps, ready = true, limit = Infinity) {
    let best = 0;
    levels.forEach((level, index) => {
      if (index <= limit && (ready || !original(level)) && bitrate(level) <= bps * 0.72) best = index;
    });
    return best;
  }
  const audioProfile = bps => bps < 450000 ? 'audio32' : bps < 1000000 ? 'audio64' : bps < 4000000 ? 'audio96' : 'audio';

  // Pure policy: no timers, network requests, DOM, or hls.js mutations.
  // hls.js owns ordinary ABR. This policy gates startup and buffer rescue.
  class PlaybackPolicy {
    constructor(levels, initialBps, ready = false) {
      this.levels = levels;
      this.phase = 'startup';
      this.bps = initialBps;
      this.deliveryBps = initialBps;
      this.latency = 200;
      this.cap = chooseLevel(levels, initialBps, ready);
      this.healthySince = null;
      this.lastChange = 0;
    }
    sample(stats) {
      // A cold seek includes producer startup, not just network delivery.
      if (this.phase === 'seeking') return;
      const load = stats?.loading;
      if (!load || !stats.loaded || !(load.end > load.start)) return;
      this.latency = Math.min(this.latency, Math.max(0, load.first - load.start));
      const effectiveMs = Math.max(25, load.end - load.start - this.latency);
      const rate = stats.loaded * 8000 / effectiveMs;
      this.deliveryBps = rate < this.deliveryBps ? rate : Math.min(rate, this.deliveryBps * 2);
      this.bps = this.phase === 'recovering' ? this.deliveryBps : stats.loaded * 8000 / Math.max(25, load.end - load.first);
    }
    beginSeek() {
      this.phase = 'seeking';
      this.healthySince = null;
    }
    step({now, buffer, playing, seeking, auto, requestAge = 0, loaded = 0, originalReady = false, decoderCap = Infinity, targetBuffer = 18}) {
      const originalIndex = this.levels.findIndex(original);
      const limit = Math.min(decoderCap, originalReady || originalIndex < 0 ? this.levels.length - 1 : Math.max(0, originalIndex - 1));
      let cancel = false;
      this.cap = Math.min(this.cap, limit);
      const healthyBuffer = Math.min(10, targetBuffer * 0.6);
      const criticalBuffer = Math.min(4, targetBuffer * 0.25);
      if (!playing || !auto || (seeking && this.phase !== 'seeking')) {
        this.healthySince = null;
        return this.result(cancel);
      }
      // A metadata-sized buffer is normal before playback has warmed up.
      if (this.phase === 'startup' || this.phase === 'seeking') {
        if (buffer >= healthyBuffer) { this.phase = 'normal'; this.cap = limit; }
        else if (requestAge < 6000) return this.result(cancel);
      }
      const endangered = (buffer < healthyBuffer && requestAge > 2000 && !loaded) || (buffer < criticalBuffer && requestAge > 1000);
      if (endangered && (this.phase !== 'recovering' || this.cap > 0)) {
        this.phase = 'recovering';
        this.cap = 0;
        this.bps = Math.min(this.deliveryBps, bitrate(this.levels[0]) / 0.72);
        this.healthySince = null;
        this.lastChange = now;
        cancel = true;
      } else if (this.phase === 'recovering') {
        if (buffer < healthyBuffer) this.healthySince = null;
        else if (this.healthySince === null) this.healthySince = now;
        const affordable = chooseLevel(this.levels, this.deliveryBps, originalReady, limit);
        if (this.healthySince !== null && now - this.healthySince >= 10000 && now - this.lastChange >= 10000 && affordable > this.cap) {
          this.cap++;
          this.lastChange = now;
          this.healthySince = now;
          if (this.cap === limit) this.phase = 'normal';
        }
      } else this.cap = limit;
      return this.result(cancel);
    }
    result(cancel) { return {phase:this.phase, cap:this.cap, bps:this.bps, audio:audioProfile(this.bps), cancel}; }
  }
  const api = {PlaybackPolicy, chooseLevel, audioProfile};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MemoriesRkmppPolicy = api;
})(typeof window === 'undefined' ? null : window);

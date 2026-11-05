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
      this.networkCap = chooseLevel(levels, initialBps);
      this.budgetCap = this.networkCap;
      this.healthySince = null;
      this.recoveryHealthySince = null;
      this.probeAt = 0;
      this.upgradeHoldUntil = 0;
      this.lastUpgradeAt = -Infinity;
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
    }
    beginSeek() {
      this.phase = 'seeking';
      this.healthySince = null;
      this.recoveryHealthySince = null;
    }
    measured(bps, now, originalReady, decoderCap = Infinity) {
      this.bps = this.deliveryBps = bps;
      this.networkCap = chooseLevel(this.levels, bps);
      if (this.networkCap < this.budgetCap) {
        this.budgetCap = this.networkCap;
      } else if (this.networkCap > this.budgetCap &&
                 this.phase !== 'recovering' && now >= this.upgradeHoldUntil) {
        // A fast network probe alone does not establish the segment-production
        // rate of a newly started hardware rendition. Upgrade incrementally.
        this.budgetCap = Math.min(this.networkCap, this.budgetCap + 2);
        this.lastUpgradeAt = now;
        this.upgradeHoldUntil = now + 15000;
      }
      const originalIndex = this.levels.findIndex(original);
      const limit = Math.min(decoderCap, originalReady || originalIndex < 0 ?
        this.levels.length - 1 : Math.max(0, originalIndex - 1));
      this.cap = Math.min(this.budgetCap, limit);
      this.healthySince = now;
      this.probeAt = now + 15000;
    }
    step({now, buffer, playing, seeking, auto, requestAge = 0, loaded = 0, originalReady = false, decoderCap = Infinity, targetBuffer = 18, currentLevel = this.cap, requestedLevel = currentLevel}) {
      const originalIndex = this.levels.findIndex(original);
      const limit = Math.min(decoderCap, originalReady || originalIndex < 0 ? this.levels.length - 1 : Math.max(0, originalIndex - 1));
      let cancel = false;
      let probe = false;
      this.cap = Math.min(this.budgetCap, limit);
      const healthyBuffer = Math.min(10, targetBuffer * 0.6);
      const criticalBuffer = Math.min(4, targetBuffer * 0.25);
      if (!playing || !auto || (seeking && this.phase !== 'seeking')) {
        this.healthySince = null;
        this.recoveryHealthySince = null;
        return this.result(cancel);
      }
      // A metadata-sized buffer is normal before playback has warmed up.
      if (this.phase === 'startup' || this.phase === 'seeking') {
        if (buffer >= healthyBuffer) this.phase = 'normal';
        // Cold RKMPP startup can be slow without indicating a weak network.
        // A genuinely stalled seek still uses the existing six-second gate.
        else if (requestAge < (this.phase === 'startup' ? 9000 : 6000)) return this.result(cancel);
      }
      const endangered = (buffer < healthyBuffer && requestAge > 2000 && !loaded) || (buffer < criticalBuffer && requestAge > 1000);
      if (endangered && (this.phase !== 'recovering' || this.cap > 0)) {
        this.phase = 'recovering';
        this.cap = 0;
        this.budgetCap = 0;
        this.networkCap = 0;
        this.bps = Math.min(this.deliveryBps, bitrate(this.levels[0]) / 0.72);
        this.healthySince = null;
        this.recoveryHealthySince = null;
        // A recent upgrade that starved playback deserves a longer cooldown.
        this.upgradeHoldUntil = Math.max(this.upgradeHoldUntil,
          now + (now - this.lastUpgradeAt < 20000 ? 60000 : 10000));
        // Only abort an actual higher-quality request; restarting a 480p
        // producer discards its useful progress without fixing throughput.
        cancel = requestedLevel > 0;
      } else if (this.phase === 'recovering') {
        // Independent of the 6-second timer used for bandwidth probes:
        // require ten continuous seconds with a FULL healthy buffer.
        if (buffer < healthyBuffer) this.recoveryHealthySince = null;
        else if (this.recoveryHealthySince === null) this.recoveryHealthySince = now;
        else if (now - this.recoveryHealthySince >= 10000) {
          this.phase = 'normal';
          this.recoveryHealthySince = null;
        }
      }
      if (buffer < Math.min(6, healthyBuffer)) this.healthySince = null;
      else if (this.healthySince === null) this.healthySince = now;
      // A paced encoder can hold a request until the next segment exists.
      // That wait cannot establish network capacity. Remeasure when a lower
      // rendition has healthy buffers, including after weak-network startup.
      if (currentLevel < limit && this.healthySince !== null && now - this.healthySince >= 10000 && now >= this.probeAt) {
        this.probeAt = now + 15000;
        probe = true;
      }
      return this.result(cancel, probe);
    }
    result(cancel, probe = false) { return {phase:this.phase, cap:this.cap, bps:this.bps, audio:audioProfile(this.bps), cancel, probe}; }
  }
  const api = {PlaybackPolicy, chooseLevel, audioProfile};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MemoriesRkmppPolicy = api;
})(typeof window === 'undefined' ? null : window);

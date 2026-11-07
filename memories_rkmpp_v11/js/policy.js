(function (root) {
  'use strict';
  // Pure helpers only. hls.js is the sole Auto rendition selector.
  const isOriginal = level => (Array.isArray(level?.url) ? level.url : [level?.url])
    .some(url => /\/direct\.m3u8(?:\?|$)/.test(url || ''));

  const bitrate = level => Number(level?.maxBitrate || level?.bitrate || level?.attrs?.BANDWIDTH) || Infinity;

  // Measure only HTTP first-byte -> final-byte. RKMPP may spend several
  // seconds creating a segment before the first byte is available.
  function transferBandwidth(stats) {
    const t = stats?.loading;
    const bytes = Number(stats?.loaded) || 0;
    if (!(t?.first > 0 && t?.end > t.first && bytes >= 16384)) return 0;
    return Math.min(120000000, bytes * 8000 / Math.max(20, t.end - t.first));
  }

  // An independent measurement can justify reconsidering a level without
  // directly prescribing that level: hls.js remains responsible for ABR.
  function canTryHigherLevel(levels, index, measuredBps, factor = 1.5) {
    if (!Array.isArray(levels) || !Number.isInteger(index) || index < 0 ||
        index >= levels.length - 1 || !Number.isFinite(measuredBps)) return false;
    const next = levels[index + 1];
    return measuredBps > 0 && measuredBps >= bitrate(next) * factor;
  }

  // Conserve headroom when feeding network-only samples to the hls.js EWMA.
  function safeEstimate(bps) {
    return Number.isFinite(bps) && bps > 0
      ? Math.max(150000, Math.round(Math.min(bps, 120000000) * 0.75)) : 0;
  }

  const api = {isOriginal, bitrate, transferBandwidth, canTryHigherLevel, safeEstimate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MemoriesRkmppPolicy = api;
})(typeof window === 'undefined' ? null : window);

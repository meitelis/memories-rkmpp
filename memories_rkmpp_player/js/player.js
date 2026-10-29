(() => {
  'use strict';
  if (!/\/apps\/memories(?:\/|$)/.test(location.pathname)) return;
  const marker = Symbol.for('memories-rkmpp-player');
  if (window[marker]) return;
  window[marker] = true;
  console.info('[Memories RKMPP] Balanced player active');
  const seen = new WeakSet();
  const settings = {
    autoStartLoad: false,
    capLevelToPlayerSize: true,
    maxDevicePixelRatio: 1.5,
    capLevelOnFPSDrop: true,
    maxBufferLength: 12,
    maxMaxBufferLength: 12,
    maxBufferSize: 32 * 1000 * 1000,
    backBufferLength: 3,
    maxStarvationDelay: 0.5,
  };
  function budget(hls, index) {
    const level = hls.levels[index];
    const bitrate = level && (level.maxBitrate || level.bitrate);
    const seconds = bitrate > 0 ? Math.max(6, Math.min(12, 32 * 1000 * 1000 * 8 / bitrate)) : 12;
    hls.config.maxBufferLength = seconds;
    hls.config.maxMaxBufferLength = seconds;
  }
  document.addEventListener('hls-instance', (event) => {
    const hls = event.detail;
    const events = hls && hls.constructor && hls.constructor.Events;
    if (!events || typeof hls.once !== 'function' || seen.has(hls)) return;
    seen.add(hls);
    const apply = () => Object.assign(hls.config, settings);
    apply();
    queueMicrotask(apply);
    hls.once(events.MANIFEST_PARSED, () => {
      const levels = hls.levels;
      let index = 0;
      let best = 0;
      levels.forEach((level, i) => {
        const edge = Math.min(level.width || 0, level.height || 0);
        if (edge > best && edge <= 1080) { best = edge; index = i; }
      });
      if (levels.length) {
        hls.startLevel = index;
        hls.nextAutoLevel = index;
        budget(hls, index);
        console.info('[Memories RKMPP] Initial Auto quality:', best || 'lowest available');
      }
      hls.startLoad();
    });
    hls.on(events.LEVEL_SWITCHING, (_, data) => budget(hls, data.level));
    hls.on(events.ERROR, (_, data) => {
      console.warn('[Memories RKMPP] Player event:', data.details, 'fatal:', !!data.fatal);
    });
  }, true);
})();

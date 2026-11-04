(function () {
  'use strict';

  function codecName(level) {
    const codec = level?.videoCodec || level?.attrs?.CODECS || '';
    return /hvc1|hev1/i.test(codec) ? 'HEVC' : /avc1/i.test(codec) ? 'H.264' : '';
  }

  function autoCap(levels, width, height, dpr) {
    const physical = Math.min(width, height) * Math.max(1, dpr || 1);
    const target = Math.max(1080, physical);
    let cap = -1;
    levels.forEach((l, i) => {
      if (Math.min(l.width || Infinity, l.height || Infinity) <= target) cap = i;
    });
    return cap;
  }

  function selectQuality(video, hls, id) {
    if (id === 'auto') {
      hls.loadLevel = -1;
    } else {
      const option = video.qualityList?.find(o => o.id === id);
      if (!option || !Number.isInteger(option.index)) return;
      // currentLevel flushes the playing fragment, which causes visible
      // jumps and can interrupt audio. Muxed AAC keeps its existing buffer;
      // shared audio can switch at the next video fragment boundary.
      const sharedAudio = !!hls.levels[option.index]?.audioGroupIds?.length;
      if (sharedAudio) hls.nextLevel = option.index;
      else hls.loadLevel = option.index;
    }
    video._qualitySelected = id;
    video.dispatchEvent(new CustomEvent('quality-selected'));
  }

  function renditionText(video, hls) {
    if (!video.videoWidth || !video.videoHeight) return 'Loading video…';
    const level = hls?.levels?.[hls.currentLevel];
    const urls = level?.url || [];
    const original = (Array.isArray(urls) ? urls : [urls]).some(u => /\/direct\.m3u8(?:\?|$)/.test(u));
    const mode = original ? 'Original' : (hls?.autoLevelEnabled ? 'Auto' : 'Playing');
    const size = Math.min(video.videoWidth, video.videoHeight);
    const codec = codecName(level);
    return `${mode} · ${size}p (${video.videoWidth}×${video.videoHeight})${codec ? ' · ' + codec : ''}`;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {autoCap, selectQuality, renditionText};
  }
  if (typeof document === 'undefined') return;

  const attached = new Map();
  function attach(video) {
    if (attached.has(video) || !(video instanceof HTMLVideoElement)) return;
    const badge = document.createElement('div');
    badge.className = 'mr-v11-status';
    badge.setAttribute('role', 'status');
    const parent = video.closest('.memories-video-stage');
    if (!parent) return;
    parent.appendChild(badge);
    const state = {badge, hls: null, descriptor: null};
    attached.set(video, state);
    video.addEventListener('resize', () => update(video, state));
    video.addEventListener('loadedmetadata', () => update(video, state));
    update(video, state);
  }

  function update(video, state) {
    const hls = video._qualityHls;
    if (hls && state.hls !== hls) {
      state.hls = hls;
      state.descriptor = Object.getOwnPropertyDescriptor(video, 'currentQuality');
      if (state.descriptor?.configurable) {
        Object.defineProperty(video, 'currentQuality', {
          configurable: true,
          get: () => video._qualitySelected || 'auto',
          set: id => selectQuality(video, hls, id),
        });
      }
      hls.config.maxBufferLength = 12;
      hls.config.maxMaxBufferLength = 18;
      hls.config.backBufferLength = 20;
    }
    if (hls?.levels?.length && hls.autoLevelEnabled) {
      const rect = video.getBoundingClientRect();
      const aspect = video.videoWidth / video.videoHeight || 16 / 9;
      const width = Math.min(rect.width, rect.height * aspect);
      const height = Math.min(rect.height, rect.width / aspect);
      hls.autoLevelCapping = autoCap(hls.levels, width, height, window.devicePixelRatio);
    }
    const text = renditionText(video, hls);
    if (state.badge.textContent !== text) state.badge.textContent = text;
    // Local diagnostics only; no telemetry leaves the browser.
    if (typeof video.getVideoPlaybackQuality === 'function') {
      const q = video.getVideoPlaybackQuality();
      state.badge.dataset.droppedFrames = String(q.droppedVideoFrames);
      state.badge.dataset.totalFrames = String(q.totalVideoFrames);
    }
  }

  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches('video')) attach(node);
      node.querySelectorAll('video').forEach(attach);
    }
  }).observe(document.documentElement, {childList: true, subtree: true});
  document.querySelectorAll('video').forEach(attach);
  setInterval(() => {
    for (const [video, state] of attached) {
      if (!video.isConnected) {
        state.badge.remove();
        attached.delete(video);
      } else update(video, state);
    }
  }, 1000);
})();

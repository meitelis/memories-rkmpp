(() => {
  'use strict';

  function shortEdge(level) {
    const { width, height } = level;
    return width > 0 && height > 0 ? Math.min(width, height) : 0;
  }

  function initialLevel(levels) {
    let index = 0;
    let best = 0;
    levels.forEach((level, i) => {
      const edge = shortEdge(level);
      if (edge > best && edge <= 1080) { best = edge; index = i; }
    });
    return index;
  }

  // Vidstack 1.x labels quality by height. Change presentation only: HLS
  // dimensions, quality IDs, selection, and aspect ratio remain untouched.
  function qualityText(text, level) {
    const edge = level && shortEdge(level);
    return edge ? text.replace(/\b\d+p\b/g, `${edge}p`) : text;
  }

  // Keep Lit/Maverick's comment anchors and child elements intact. Replacing
  // textContent on a reactive hint would detach the player's update targets.
  function updateQualityText(element, level) {
    for (const node of element.childNodes) {
      if (node.nodeType === 3) {
        const value = qualityText(node.data, level);
        if (value !== node.data) node.data = value;
      } else if (node.nodeType === 1) {
        updateQualityText(node, level);
      }
    }
  }

  function manifestURL(value, origin, hevc) {
    const url = new URL(value, origin);
    if (url.origin !== new URL(origin).origin ||
        !url.pathname.includes('/apps/memories/api/video/transcode/') ||
        !url.pathname.endsWith('/index.m3u8')) return value;
    // File playback support does not necessarily imply HLS/MSE support.
    url.searchParams.set('codecs', hevc ? 'h264,hevc' : 'h264');
    return url.href;
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { shortEdge, initialLevel, qualityText, updateQualityText, manifestURL };
    return;
  }
  if (!/\/apps\/memories(?:\/|$)/.test(location.pathname)) return;
  const marker = Symbol.for('memories-rkmpp-player');
  if (window[marker]) return;
  window[marker] = true;

  const seen = new WeakSet();
  const forceAVC = new WeakSet();
  let active = null;
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

  function supportsHEVC() {
    const source = window.ManagedMediaSource || window.MediaSource;
    try {
      return !!source?.isTypeSupported('video/mp4; codecs="hvc1.1.6.L123.80"');
    } catch {
      return false;
    }
  }

  function budget(hls, index) {
    const level = hls.levels[index];
    const bitrate = level && (level.maxBitrate || level.bitrate);
    const seconds = bitrate > 0 ? Math.max(6, Math.min(12, 32 * 1000 * 1000 * 8 / bitrate)) : 12;
    hls.config.maxBufferLength = seconds;
    hls.config.maxMaxBufferLength = seconds;
  }

  function refreshQualityLabels() {
    if (!active?.player.isConnected) return;
    const levels = active.hls.levels;
    for (const menu of document.querySelectorAll('.vds-quality-menu')) {
      for (const radio of menu.querySelectorAll('media-radio')) {
        const id = radio.getAttribute('value');
        const level = levels.find((item) => `${item.height}_${item.bitrate}` === id);
        const label = radio.querySelector('[data-part="label"]');
        if (level && label) {
          updateQualityText(label, level);
        }
      }
      for (const hint of menu.querySelectorAll('.vds-menu-hint')) {
        updateQualityText(hint, active.quality);
      }
    }
  }

  // Menus can be portalled outside media-player. Ignore clock, thumbnail,
  // and unrelated Nextcloud mutations before querying the quality menu.
  new MutationObserver((records) => {
    if (records.some((record) => {
      const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      return element?.closest('.vds-quality-menu') || [...record.addedNodes].some((node) =>
        node.nodeType === 1 && (node.matches('.vds-quality-menu') || node.querySelector('.vds-quality-menu')));
    })) refreshQualityLabels();
  }).observe(document.documentElement, { childList: true, characterData: true, subtree: true });

  document.addEventListener('hls-instance', (event) => {
    const hls = event.detail;
    const player = event.target.closest?.('media-player');
    const events = hls?.constructor?.Events;
    if (!player || !events || typeof hls.once !== 'function' || seen.has(hls)) return;
    seen.add(hls);
    active = { player, hls, quality: null };

    // Public hls.js playlist loader hook: negotiate before loading the master.
    const Loader = hls.constructor.DefaultConfig.loader;
    class PlaylistLoader extends Loader {
      load(context, config, callbacks) {
        const url = manifestURL(context.url, location.href, !forceAVC.has(player) && supportsHEVC());
        super.load({ ...context, url }, config, callbacks);
      }
    }
    const apply = () => Object.assign(hls.config, settings, { pLoader: PlaylistLoader });
    apply();
    queueMicrotask(apply);

    hls.once(events.MANIFEST_PARSED, () => {
      if (hls.levels.length) {
        const index = initialLevel(hls.levels);
        hls.startLevel = index;
        hls.nextAutoLevel = index;
        budget(hls, index);
      }
      refreshQualityLabels();
      hls.startLoad();
    });
    hls.on(events.LEVEL_SWITCHING, (_, data) => budget(hls, data.level));
    hls.on(events.LEVEL_SWITCHED, (_, data) => {
      if (active?.hls === hls) {
        active.quality = hls.levels[data.level];
        refreshQualityLabels();
      }
    });
    hls.on(events.DESTROYING, () => {
      if (active?.hls === hls) active = null;
    });
    hls.on(events.ERROR, (_, data) => {
      console.warn('[Memories RKMPP] Player event:', data.details, 'fatal:', !!data.fatal);
      if (!data.fatal || forceAVC.has(player) || !hls.url ||
          !/manifestIncompatibleCodecs|bufferAddCodec|bufferAppending|fragParsing/.test(data.details)) return;
      // Browser/driver combinations can over-report support. Retry once with
      // AVC, preserving the play position, rather than looping indefinitely.
      forceAVC.add(player);
      const time = player.currentTime;
      const paused = player.paused;
      player.addEventListener('can-play', () => {
        player.currentTime = time;
        if (!paused) player.play().catch(() => {});
      }, { once: true });
      player.src = { src: manifestURL(hls.url, location.href, false), type: 'application/x-mpegurl' };
    });
  }, true);
})();

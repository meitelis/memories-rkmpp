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

  function playbackPreferences(value) {
    const input = value && typeof value === 'object' ? value : {};
    return {
      codec: ['auto', 'hevc', 'h264'].includes(input.codec) ? input.codec : 'auto',
      buffer: ['auto', 'responsive', 'smooth', 'custom'].includes(input.buffer) ? input.buffer : 'auto',
      customSeconds: typeof input.customSeconds === 'number' && Number.isFinite(input.customSeconds) &&
        input.customSeconds >= 6 && input.customSeconds <= 30 ? Math.round(input.customSeconds) : 12,
    };
  }

  function prefersHEVC(preferences, supported, failed = false) {
    return !!supported && !failed && preferences.codec !== 'h264';
  }

  function bufferSeconds(preferences, level, bandwidthEstimate) {
    const candidate = level && (level.maxBitrate || level.bitrate);
    const bitrate = Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
    let seconds = preferences.buffer === 'responsive' ? 6 : preferences.buffer === 'smooth' ? 18 :
      preferences.buffer === 'custom' ? preferences.customSeconds : 12;
    if (preferences.buffer === 'auto' && bitrate > 0 && Number.isFinite(bandwidthEstimate) && bandwidthEstimate > 0) {
      const margin = bandwidthEstimate / bitrate;
      if (margin < 1.3) seconds = 18;
      else if (margin >= 3 && bandwidthEstimate > 25 * 1000 * 1000) seconds = 6;
    }
    return bitrate > 0 ? Math.min(seconds, 32 * 1000 * 1000 * 8 / bitrate) : seconds;
  }

  if (typeof document === 'undefined' && typeof module === 'object' && module.exports) {
    module.exports = { shortEdge, initialLevel, qualityText, updateQualityText, manifestURL, playbackPreferences, prefersHEVC, bufferSeconds };
    return;
  }
  if (!/\/apps\/memories(?:\/|$)/.test(location.pathname)) return;
  const marker = Symbol.for('memories-rkmpp-player');
  if (window[marker]) return;
  window[marker] = true;
  console.info('[Memories RKMPP] Player helper 0.3.1 active');

  const seen = new WeakSet();
  const players = new WeakSet();
  const providers = new WeakSet();
  const forceAVC = new WeakSet();
  const pendingRestore = new WeakMap();
  const settingsMarker = Symbol.for('memories-rkmpp-settings');
  let preferences = playbackPreferences();
  let settingsService = null;
  let unsubscribeSettings = null;
  let active = null;
  const settings = {
    autoStartLoad: false,
    capLevelToPlayerSize: true,
    // Respect the real display density; a 1.5x cap underserves phone screens.
    ignoreDevicePixelRatio: false,
    maxDevicePixelRatio: Number.POSITIVE_INFINITY,
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
    const seconds = bufferSeconds(preferences, level, hls.bandwidthEstimate);
    hls.config.maxBufferLength = seconds;
    hls.config.maxMaxBufferLength = seconds;
    if (active?.hls === hls) {
      const codec = level?.videoCodec;
      settingsService?.updatePlaybackStatus?.({
        codec: codec ? (/^(hvc1|hev1)/.test(codec) ? 'hevc' : 'h264') :
          (prefersHEVC(preferences, supportsHEVC(), forceAVC.has(active.player)) ? 'hevc' : 'h264'),
        hevcSupported: supportsHEVC(), shortEdge: level && shortEdge(level), bufferSeconds: seconds,
      });
    }
  }

  function reloadOutput(player, hls, hevc, force = false) {
    const previous = pendingRestore.get(player);
    const current = previous?.url || hls.url;
    if (!current) return;
    const url = manifestURL(current, location.href, hevc);
    if (!force && url === current) return;
    const time = previous?.time ?? player.currentTime;
    const restore = { url, time: Number.isFinite(time) && time >= 0 ? time : 0, paused: previous?.paused ?? player.paused };
    pendingRestore.set(player, restore);
    player.addEventListener('can-play', () => {
      const currentHls = active?.player === player ? active.hls : hls;
      discardUnrelatedRestore(player, currentHls.url);
      if (pendingRestore.get(player) !== restore) return;
      pendingRestore.delete(player);
      player.currentTime = restore.time;
      if (restore.paused) player.pause?.();
      else player.play?.()?.catch?.(() => {});
    }, { once: true });
    player.src = { src: url, type: 'application/x-mpegurl' };
  }

  function discardUnrelatedRestore(player, source, mastersOnly = true) {
    const pending = pendingRestore.get(player);
    if (!pending || typeof source !== 'string' || !source) return;
    const url = new URL(source, location.href);
    if (mastersOnly && !url.pathname.endsWith('/index.m3u8')) return;
    const previous = new URL(pending.url, location.href);
    if (url.origin !== previous.origin || url.pathname !== previous.pathname) pendingRestore.delete(player);
  }

  function applyPreferences(value) {
    const previous = preferences;
    preferences = playbackPreferences(value);
    if (!active?.player.isConnected) return;
    const { player, hls } = active;
    budget(hls, hls.currentLevel >= 0 ? hls.currentLevel : 0);
    const supported = supportsHEVC();
    const failed = forceAVC.has(player);
    if (prefersHEVC(previous, supported, failed) !== prefersHEVC(preferences, supported, failed)) {
      reloadOutput(player, hls, prefersHEVC(preferences, supported, failed));
    }
  }

  function connectSettings() {
    const service = window[settingsMarker];
    if (!service || service === settingsService) return;
    unsubscribeSettings?.();
    settingsService = service;
    try { applyPreferences(service.getPreferences()); } catch { applyPreferences(); }
    unsubscribeSettings = service.subscribe?.(applyPreferences);
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
      for (const hint of menu.querySelectorAll('[data-part="hint"]')) {
        updateQualityText(hint, active.quality);
      }
    }
  }

  // Menus can be portalled outside media-player. Ignore clock, thumbnail,
  // and unrelated Nextcloud mutations before querying the quality menu.
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches('media-player')) watchPlayer(node);
        for (const player of node.querySelectorAll('media-player')) watchPlayer(player);
      }
    }
    if (records.some((record) => {
      const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      return element?.closest('.vds-quality-menu') || [...record.addedNodes].some((node) =>
        node.nodeType === 1 && (node.matches('.vds-quality-menu') || node.querySelector('.vds-quality-menu')));
    })) refreshQualityLabels();
  }).observe(document.documentElement, { childList: true, characterData: true, subtree: true });

  function configureHLS(player, hls) {
    const events = hls?.constructor?.Events;
    if (!player || !events || typeof hls.on !== 'function' || seen.has(hls)) return;
    seen.add(hls);
    discardUnrelatedRestore(player, hls.url);
    // hls.js keeps the playing fragment and fetch-time padding, replacing
    // later buffered fragments so a manual choice need not wait the full buffer.
    if (player.qualities) player.qualities.switch = 'next';
    active = { player, hls, quality: hls.levels[hls.currentLevel] || null };
    const useHEVC = () => prefersHEVC(preferences, supportsHEVC(), forceAVC.has(player));
    console.info('[Memories RKMPP] HLS output preference:', useHEVC() ? 'HEVC' : 'AVC');

    // Public hls.js playlist loader hook: negotiate before loading the master.
    const Loader = hls.constructor.DefaultConfig.loader;
    class PlaylistLoader extends Loader {
      load(context, config, callbacks) {
        const url = manifestURL(context.url, location.href, useHEVC());
        discardUnrelatedRestore(player, url);
        super.load({ ...context, url }, config, callbacks);
      }
    }
    const apply = () => {
      Object.assign(hls.config, settings, { pLoader: PlaylistLoader });
      budget(hls, hls.currentLevel >= 0 ? hls.currentLevel : 0);
    };
    apply();
    queueMicrotask(apply);

    const initialize = () => {
      discardUnrelatedRestore(player, hls.url);
      const resume = pendingRestore.get(player);
      if (hls.levels.length && (resume || !player.currentTime)) {
        const index = initialLevel(hls.levels);
        hls.startLevel = index;
        hls.nextAutoLevel = index;
        budget(hls, index);
      }
      refreshQualityLabels();
      if (resume || !player.currentTime) hls.startLoad(resume?.time);
    };
    // Vidstack reuses the HLS instance for another HLS source. Every codec
    // replacement needs startLoad because autoStartLoad remains disabled.
    hls.on(events.MANIFEST_PARSED, initialize);
    hls.on(events.LEVEL_SWITCHING, (_, data) => budget(hls, data.level));
    if (events.FRAG_LOADED) hls.on(events.FRAG_LOADED, () => {
      if (preferences.buffer === 'auto') budget(hls, hls.currentLevel >= 0 ? hls.currentLevel : 0);
    });
    hls.on(events.LEVEL_SWITCHED, (_, data) => {
      if (active?.hls === hls) {
        active.quality = hls.levels[data.level];
        refreshQualityLabels();
      }
    });
    hls.on(events.DESTROYING, () => {
      if (active?.hls === hls) {
        active = null;
        settingsService?.updatePlaybackStatus?.(null);
      }
    });
    hls.on(events.ERROR, (_, data) => {
      console.warn('[Memories RKMPP] Player event:', data.details, 'fatal:', !!data.fatal);
      if (!data.fatal || forceAVC.has(player) || !hls.url ||
          !/manifestIncompatibleCodecs|bufferAddCodec|bufferAppending|fragParsing/.test(data.details)) return;
      // Browser/driver combinations can over-report support. Retry once with
      // AVC, preserving the play position, rather than looping indefinitely.
      forceAVC.add(player);
      reloadOutput(player, hls, false, true);
    });

    // onInstance also reports an instance created before this script attached.
    // If its master is already loading, restart just the initial manifest with
    // the correct MSE capability report. Never reset an active playhead.
    if (hls.url && !player.currentTime) {
      const url = manifestURL(hls.url, location.href, useHEVC());
      if (url !== hls.url) {
        hls.stopLoad();
        hls.loadSource(url);
        return;
      }
    }
    if (hls.levels.length) initialize();
  }

  function watchProvider(player, provider) {
    if (provider?.type !== 'hls' || typeof provider.onInstance !== 'function' || providers.has(provider)) return;
    providers.add(provider);
    provider.onInstance((hls) => configureHLS(player, hls));
  }

  function watchPlayer(player) {
    if (!players.has(player)) {
      players.add(player);
      player.addEventListener('source-change', (event) => {
        // Source events identify native/direct replacements too. Query-only
        // codec or token changes still refer to the same asset and keep resume.
        discardUnrelatedRestore(player, event.detail?.src, false);
      });
      player.addEventListener('provider-change', (event) => watchProvider(player, event.detail));
      player.addEventListener('hls-instance', (event) => configureHLS(player, event.detail));
    }
    watchProvider(player, player.provider);
  }

  document.addEventListener('hls-instance', (event) => {
    const player = event.target.closest?.('media-player');
    if (player) configureHLS(player, event.detail);
  }, true);
  window.addEventListener?.('memories-rkmpp-settings-ready', connectSettings);
  connectSettings();
  for (const player of document.querySelectorAll('media-player')) watchPlayer(player);
})();

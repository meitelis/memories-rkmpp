(() => {
  'use strict';

  const DIRECT_MIN_BUFFER = 4;
  const DIRECT_RISK_HORIZON = 8;

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

  // Select the highest actual advertised rendition bitrate that fits a
  // measured bandwidth budget. Do not infer bitrate from resolution.
  function initialLevelForThroughput(levels, throughputBps, safety = 0.7) {
    if (!Array.isArray(levels) || !levels.length) return 0;
    if (!(Number.isFinite(throughputBps) && throughputBps > 0)) return initialLevel(levels);
    const budget = throughputBps * safety;
    let best = -1, bestRate = -1, lowest = 0, lowestRate = Infinity;
    levels.forEach((level, index) => {
      const rate = Number(level.maxBitrate || level.bitrate);
      if (!Number.isFinite(rate) || rate <= 0) return;
      if (rate < lowestRate) { lowestRate = rate; lowest = index; }
      if (rate <= budget && rate > bestRate) { bestRate = rate; best = index; }
    });
    return best >= 0 ? best : lowest;
  }

  // A conservative, buffer-aware downshift: avoid waiting for an actual
  // stall before lowering the next requested HLS rendition.
  function preventiveLevel(levels, currentIndex, throughputBps, bufferSeconds) {
    if (!Array.isArray(levels) || !levels.length || currentIndex < 0 ||
        currentIndex >= levels.length || !Number.isFinite(throughputBps) ||
        throughputBps <= 0) return currentIndex;
    const current = Number(levels[currentIndex].maxBitrate || levels[currentIndex].bitrate);
    if (!Number.isFinite(current) || current <= 0) return currentIndex;
    const margin = bufferSeconds < 5 ? 0.6 : bufferSeconds < 10 ? 0.7 : 0.8;
    if (current <= throughputBps * margin) return currentIndex;
    return initialLevelForThroughput(levels, throughputBps, margin);
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


  // Memories 10.2.0 chooses HLS whenever go-vod is enabled. The companion
  // reselects the authenticated original stream on the same media-player.
  // Never manufacture an unauthenticated WebDAV URL or probe private files
  // through a different origin.
  function directSource(value, origin) {
    const source = typeof value === 'string' ? value : value?.src;
    if (typeof source !== 'string') return null;
    let url;
    try { url = new URL(source, origin); } catch { return null; }
    if (url.origin !== new URL(origin).origin) return null;
    const match = /^(.*\/apps\/memories\/api)\/video\/transcode\/[a-fA-F0-9]{8,128}\/(\d+)\/index\.m3u8$/.exec(url.pathname);
    if (!match) return null;
    const original = new URL(url.href);
    original.pathname = match[1] + '/stream/' + match[2];
    original.search = '';
    for (const name of ['token', 'albums']) {
      const value = url.searchParams.get(name);
      if (value !== null) original.searchParams.set(name, value);
    }
    return {
      original: original.href,
      master: url.href,
      key: original.href,
    };
  }

  // A direct MP4 does not have a bitrate ladder. It is only beneficial if
  // playable; real decoder errors or sustained buffer starvation switch back
  // to the same authenticated HLS master with RKMPP adaptive fallback.
  const directPlayback = new WeakMap();
  const DIRECT_STALL_MS = 6000;
  const DIRECT_CHECK_MS = 1000;

  function stopDirectTimer(state) {
    if (state?.monitorTimer != null) { clearInterval(state.monitorTimer); state.monitorTimer = null; }
    if (state?.stallTimer !== null && state?.stallTimer !== undefined) {
      clearTimeout(state.stallTimer);
      state.stallTimer = null;
    }
  }

  function playbackTime(player) {
    const media = player.querySelector?.('video');
    const value = media?.readyState ? media.currentTime : player.currentTime;
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  function fallbackToHLS(player, state, reason) {
    if (!state || directPlayback.get(player) !== state || state.mode !== 'direct') return;
    stopDirectTimer(state);
    state.mode = 'hls';
    console.info('[Memories RKMPP] Direct playback unavailable (' + reason + '); using adaptive HLS');
    const restore = { url: state.master, time: playbackTime(player), paused: !!player.paused };
    pendingRestore.set(player, restore);
    if (restore.paused) holdPausedAutoplay(player, state.master);
    player.addEventListener('can-play', () => {
      if (directPlayback.get(player) !== state || pendingRestore.get(player) !== restore) return;
      pendingRestore.delete(player);
      player.currentTime = restore.time;
      if (restore.paused) player.pause?.();
      else player.play?.()?.catch?.(() => {});
    }, { once: true });
    player.src = { src: state.master, type: 'application/x-mpegurl' };
  }

  function bufferedAhead(media) {
    if (!media?.buffered || !Number.isFinite(media.currentTime)) return 0;
    for (let i = 0; i < media.buffered.length; i++) {
      if (media.buffered.start(i) <= media.currentTime &&
          media.buffered.end(i) >= media.currentTime) {
        return Math.max(0, media.buffered.end(i) - media.currentTime);
      }
    }
    return 0;
  }

  // Observe the actual playable buffer, rather than trusting a connection
  // speed estimate. Falling buffer predicts starvation even for variable
  // bitrate originals; two consecutive samples avoid reacting to jitter.
  function directBufferRisk(previous, current, elapsedSeconds) {
    if (!previous || !(elapsedSeconds > 0) || current < 0) return false;
    const drain = (previous - current) / elapsedSeconds;
    if (drain <= 0.25) return false;
    return current < DIRECT_MIN_BUFFER ||
      (current / drain < DIRECT_RISK_HORIZON && current < 12);
  }

  function monitorDirectPlayback(player, state) {
    if (state.monitorTimer != null) return;
    state.monitorTimer = setInterval(() => {
      if (directPlayback.get(player) !== state || state.mode !== 'direct' ||
          !player.isConnected) { stopDirectTimer(state); return; }
      if (player.paused || player.seeking) { state.lastBuffer = null; state.riskCount = 0; return; }
      const media = player.querySelector?.('video');
      if (!media || media.readyState < 2) return;
      const now = performance.now();
      const ahead = bufferedAhead(media);
      const risk = state.lastBuffer !== null &&
        directBufferRisk(state.lastBuffer, ahead, (now - state.lastSample) / 1000);
      state.riskCount = risk ? state.riskCount + 1 : 0;
      state.lastBuffer = ahead;
      state.lastSample = now;
      if (state.riskCount >= 2) fallbackToHLS(player, state, 'predicted buffer exhaustion');
    }, DIRECT_CHECK_MS);
  }

  function scheduleDirectStall(player) {
    const state = directPlayback.get(player);
    if (!state || state.mode !== 'direct' || player.paused || state.stallTimer !== null) return;
    state.stallTimer = setTimeout(() => {
      state.stallTimer = null;
      if (directPlayback.get(player) !== state || state.mode !== 'direct' || player.paused) return;
      const media = player.querySelector?.('video');
      let forward = 0;
      if (media?.buffered) {
        for (let i = 0; i < media.buffered.length; i++) {
          if (media.buffered.start(i) <= media.currentTime && media.buffered.end(i) >= media.currentTime) {
            forward = media.buffered.end(i) - media.currentTime;
            break;
          }
        }
      }
      if (!media || media.readyState < 3 || forward < 1) {
        fallbackToHLS(player, state, 'buffer starvation');
      }
    }, DIRECT_STALL_MS);
  }

  function maybeDirectPlay(player, value) {
    const candidate = directSource(value, location.href);
    if (!candidate) return;
    const previous = directPlayback.get(player);
    if (previous?.key === candidate.key) return; // Never loop after fallback.
    if (previous) stopDirectTimer(previous);
    // An explicit H.264 compatibility preference requests the HLS encoder,
    // because the original codec isn't known from the media-player source.
    if (preferences.codec === 'h264') return;
    // Browser support is checked by the real media element, not MSE probing:
    // successful MediaSource HEVC support does not guarantee MP4 playback.
    const state = { ...candidate, mode: 'direct', stallTimer: null, monitorTimer: null, lastBuffer: null, lastSample: 0, riskCount: 0 };
    directPlayback.set(player, state);
    const time = playbackTime(player);
    const shouldPlay = !player.paused || !!player.autoPlay || !!player.autoplay;
    player.addEventListener('can-play', () => {
      if (directPlayback.get(player) !== state || state.mode !== 'direct') return;
      if (time > 0) player.currentTime = time;
      if (shouldPlay) player.play?.()?.catch?.(() => {});
      else player.pause?.();
    }, { once: true });
    console.info('[Memories RKMPP] Trying original file before HLS:', candidate.original);
    player.src = { src: candidate.original, type: 'video/mp4' };
    monitorDirectPlayback(player, state);
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
    module.exports = { shortEdge, initialLevel, qualityText, updateQualityText, manifestURL, directSource, initialLevelForThroughput, preventiveLevel, directBufferRisk, playbackPreferences, prefersHEVC, bufferSeconds };
    return;
  }
  if (!/\/apps\/memories(?:\/|$)/.test(location.pathname)) return;
  const marker = Symbol.for('memories-rkmpp-player');
  if (window[marker]) return;
  window[marker] = true;
  console.info('[Memories RKMPP] Player helper 0.3.4 active');

  const seen = new WeakSet();
  const players = new WeakSet();
  const providers = new WeakSet();
  const forceAVC = new WeakSet();
  const pendingRestore = new WeakMap();
  const pausedAutoplay = new WeakMap();
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

  function restoreAutoplay(player) {
    const saved = pausedAutoplay.get(player);
    if (!saved) return;
    pausedAutoplay.delete(player);
    for (const [name, value] of Object.entries(saved.properties)) player[name] = value;
  }

  function holdPausedAutoplay(player, url) {
    let saved = pausedAutoplay.get(player);
    if (!saved) {
      saved = { url, properties: {} };
      // Vidstack 1.15.6 combines these public props with OR for compatibility.
      for (const name of ['autoPlay', 'autoplay']) {
        if (name in player) saved.properties[name] = player[name];
      }
      pausedAutoplay.set(player, saved);
    }
    saved.url = url;
    for (const name of Object.keys(saved.properties)) player[name] = false;
  }

  function reloadOutput(player, hls, hevc, force = false) {
    const previous = pendingRestore.get(player);
    const current = previous?.url || hls.url;
    if (!current) return;
    const url = manifestURL(current, location.href, hevc);
    if (!force && url === current) return;
    // Reactive player time can lag a seek while its new fragments are loading.
    const media = player.querySelector?.('video');
    const time = previous?.time ?? (media?.readyState ? media.currentTime : player.currentTime);
    const restore = { url, time: Number.isFinite(time) && time >= 0 ? time : 0, paused: previous?.paused ?? player.paused };
    pendingRestore.set(player, restore);
    if (restore.paused) holdPausedAutoplay(player, url);
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
    const autoplay = pausedAutoplay.get(player);
    if ((!pending && !autoplay) || typeof source !== 'string' || !source) return;
    const url = new URL(source, location.href);
    if (mastersOnly && !url.pathname.endsWith('/index.m3u8')) return;
    const unrelated = (state) => {
      const previous = new URL(state.url, location.href);
      return url.origin !== previous.origin || url.pathname !== previous.pathname;
    };
    if (pending && unrelated(pending)) pendingRestore.delete(player);
    if (autoplay && unrelated(autoplay)) restoreAutoplay(player);
  }

  function applyPreferences(value) {
    const previous = preferences;
    preferences = playbackPreferences(value);
    // Honor a mid-playback explicit H.264 compatibility selection.
    for (const player of document.querySelectorAll('media-player')) {
      if (preferences.codec === 'h264') {
        const state = directPlayback.get(player);
        if (state?.mode === 'direct') fallbackToHLS(player, state, 'H.264 requested');
      }
    }
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
    if (directPlayback.get(player)?.mode === 'direct') { hls.stopLoad?.(); return; }
    seen.add(hls);
    discardUnrelatedRestore(player, hls.url);
    // Keep buffered audio intact. nextLevel can flush muxed audio as well as
    // video; loadLevel applies the new quality after the existing short buffer.
    if (player.qualities) player.qualities.switch = 'load';
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
      // Alternate audio stays buffered during a video-only nextLevel flush.
      // Muxed audio instead uses loadLevel so its decoder is not interrupted.
      if (player.qualities) player.qualities.switch = hls.audioTracks?.some((track) => track.url) ? 'next' : 'load';
      const resume = pendingRestore.get(player);
      if (hls.levels.length && (resume || !player.currentTime)) {
        const index = initialLevelForThroughput(hls.levels, hls.bandwidthEstimate);
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
    // Evaluate before buffer exhaustion, not after a fatal stall.
    // This only downshifts: let hls.js ABR decide when upgrades are safe.
    const preventStarvation = () => {
      if (active?.hls !== hls || !hls.autoLevelEnabled) return;
      const media = player.querySelector?.('video');
      let buffered = 0;
      if (media?.buffered && Number.isFinite(media.currentTime)) {
        for (let i = 0; i < media.buffered.length; i++) {
          if (media.buffered.start(i) <= media.currentTime &&
              media.buffered.end(i) >= media.currentTime) {
            buffered = media.buffered.end(i) - media.currentTime;
            break;
          }
        }
      }
      const index = hls.loadLevel >= 0 ? hls.loadLevel : hls.currentLevel;
      const safe = preventiveLevel(hls.levels, index, hls.bandwidthEstimate, buffered);
      if (safe >= 0 && safe !== index) {
        hls.nextAutoLevel = safe;
        console.info('[Memories RKMPP] Predictive HLS downshift', index, '->', safe);
      }
    };
    if (events.FRAG_LOADED) hls.on(events.FRAG_LOADED, preventStarvation);
    if (events.LEVEL_LOADED) hls.on(events.LEVEL_LOADED, preventStarvation);
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
        maybeDirectPlay(player, event.detail?.src ?? event.detail);
      });
      // Capture direct-media errors before Memories' HLS-first error handler:
      // it otherwise mistakes a failed original for a failed HLS stream.
      player.addEventListener('error', (event) => {
        const state = directPlayback.get(player);
        if (state?.mode !== 'direct') return;
        event.stopImmediatePropagation?.();
        fallbackToHLS(player, state, 'decoder or file error');
      }, true);
      player.addEventListener('waiting', () => scheduleDirectStall(player));
      player.addEventListener('stalled', () => scheduleDirectStall(player));
      player.addEventListener('playing', () => stopDirectTimer(directPlayback.get(player)));
      player.addEventListener('can-play', () => stopDirectTimer(directPlayback.get(player)));
      player.addEventListener('pause', () => stopDirectTimer(directPlayback.get(player)));
      // ready() decides autoplay after dispatching can-play and awaiting
      // storage. Keep it suppressed for an explicitly paused asset until an
      // intentional play or another asset, rather than restoring it too early.
      player.addEventListener('media-play-request', () => {
        const restore = pendingRestore.get(player);
        if (restore) restore.paused = false;
        restoreAutoplay(player);
      });
      player.addEventListener('play', (event) => {
        if (!event.autoPlay) restoreAutoplay(player);
      });
      player.addEventListener('provider-change', (event) => watchProvider(player, event.detail));
      player.addEventListener('hls-instance', (event) => configureHLS(player, event.detail));
    }
    // The source is normally assigned before Memories inserts the element.
    maybeDirectPlay(player, player.src);
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

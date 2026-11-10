(function () {
  'use strict';

  const {isOriginal, bitrate, transferBandwidth, canTryHigherLevel, safeEstimate} =
    typeof module !== 'undefined' && module.exports
      ? require('./policy.js') : window.MemoriesRkmppPolicy;

  function selectQuality(video, hls, id, state) {
    const option = id === 'auto' ? null : video.qualityList?.find(o => o.id === id);
    if (id !== 'auto' && !Number.isInteger(option?.index)) return;
    const level = id === 'auto' ? -1 : option.index;
    const returning = id === 'auto' && !!state && state.selected !== 'auto';
    if (state) {
      if (state.selected !== id) state.networkSamples = [];
      state.selected = id;
    }
    // Never pin Auto to a ladder index; -1 restores the native ABR.
    hls.loadLevel = level;
    if (returning) void refreshBandwidth(state, true);
    video._qualitySelected = id;
    video.dispatchEvent(new CustomEvent('quality-selected'));
  }

  function renditionText(video, hls, selected = 'auto') {
    if (!video.videoWidth || !video.videoHeight) return 'Loading video…';
    const level = hls?.levels?.[hls.currentLevel];
    const codec = level?.videoCodec || level?.attrs?.CODECS || '';
    const name = /hvc1|hev1/i.test(codec) ? 'HEVC' : /avc1/i.test(codec) ? 'H.264' : '';
    const mode = isOriginal(level) ? 'Original' : selected === 'auto' ? 'Auto' : 'Playing';
    return `${mode} · ${Math.min(video.videoWidth, video.videoHeight)}p (${video.videoWidth}×${video.videoHeight})${name ? ' · ' + name : ''}`;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {selectQuality, renditionText, configure, update, refreshBandwidth, speedProbe, negotiateMain10};
  }
  const debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('rkmpp_debug');
  if (typeof document === 'undefined') return;

  const attached = new Map();
  function bufferAhead(video) {
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime + 0.1 && video.buffered.end(i) > video.currentTime) {
        return video.buffered.end(i) - video.currentTime;
      }
    }
    return 0;
  }

  function trace(state, type, data = {}) {
    if (!state.debug) return;
    const frag = data.frag, stats = data.stats || frag?.stats;
    const t = stats?.loading;
    const rows = state.trace || (state.trace = []);
    rows.push({type, time:Number(state.video.currentTime.toFixed(3)),
      track:frag?.type, level:frag?.level ?? data.level, sn:frag?.sn,
      buffer:Number(bufferAhead(state.video).toFixed(2)),
      bandwidth:Math.round(state.hls.bandwidthEstimate || 0),
      ttfb:Math.round(state.hls.ttfbEstimate || 0),
      wait:t?.first > t?.start ? Math.round(t.first-t.start) : undefined,
      transfer:t?.end > t?.first ? Math.round(t.end-t.first) : undefined,
      bytes:stats?.loaded, error:data.details});
    if (rows.length > 60) rows.shift();
    state.badge.dataset.trace = JSON.stringify(rows);
  }

  function negotiateMain10(hls) {
    try {
      if (!window.MediaSource?.isTypeSupported('video/mp4; codecs="hvc1.2.4.L153.B0"')) return false;
      const url = new URL(hls.url, window.location.href);
      if (url.origin !== window.location.origin || !/\/index\.m3u8$/.test(url.pathname)) return false;
      const codecs = (url.searchParams.get('codecs') || '').split(',').filter(Boolean);
      if (!codecs.includes('hevc') || codecs.includes('hevc10')) return false;
      codecs.push('hevc10');
      url.searchParams.set('codecs', codecs.join(','));
      hls.loadSource(url.href);
      return true;
    } catch { return false; }
  }

  function releaseOriginalCap(state) {
    if (state.originalCap === undefined) return;
    const hls = state.hls;
    const index = hls.levels.findIndex(isOriginal);
    if (hls.autoLevelCapping === index-1) hls.autoLevelCapping = state.originalCap;
    state.originalCap = undefined;
  }

  // Memories 11's public quality options expose size/bitrate, but no label.
  // Keep its native radio actions and selection handlers; only name the
  // direct rendition accurately inside this video's own controls.
  function labelOriginal(video, state) {
    const options = video.qualityList || [];
    const direct = options.find(o=>isOriginal(state.hls?.levels?.[o.index]));
    const controls = video.closest('.video-container')?.querySelector('.m-vc-controls');
    if (!direct || !controls) return;
    const rate = direct.bitrate >= 1000000 ? `${(direct.bitrate/1000000).toFixed(1)} Mbps`
      : `${Math.round(direct.bitrate/1000)} kbps`;
    const plain = `${direct.size}p`;
    for (const button of controls.querySelectorAll('[role="menuitemradio"]')) {
      const name = button.querySelector('.action-button__name');
      if (name?.textContent === `${plain} · ${rate}`) name.textContent = `Original · ${plain} · ${rate}`;
    }
    if (state.selected === direct.id) {
      const name = controls.querySelector('.tune-icon')?.closest('button')?.querySelector('.action-button__name');
      if (name?.textContent.endsWith(` · ${plain}`))
        name.textContent = name.textContent.slice(0,-plain.length)+'Original';
    }
  }

  async function speedProbe(signal, sizes = [65536, 393216, 1572864]) {
    // Same TLS connection/path as playback. Random data cannot be compressed
    // or cached into an unrealistically fast result. Bound startup and traffic.
    if (signal.aborted) return 0;
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    signal.addEventListener('abort', onAbort, {once: true});
    const timer = setTimeout(() => abort.abort(), 2200);
    let estimate = 0;
    try {
      for (const size of sizes) {
        const path = window.OC?.generateUrl('/apps/memories_rkmpp_v11/probe') || '/index.php/apps/memories_rkmpp_v11/probe';
        const response = await fetch(`${path}?bytes=${size}&t=${Date.now()}`, {cache:'no-store', signal:abort.signal});
        if (!response.ok || !response.headers.get('content-type')?.includes('application/octet-stream')) break;
        const reader = response.body.getReader();
        const start = performance.now();
        let bytes = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
          }
        } finally {
          reader.releaseLock();
        }
        // A truncated or aborted response is not a valid bandwidth sample:
        // partial bytes over a short interval can wildly overstate capacity.
        if (bytes !== size || abort.signal.aborted) break;
        estimate = bytes * 8000 / Math.max(25, performance.now() - start);
        // The small request warms the connection. TCP slow start, mobile
        // latency and browser scheduling can make it severely pessimistic.
        // Continue the bounded larger sample; the overall timer limits cost
        // even on a genuinely slow link.
      }
    } catch { /* Network failures or timeouts retain the last complete sample. */ }
    finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
    return estimate;
  }

  // Detect new connections when possible; poll periodically only while Auto
  // is below the top rendition. Measurement never pins a quality.
  async function refreshBandwidth(state, force = false) {
    const session = state.abort, hls = state.hls;
    if (!session || session.signal.aborted || !hls || state.checking ||
        state.selected !== 'auto' || !hls.autoLevelEnabled ||
        state.reprobing || !hls.levels?.length) return;
    if (!force && Date.now() - (state.lastProbeAt || 0) < 20000) return;
    state.reprobing = true;
    state.lastProbeAt = Date.now();
    try {
      const measured = await speedProbe(session.signal, [131072, 393216]);
      if (!measured || session.signal.aborted || state.abort !== session ||
          state.hls !== hls || state.selected !== 'auto' || !hls.autoLevelEnabled) return;
      const estimate = safeEstimate(measured);
      state.bps = measured;
      state.badge.dataset.recoveryBandwidth = String(Math.round(measured));
      state.badge.dataset.recoveryProbeAt = String(Date.now());
      // Public hls.js API resets its EWMA, leaving native ABR to choose.
      hls.bandwidthEstimate = estimate;
      if (!state.video?.paused && !state.video?.seeking &&
          canTryHigherLevel(hls.levels, hls.currentLevel, estimate, 1.35)) {
        // Expedited, non-playhead-flushing transition: current playback
        // continues while hls.js reselects future fragments in Auto.
        hls.nextLevel = -1;
      }
    } catch { /* Offline/aborted: preserve last working bandwidth estimate. */ }
    finally { if (state.abort === session) state.reprobing = false; }
  }

  async function warmOriginal(state, force = false, maxWaitMs = 1200) {
    const hls = state.hls;
    const session = state.abort;
    const level = hls.levels.find(isOriginal);
    if (!level || session.signal.aborted || state.originalReady || state.warming ||
        (!force && Date.now() - state.lastWarm < 5000)) return;
    state.warming = true;
    state.lastWarm = Date.now();
    // A session abort alone is not a timeout; bound every playlist preflight.
    const request = new AbortController();
    const onAbort = () => request.abort();
    session.signal.addEventListener('abort', onAbort, {once:true});
    const timeout = setTimeout(() => request.abort(), Math.max(1, maxWaitMs));
    try {
      const url = Array.isArray(level.url) ? level.url[0] : level.url;
      const response = await fetch(url, {cache:'no-store', signal:request.signal});
      // Playlist availability does not establish hardware decoder support.
      if (state.abort === session && state.hls === hls && !session.signal.aborted && !request.signal.aborted) {
        state.originalReady = response.ok;
        if (state.originalReady) releaseOriginalCap(state);
      }
      if (response.body) void response.body.cancel().catch(() => {});
    } catch { /* A slow/aborted playlist must not delay startup indefinitely. */ }
    finally {
      clearTimeout(timeout);
      session.signal.removeEventListener('abort', onAbort);
      if (state.abort === session) state.warming = false;
    }
  }

  function configure(video, state, hls) {
    state.abort?.abort();
    clearTimeout(state.retryTimer);
    for (const [ev, fn] of state.events || []) state.hls?.off(ev, fn);
    state.hls = hls;
    state.video = video;
    state.abort = new AbortController();
    const session = state.abort;
    state.selected = 'auto';
    state.audioProfile = 'audio';
    state.checking = true;
    state.warming = false;
    state.reprobing = false;
    state.originalReady = false;
    state.originalCap = undefined;
    state.lastWarm = 0;
    state.lastProbeAt = Date.now();
    state.networkSamples = [];
    state.events = [];
    state.trace = [];
    state.failure = '';
    state.retries = 0;
    state.badge.dataset.hlsVersion = hls.constructor.version || '';
    const Events = hls.constructor.Events;
    const listen = (event, fn) => {
      if (event) { hls.on(event, fn); state.events.push([event, fn]); }
    };
    if (Object.getOwnPropertyDescriptor(video, 'currentQuality')?.configurable) {
      Object.defineProperty(video, 'currentQuality', {
        configurable: true, get: () => state.selected,
        set: id => selectQuality(video, hls, id, state),
      });
    }
    Object.assign(hls.config, {
      autoStartLoad:false, startFragPrefetch:false,
      // The same-origin probe already measures the connection. The built-in
      // bitrate test otherwise starts an unnecessary lowest-rendition worker
      // and contaminates startup with cold-transcoder timing.
      testBandwidth:false,
      maxBufferLength:18, maxMaxBufferLength:18,
      maxBufferSize:96*1024*1024, backBufferLength:8,
      capLevelOnFPSDrop:true, fpsDroppedMonitoringThreshold:0.2,
      // Permit production startup delays without disabling hls.js recovery.
      maxStarvationDelay:6, maxLoadingDelay:6,
    });
    if (hls.levels.length) hls.stopLoad();
    state.badge.dataset.phase = 'waiting-manifest';
    let starting = false;
    const probe = speedProbe(session.signal);
    const active = () => !session.signal.aborted && state.abort === session && state.hls === hls;
    const start = async () => {
      if (starting || !active() || !hls.levels.length) return;
      starting = true;
      state.badge.dataset.phase = 'probing';
      state.badge.dataset.levels = hls.levels.map(l =>
        String(l.width) + 'x' + String(l.height) + ':' + String(l.bitrate) +
        (isOriginal(l) ? ':original' : ':encoded')).join(',');
      const originalIndex = hls.levels.findIndex(isOriginal);
      if (originalIndex > 0 && !state.originalReady) {
        state.originalCap = hls.autoLevelCapping ?? -1;
        hls.autoLevelCapping = Math.min(originalIndex-1,
          state.originalCap < 0 ? originalIndex-1 : state.originalCap);
      }
      void warmOriginal(state);
      const raw = await probe;
      if (!active()) return;
      state.bps = raw || 750000;
      state.lastProbeAt = Date.now();
      state.badge.dataset.initialBandwidth = String(Math.round(state.bps));
      const direct = hls.levels.find(isOriginal);
      if (direct && bitrate(direct) <= state.bps * 0.8) {
        // Backend may return 409 for direct.m3u8 until its copy-grid exists.
        const deadline = Date.now() + 1200;
        while (!state.originalReady && active() && Date.now() < deadline) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          await warmOriginal(state, true, Math.min(900, remaining));
          if (!state.originalReady && active())
            await new Promise(resolve => setTimeout(resolve,
              Math.min(100, Math.max(1, deadline - Date.now()))));
        }
      }
      if (!active()) return;
      // Native Auto must remain enabled throughout the entire session.
      hls.startLevel = -1;
      hls.loadLevel = -1;
      hls.bandwidthEstimate = safeEstimate(state.bps);
      state.checking = false;
      state.badge.dataset.phase = 'native-auto';
      hls.startLoad();
    };
    listen(Events.MANIFEST_PARSED, start);
    listen(Events.FRAG_LOADING, (_e, data) => trace(state, 'loading', data));
    listen(Events.LEVEL_SWITCHING, (_e, data) => trace(state, 'switching', data));
    listen(Events.FRAG_LOAD_EMERGENCY_ABORTED, (_e, data) => trace(state, 'emergency', data));
    listen(Events.FRAG_LOADED, (_e, data) => {
      trace(state, 'loaded', data);
      if (data.frag?.type === 'main') state.badge.dataset.lastVideoFragmentAt = String(Date.now());
    });
    listen(Events.LEVEL_SWITCHED, () => {
      if (video._qualitySelected !== state.selected) {
        video._qualitySelected = state.selected;
        video.dispatchEvent(new CustomEvent('quality-selected'));
      }
    });
    listen(Events.FRAG_BUFFERED, (_e, data) => {
      if (data.frag?.type !== 'main') return;
      trace(state, 'buffered', data);
      state.failure = '';
      state.retries = 0;
      clearTimeout(state.retryTimer);
      const stats = data.stats || data.frag.stats;
      const sample = transferBandwidth(stats);
      const loading = stats?.loading;
      const producerWait = loading?.first > loading?.start
        ? loading.first - loading.start : 0;
      if (sample > 0) {
        state.badge.dataset.transferMbps = (sample / 1000000).toFixed(2);
        state.networkSamples.push(sample);
        if (state.networkSamples.length > 4) state.networkSamples.shift();
      }
      // hls.js charges server-side transcoding time against bandwidth.
      // Correct only when two measured transfers agree that network is
      // genuinely faster. Native hls.js still chooses the actual level.
      if (state.selected === 'auto' && hls.autoLevelEnabled &&
          producerWait >= 900 && state.networkSamples.length >= 2 &&
          bufferAhead(video) >= 3) {
        const conservative = safeEstimate(Math.min(...state.networkSamples.slice(-2)));
        const current = hls.bandwidthEstimate;
        if (conservative && (!Number.isFinite(current) || current < conservative * 0.65))
          hls.bandwidthEstimate = conservative;
      }
    });
    listen(Events.ERROR, (_e, data) => {
      trace(state, 'error', data);
      state.badge.dataset.lastError = data.details || '';
      if (!data.fatal) return;
      state.badge.dataset.fatalError = String(data.type || '') + ':' + String(data.details || '');
      if (data.type === 'networkError' && state.retries < 4 && active()) {
        state.failure = 'Reconnecting…';
        clearTimeout(state.retryTimer);
        const delay = Math.min(8000, 1000 * 2 ** state.retries++);
        state.retryTimer = setTimeout(() => {
          if (active()) hls.startLoad(video.currentTime, true);
        }, delay);
      } else state.failure = 'Playback error';
    });
    if (!negotiateMain10(hls) && hls.levels.length) void start();
  }

  function attach(video) {
    if (attached.has(video) || !(video instanceof HTMLVideoElement)) return;
    const parent = video.closest('.memories-video-stage');
    if (!parent) return;
    const badge = document.createElement('div');
    badge.className = 'mr-v11-status';
    badge.setAttribute('role', 'status');
    parent.appendChild(badge);
    const state = {badge, debug, hls:null, bps:0};
    const diagnostics = new AbortController();
    const metric = (name, fn) => video.addEventListener(name, fn, {signal:diagnostics.signal});
    metric('playing', () => {
      // hls.js owns quality decisions.
      state.hasPlayed = true;
      if (state.waitingAt) state.waitingMs = (state.waitingMs || 0) + Date.now() - state.waitingAt;
      state.waitingAt = 0;
    });
    metric('waiting', () => {
      if (!state.hasPlayed || video.seeking || video.paused || state.waitingAt) return;
      // hls.js owns starvation recovery.
      state.waitingAt = Date.now();
      state.waitingCount = (state.waitingCount || 0) + 1;
    });
    metric('seeking', () => {
      state.waitingAt = 0;
      state.seekAt = Date.now();
      // Seeking does not replace the existing hls.js Auto session.
    });
    metric('seeked', () => { badge.dataset.seekMs = String(Date.now() - state.seekAt); });
    attached.set(video, state);
    // Network Information API is optional (notably absent on some iPhones).
    // Visibility/online hints and a 20s low-rendition fallback cover clients
    // that do not report a cellular-to-Wi-Fi connection change.
    const connection = typeof navigator !== 'undefined'
      ? (navigator.connection || navigator.mozConnection || navigator.webkitConnection) : null;
    const changedNetwork = () => {
      if (!video.paused && !video.ended) void refreshBandwidth(state, true);
    };
    const visibleAgain = () => { if (!document.hidden) changedNetwork(); };
    connection?.addEventListener?.('change', changedNetwork);
    window.addEventListener('online', changedNetwork);
    window.addEventListener('pageshow', changedNetwork);
    document.addEventListener('visibilitychange', visibleAgain);
    const refresh = () => update(video, state);
    for (const event of ['resize','loadedmetadata','quality-list']) video.addEventListener(event, refresh);
    state.detach = () => {
      connection?.removeEventListener?.('change', changedNetwork);
      window.removeEventListener('online', changedNetwork);
      window.removeEventListener('pageshow', changedNetwork);
      document.removeEventListener('visibilitychange', visibleAgain);
      diagnostics.abort();
      state.abort?.abort();
      clearTimeout(state.retryTimer);
      for (const [event, fn] of state.events || []) state.hls.off(event, fn);
      for (const event of ['resize','loadedmetadata','quality-list']) video.removeEventListener(event, refresh);
      badge.remove();
    };
    update(video, state);
  }

  function update(video, state) {
    const controls = video.closest('.video-container')?.querySelector('.m-vc-controls');
    if (controls && state.badge.parentElement !== controls) controls.prepend(state.badge);
    const hls = video._qualityHls;
    if (hls && state.hls !== hls) configure(video, state, hls);
    labelOriginal(video, state);
    const buffer = bufferAhead(video);
    const now = Date.now();
    if (hls && !state.checking && state.selected === 'auto' &&
        hls.autoLevelEnabled && !video.paused && !video.ended &&
        !video.seeking && buffer >= 3 && hls.currentLevel >= 0 &&
        hls.currentLevel < hls.levels.length - 1)
      void refreshBandwidth(state);
    if (hls && !state.checking && state.selected === 'auto') void warmOriginal(state);
    const message = state.failure || (state.checking
      ? 'Checking connection…' : renditionText(video, hls, state.selected));
    if (state.badge.textContent !== message) state.badge.textContent = message;
    Object.assign(state.badge.dataset, {
      bandwidth:String(Math.round(state.bps)), buffer:buffer.toFixed(2),
      hlsAuto:String(Boolean(hls?.autoLevelEnabled)),
      hlsManualLevel:String(hls?.manualLevel ?? ''),
      hlsBandwidth:String(Math.round(hls?.bandwidthEstimate || 0)),
      audio:state.audioProfile || '',
      originalReady:String(Boolean(state.originalReady)),
      requestedQuality:state.selected || '',
      seekPendingMs:String(video.seeking && state.seekAt ? now-state.seekAt : 0),
      waitingCount:String(state.waitingCount || 0),
      waitingMs:String((state.waitingMs || 0) + (state.waitingAt ? now-state.waitingAt : 0)),
    });
    if (typeof video.getVideoPlaybackQuality === 'function') {
      const q = video.getVideoPlaybackQuality();
      state.badge.dataset.droppedFrames = String(q.droppedVideoFrames);
      state.badge.dataset.totalFrames = String(q.totalVideoFrames);
    }
    if (hls && debug) {
      const info = c => ({state:c?.state,sn:c?.fragCurrent?.sn,
        next:c?.nextLoadPosition,loaded:c?.fragCurrent?.stats?.loaded});
      state.badge.dataset.pipeline = JSON.stringify({
        loading:hls.loadingEnabled,buffering:hls.bufferingEnabled,
        auto:hls.autoLevelEnabled,manual:hls.manualLevel,
        current:hls.currentLevel,next:hls.nextLoadLevel,
        main:info(hls.streamController),audio:info(hls.audioStreamController),
      });
    }
  }

  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches('video')) attach(node);
      node.querySelectorAll('video').forEach(attach);
    }
    for (const [video, state] of attached) labelOriginal(video, state);
  }).observe(document.documentElement, {childList:true, subtree:true});
  document.querySelectorAll('video').forEach(attach);
  setInterval(() => {
    for (const [video, state] of attached) {
      if (!video.isConnected) { state.detach(); attached.delete(video); }
      else update(video, state);
    }
  }, 500);
})();

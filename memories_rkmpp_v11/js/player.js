(function () {
  'use strict';

  const isOriginal = level => (Array.isArray(level?.url) ? level.url : [level?.url]).some(u => /\/direct\.m3u8(?:\?|$)/.test(u || ''));

  const {PlaybackPolicy, chooseLevel} = typeof module !== 'undefined' && module.exports
    ? require('./policy.js') : window.MemoriesRkmppPolicy;

  function selectQuality(video, hls, id, state) {
    const option = id === 'auto' ? null : video.qualityList?.find(o => o.id === id);
    if (id !== 'auto' && !Number.isInteger(option?.index)) return;
    const level = id === 'auto' ? -1 : option.index;
    if (state) {
      if (id === 'auto' && state.selected !== 'auto' && state.policy) {
        state.policy.resumeAuto(state.manualLevel);
        state.cap = state.policy.cap;
      }
      state.selected = id;
      state.manualLevel = id === 'auto' ? null : level;
    }
    // Preserve already-playable pictures and the shared audio track.
    hls.loadLevel = level < 0 && state?.policy ? state.policy.cap : level;
    if (state) {
      state.switchAt = level < 0 || hls.currentLevel === level ? 0 : Date.now();
      state.switchLevel = level;
      delete state.badge.dataset.switchMs;
    }
    // The native Memories quality hook also listens for HLS level changes.
    // Keep its displayed selection consistent with our one Auto controller.
    video._qualitySelected = id;
    video.dispatchEvent(new CustomEvent('quality-selected'));
  }

  function beginSeek(state) {
    if (state.selected !== 'auto' || !(state.hls?.currentLevel >= 0)) return;
    state.policy?.beginSeek();
    state.inflight = null;
    // Buffered Original pictures can outlive a bandwidth downshift.
    // A new seek must respect the already-known network/decoder cap.
    state.seekLevel = Math.min(state.hls.currentLevel, state.cap ?? state.hls.currentLevel);
    state.hls.loadLevel = state.seekLevel;
  }

  function requestAge(video, state, now, clock = performance.now()) {
    const start = state.inflight?.stats?.loading?.start;
    const loading = start > 0 ? clock - start : 0;
    // Bound a stuck seek even when hls.js has no request. Once pictures
    // resume, only an actual outstanding request can signal congestion.
    const stalledSeek = state.policy?.phase === 'seeking' && (video.seeking || video.readyState < 3);
    return Math.max(loading, stalledSeek ? now - state.seekAt : 0);
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
    module.exports = {chooseLevel, selectQuality, beginSeek, requestAge, renditionText, configure, update};
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

  async function speedProbe(signal) {
    // Same TLS connection/path as playback. Random data cannot be compressed
    // or cached into an unrealistically fast result. Bound startup and traffic.
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    signal.addEventListener('abort', onAbort, {once: true});
    const timer = setTimeout(() => abort.abort(), 2200);
    let estimate = 0;
    try {
      for (const size of [65536, 393216, 1572864]) {
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
          if (bytes) estimate = bytes * 8000 / Math.max(25, performance.now() - start);
          reader.releaseLock();
        }
        // The small request warms the connection. TCP slow start, mobile
        // latency and browser scheduling can make it severely pessimistic.
        // Continue the bounded larger sample; the overall timer limits cost
        // even on a genuinely slow link.
      }
    } catch { /* Timeout uses partial bytes; unavailable probe starts low. */ }
    finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
    return estimate || 750000;
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
    for (const [event, fn] of state.events || []) state.hls.off(event, fn);
    state.hls = hls;
    state.abort = new AbortController();
    const session = state.abort;
    state.warming = false;
    state.selected = 'auto';
    state.manualLevel = null;
    state.decoderCapUntil = 0;
    state.seekLevel = null;
    state.audioProfile = 'audio'; // One default shared AAC track for the whole session.
    state.inflight = null;
    state.decoderCap = Infinity;
    state.policy = null;
    state.checking = true;
    state.originalReady = false;
    state.lastWarm = 0;
    state.events = [];
    state.failure = '';
    state.retries = 0;
    state.badge.dataset.hlsVersion = hls.constructor.version || '';
    const Events = hls.constructor.Events;
    const listen = (event, fn) => {
      if (!event) return;
      hls.on(event, fn);
      state.events.push([event, fn]);
    };
    if (Object.getOwnPropertyDescriptor(video, 'currentQuality')?.configurable) {
      Object.defineProperty(video, 'currentQuality', {
        configurable:true, get:() => state.selected,
        set:id => { state.seekLevel = null; selectQuality(video, hls, id, state); },
      });
    }
    Object.assign(hls.config, {
      autoStartLoad:false, startFragPrefetch:false,
      // Keep a practical mobile reserve while capping high-bitrate memory use.
      maxBufferLength:18, maxBufferSize:96*1024*1024, maxMaxBufferLength:18, backBufferLength:8,
      capLevelOnFPSDrop:true, fpsDroppedMonitoringThreshold:0.2,
    });
    // stopLoad also aborts an in-flight manifest in hls.js 1.7. Wait for
    // its normal parse event; autoStartLoad=false already holds fragments.
    if (hls.levels.length) hls.stopLoad();
    state.badge.dataset.phase = 'waiting-manifest';
    let starting = false;
    const measured = speedProbe(session.signal);
    const active = () => !session.signal.aborted && state.abort === session && state.hls === hls;
    const start = async () => {
      if (starting || !active() || !hls.levels.length) return;
      starting = true;
      state.badge.dataset.levels = hls.levels.map(l => `${l.width}x${l.height}:${l.bitrate}:${isOriginal(l) ? 'original' : 'encoded'}`).join(',');
      state.badge.dataset.phase = 'probing';
      void warmOriginal(state);
      const bps = await measured;
      if (!active()) return;
      state.bps = bps;
      state.badge.dataset.initialBandwidth = String(Math.round(state.bps));
      // Give an affordable Original a bounded chance to finish its copy-grid
      // preflight, rather than racing that request and starting an encoder.
      if (isOriginal(hls.levels[chooseLevel(hls.levels, state.bps)])) {
        const deadline = Date.now() + 1500;
        while (!state.originalReady && Date.now() < deadline && active()) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          await warmOriginal(state, true, Math.min(1200, remaining));
          if (!state.originalReady && active())
            await new Promise(resolve => setTimeout(resolve, Math.min(150, Math.max(1, deadline - Date.now()))));
        }
      }
      if (!active()) return;
      state.policy = new PlaybackPolicy(hls.levels, state.bps, state.originalReady);
      state.cap = state.policy.cap;
      // One quality controller. hls.js schedules fragments and buffers, while
      // buffer health chooses renditions without encoder-rate contamination.
      hls.startLevel = state.cap;
      hls.loadLevel = state.cap;
      state.checking = false;
      state.badge.dataset.phase = 'loading';
      hls.startLoad();
    };
    listen(Events.MANIFEST_PARSED, start);
    listen(Events.FRAG_LOADED, (_event, data) => {
      if (data.frag?.type !== 'main') return;
      if (state.inflight === data.frag) state.inflight = null;
      state.badge.dataset.lastVideoFragmentAt = String(Date.now());
    });
    listen(Events.FRAG_LOADING, (_event, data) => {
      if (data.frag?.type === 'main') state.inflight = data.frag;
    });
    listen(Events.LEVEL_SWITCHED, (_event, data) => {
      // Memories' built-in hook treats manually pinned hls.loadLevel as
      // "manual", even when the UI user has selected our adaptive Auto.
      if (video._qualitySelected !== state.selected) {
        video._qualitySelected = state.selected;
        video.dispatchEvent(new CustomEvent('quality-selected'));
      }
      if (data.level === state.switchLevel && state.switchAt) {
        state.badge.dataset.switchMs = String(Date.now() - state.switchAt);
        state.switchAt = 0;
      }
    });
    listen(Events.FRAG_BUFFERED, (_event, data) => {
      if (data.frag?.type !== 'main') return;
      if (state.policy && state.selected === 'auto' &&
          !video.paused && !video.seeking) {
        const stats = data.stats || data.frag.stats;
        const loading = stats?.loading;
        const elapsedMs = loading?.start > 0
          ? Math.max(1, performance.now() - loading.start) : 0;
        // Only first-byte -> final-byte represents network transfer.
        // Request start -> first byte can include RKMPP's paced encoding.
        const transferMs = loading?.first > 0 && loading?.end > loading.first
          ? loading.end - loading.first : 0;
        const bytes = stats?.loaded || 0;
        const duration = data.frag.duration || data.frag.end - data.frag.start;
        state.policy.onFragment({
          level:data.frag.level, sn:data.frag.sn, duration, elapsedMs, transferMs, bytes,
          buffer:bufferAhead(video),
        });
        if (elapsedMs > 0 && duration > 0) {
          state.badge.dataset.deliveryRate = (duration * 1000 / elapsedMs).toFixed(2);
          state.badge.dataset.transferMbps = transferMs > 0
            ? (bytes * 8 / (transferMs * 1000)).toFixed(2) : '';
        }
      }
      if (state.debug) {
        state.fragmentTrace ||= [];
        const f = data.frag;
        state.fragmentTrace.push({time:video.currentTime,level:f.level,sn:f.sn,
          start:f.start,end:f.end,pts:f.startPTS,endPTS:f.endPTS});
        state.fragmentTrace = state.fragmentTrace.slice(-10);
        state.badge.dataset.fragmentTrace = JSON.stringify(state.fragmentTrace);
      }
      state.failure = '';
      state.retries = 0;
      clearTimeout(state.retryTimer);
    });
    listen(Events.FPS_DROP_LEVEL_CAPPING, (_event, data) => {
      // Retry higher qualities after a stable interval; fresh FPS drops
      // refresh the temporary cap rather than stranding Auto forever.
      state.decoderCap = data.level >= 0 ? data.level : Infinity;
      state.decoderCapUntil = data.level >= 0 ? Date.now() + 45000 : 0;
    });
    listen(Events.ERROR, (_event, data) => {
      if (data.frag && state.inflight === data.frag) state.inflight = null;
      state.badge.dataset.lastError = data.details || '';
      if (!data.fatal) return;
      state.badge.dataset.fatalError = `${data.type || ''}:${data.details || ''}:${data.response?.code || ''}`;
      if (data.type === 'networkError' && state.retries < 4 && !state.abort.signal.aborted) {
        state.failure = 'Reconnecting…';
        clearTimeout(state.retryTimer);
        state.retryTimer = setTimeout(() => {
          if (state.abort.signal.aborted) return;
          // Resume from the existing clock and MSE buffers. Changing sources
          // or reattaching the media here would interrupt the shared audio.
          hls.startLoad(video.currentTime, true);
        }, Math.min(8000, 1000 * 2 ** state.retries++));
      } else state.failure = 'Playback error';
    });
    if (hls.levels.length) void start();
  }

  function attach(video) {
    if (attached.has(video) || !(video instanceof HTMLVideoElement)) return;
    const parent = video.closest('.memories-video-stage');
    if (!parent) return;
    const badge = document.createElement('div');
    badge.className = 'mr-v11-status';
    badge.setAttribute('role', 'status');
    parent.appendChild(badge);
    const state = {badge, debug, hls:null, decoderCap:Infinity, bps:0};
    const diagnostics = new AbortController();
    const metric = (name, fn) => video.addEventListener(name, fn, {signal:diagnostics.signal});
    metric('playing', () => {
      state.policy?.onPlaying();
      state.hasPlayed = true;
      if (state.waitingAt) state.waitingMs = (state.waitingMs || 0) + Date.now() - state.waitingAt;
      state.waitingAt = 0;
    });
    metric('waiting', () => {
      if (!state.hasPlayed || video.seeking || video.paused || state.waitingAt) return;
      state.policy?.onWaiting();
      state.waitingAt = Date.now();
      state.waitingCount = (state.waitingCount || 0) + 1;
    });
    metric('seeking', () => {
      state.waitingAt = 0;
      state.seekAt = Date.now();
      beginSeek(state);
    });
    metric('seeked', () => { badge.dataset.seekMs = String(Date.now() - state.seekAt); });
    attached.set(video, state);
    const refresh = () => update(video, state);
    for (const event of ['resize','loadedmetadata','quality-list']) video.addEventListener(event, refresh);
    state.detach = () => {
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
    const buffer = bufferAhead(video);
    const now = Date.now();
    if (state.decoderCapUntil && now >= state.decoderCapUntil) {
      state.decoderCap = Infinity;
      state.decoderCapUntil = 0;
    }
    if (hls && state.policy && !state.checking) {
      const action = state.policy.step({
        now, buffer, playing:!video.paused && !video.ended, seeking:video.seeking,
        auto:state.selected === 'auto', originalReady:state.originalReady,
        decoderCap:state.decoderCap, requestAge:requestAge(video, state, now),
        currentLevel:hls.currentLevel,
      });
      const oldCap = state.cap;
      state.cap = action.cap;
      state.badge.dataset.phase = action.phase;
      state.badge.dataset.goodFragments = String(state.policy.goodFragments);
      state.badge.dataset.slowFragments = String(state.policy.slowFragments);
      if (state.selected === 'auto') {
        if (state.seekLevel != null && action.phase !== 'seeking') {
          state.seekLevel = null;
          hls.loadLevel = action.cap;
        } else if (action.change || action.cap !== oldCap) {
          // Switch conservatively without flushing the existing buffer.
          hls.loadLevel = action.cap;
        }
        void warmOriginal(state);
      }
    }
    const text = state.failure || (state.checking ? 'Checking connection…' : renditionText(video, hls, state.selected));
    if (state.badge.textContent !== text) state.badge.textContent = text;
    Object.assign(state.badge.dataset, {
      bandwidth: String(Math.round(state.bps)), buffer:buffer.toFixed(2),
      cap:String(state.cap ?? ''), audio:state.audioProfile || '',
      decoderCap:String(state.decoderCap), originalReady:String(Boolean(state.originalReady)),
      requestedQuality:state.selected || '',
      seekPendingMs:String(video.seeking && state.seekAt ? now-state.seekAt : 0),
      waitingCount:String(state.waitingCount || 0),
      waitingMs:String((state.waitingMs || 0) + (state.waitingAt ? now - state.waitingAt : 0)),
    });
    if (typeof video.getVideoPlaybackQuality === 'function') {
      const q = video.getVideoPlaybackQuality();
      state.badge.dataset.droppedFrames = String(q.droppedVideoFrames);
      state.badge.dataset.totalFrames = String(q.totalVideoFrames);
    }
    if (hls && debug) {
      const info = controller => ({state:controller?.state,sn:controller?.fragCurrent?.sn,
        next:controller?.nextLoadPosition,loaded:controller?.fragCurrent?.stats?.loaded,
        loadStart:controller?.fragCurrent?.stats?.loading?.start});
      state.badge.dataset.pipeline = JSON.stringify({loading:hls.loadingEnabled,buffering:hls.bufferingEnabled,
        auto:hls.autoLevelEnabled,manual:hls.manualLevel,current:hls.currentLevel,next:hls.nextLoadLevel,
        main:info(hls.streamController),audio:info(hls.audioStreamController)});
    }
  }

  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches('video')) attach(node);
      node.querySelectorAll('video').forEach(attach);
    }
  }).observe(document.documentElement, {childList:true, subtree:true});
  document.querySelectorAll('video').forEach(attach);
  setInterval(() => {
    for (const [video, state] of attached) {
      if (!video.isConnected) { state.detach(); attached.delete(video); }
      else update(video, state);
    }
  }, 500);
})();

(function () {
  'use strict';

  const isOriginal = level => (Array.isArray(level?.url) ? level.url : [level?.url]).some(u => /\/direct\.m3u8(?:\?|$)/.test(u || ''));

  const {PlaybackPolicy, chooseLevel} = typeof module !== 'undefined' && module.exports
    ? require('./policy.js') : window.MemoriesRkmppPolicy;

  function selectQuality(video, hls, id, state) {
    const option = id === 'auto' ? null : video.qualityList?.find(o => o.id === id);
    if (id !== 'auto' && !Number.isInteger(option?.index)) return;
    const level = id === 'auto' ? -1 : option.index;
    // Conservative quality selection: do not flush already-buffered video.
    hls.loadLevel = level < 0 && state?.policy ? state.policy.target : level;
    if (state) {
      state.pendingLevel = null;
      state.policy?.onWaiting();
      // A manual-to-Auto transition won't produce a new 'playing' event.
      if (id === 'auto' && state.policy && !video.paused) state.policy.onPlaying();
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
    state.pendingLevel = null;
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
  // Bounded local trace: only stall/fatal reports are sent to our Nextcloud.
  function eventTrace(state,event,fields={}) {
    state.trace ||= [];
    state.trace.push({at:Date.now(),event,...fields});
    if(state.trace.length>240)state.trace.shift();
    if(state.video)state.video._rkmppTrace=state.trace;
  }
  // Mobile users cannot copy a browser console from their laptop.
  // On a stall, POST a bounded and URL-free trace to this Nextcloud instance
  // after recovery (or after a prolonged wait), at most once per 30 seconds.
  async function reportMobileTrace(state, reason) {
    if (!state.abort || state.abort.signal.aborted || !state.trace?.length) return;
    const csrf = window.OC?.requestToken || window.oc_requesttoken;
    if (!csrf) {
      state.badge.dataset.traceSend = 'missing-csrf';
      return;
    }
    const path = window.OC?.generateUrl('/apps/memories_rkmpp_v11/trace') ||
      '/index.php/apps/memories_rkmpp_v11/trace';
    try {
      const response = await fetch(path, {
        method:'POST', credentials:'same-origin',
        headers:{'Content-Type':'application/json','Accept':'application/json',
          'requesttoken':csrf},
        body:JSON.stringify({reason,session:state.traceSession,
          events:state.trace.slice(-60)}),
        signal:state.abort.signal,
        cache:'no-store',
      });
      state.badge.dataset.traceSend = response.ok ? 'saved' : 'http-' + response.status;
    } catch {
      state.badge.dataset.traceSend = 'delivery-failed';
    }
  }
  function scheduleMobileTrace(state, reason, delay = 1200) {
    if (!state.abort || state.abort.signal.aborted ||
        Date.now() - (state.lastTraceReportAt || 0) < 30000) return;
    clearTimeout(state.traceTimer);
    state.traceTimer = setTimeout(() => {
      state.traceTimer = null;
      if (state.abort.signal.aborted) return;
      state.lastTraceReportAt = Date.now();
      void reportMobileTrace(state, reason);
    }, delay);
  }

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

  async function warmOriginal(state, force = false) {
    const hls = state.hls;
    const session = state.abort;
    const level = hls.levels.find(isOriginal);
    if (!level || session.signal.aborted || state.originalReady || state.warming ||
        (!force && Date.now() - state.lastWarm < 5000)) return;
    state.warming = true;
    state.lastWarm = Date.now();
    try {
      const url = Array.isArray(level.url) ? level.url[0] : level.url;
      const response = await fetch(url, {cache:'no-store', signal:session.signal});
      // An old playlist preflight must never mark a replacement session ready.
      if (state.abort === session && state.hls === hls && !session.signal.aborted) {
        state.originalReady = response.ok;
      }
      await response.body?.cancel();
    } catch { /* Retry later without blocking playback. */ }
    finally {
      if (state.abort === session) state.warming = false;
    }
  }

  function configure(video, state, hls) {
    state.abort?.abort();
    clearTimeout(state.retryTimer);
    clearTimeout(state.traceTimer);
    for (const [event, fn] of state.events || []) state.hls.off(event, fn);
    state.hls = hls;
    state.video = video;
    state.abort = new AbortController();
    const session = state.abort;
    state.warming = false;
    state.selected = 'auto';
    state.seekLevel = null;
    state.audioProfile = 'audio'; // One default shared AAC track for the whole session.
    state.inflight = null;
    state.pendingLevel = null;
    state.trace = [];
    state.traceSession = Math.random().toString(36).slice(2,10);
    state.lastTraceReportAt = 0;
    video._rkmppTrace = state.trace;
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
        set:id => { state.seekLevel = null; state.selected = id; selectQuality(video, hls, id, state); },
      });
    }
    Object.assign(hls.config, {
      autoStartLoad:false, startFragPrefetch:false,
      // Six seconds at startup and during playback; also bound high-bitrate bytes.
      maxBufferLength:20, maxBufferSize:96*1024*1024, maxMaxBufferLength:20, backBufferLength:8,
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
          await warmOriginal(state, true);
          if (!state.originalReady) await new Promise(resolve => setTimeout(resolve, 150));
        }
      }
      if (!active()) return;
      state.policy = new PlaybackPolicy(hls.levels, state.bps, state.originalReady);
      state.cap = state.policy.target;
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
      if (data.frag?.type === 'main') {
        state.inflight = data.frag;
        eventTrace(state,'fragment-loading',{level:data.frag.level,sn:data.frag.sn,buffer:bufferAhead(video)});
      }
    });
    listen(Events.LEVEL_SWITCHED, (_event, data) => {
      state.policy?.onLevelPlayed(data.level);
      eventTrace(state,'level-presented',{level:data.level,buffer:bufferAhead(video)});
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
      const f = data.frag;
      if (f?.type !== 'main') return;
      const stats = data.stats || f.stats;
      if (state.policy && state.selected === 'auto' && !video.seeking) {
        state.policy.onFragment({
          level:f.level, sn:f.sn, duration:f.duration || f.end - f.start,
          bytes:stats?.loaded || 0, loading:stats?.loading,
          buffer:bufferAhead(video), now:Date.now(),
        });
      }
      eventTrace(state,'fragment-buffered',{
        level:f.level,sn:f.sn,bytes:stats?.loaded||0,
        totalMs:stats?.loading?.end > stats?.loading?.start
          ? Math.round(stats.loading.end - stats.loading.start) : null,
        transferMs:stats?.loading?.end > stats?.loading?.first
          ? Math.round(stats.loading.end - stats.loading.first) : null,
        buffer:bufferAhead(video),
      });
      if (state.pendingLevel != null && state.selected === 'auto') {
        const level = state.pendingLevel;
        state.pendingLevel = null;
        hls.loadLevel = level;
        eventTrace(state,'quality-scheduled',{level});
      }
      state.failure = '';
      state.retries = 0;
      clearTimeout(state.retryTimer);
    });
    listen(Events.FPS_DROP_LEVEL_CAPPING, (_event, data) => { state.decoderCap = data.level >= 0 ? data.level : Infinity; });
    listen(Events.ERROR, (_event, data) => {
      if (data.frag && state.inflight === data.frag) state.inflight = null;
      state.badge.dataset.lastError = data.details || '';
      if (!data.fatal) return;
      state.badge.dataset.fatalError = `${data.type || ''}:${data.details || ''}:${data.response?.code || ''}`;
      eventTrace(state,'hls-error',{detail:String(data.details || '').slice(0,64)});
      scheduleMobileTrace(state,'fatal-error',1200);
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
      eventTrace(state,'playing',{buffer:bufferAhead(video)});
      if (state.waitingAt) scheduleMobileTrace(state,'stall-recovered',1200);
      if (state.waitingAt) state.waitingMs = (state.waitingMs || 0) + Date.now() - state.waitingAt;
      state.waitingAt = 0;
    });
    metric('waiting', () => {
      if (!state.hasPlayed || video.seeking || video.paused || state.waitingAt) return;
      state.policy?.onWaiting();
      state.waitingAt = Date.now();
      eventTrace(state,'waiting',{buffer:bufferAhead(video)});
      scheduleMobileTrace(state,'waiting',8000);
      state.waitingCount = (state.waitingCount || 0) + 1;
    });
    metric('seeking', () => {
      state.waitingAt = 0;
      state.seekAt = Date.now();
      beginSeek(state);
    });
    metric('seeked', () => { state.policy?.endSeek();badge.dataset.seekMs = String(Date.now() - state.seekAt); });
    attached.set(video, state);
    const refresh = () => update(video, state);
    for (const event of ['resize','loadedmetadata','quality-list']) video.addEventListener(event, refresh);
    state.detach = () => {
      diagnostics.abort();
      state.abort?.abort();
      clearTimeout(state.retryTimer);
      clearTimeout(state.traceTimer);
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
      state.badge.dataset.reason = action.reason || '';
      state.badge.dataset.goodFragments = String(state.policy.goodFragments);
      state.badge.dataset.slowFragments = String(state.policy.slowFragments);
      if (state.selected === 'auto') {
        if (state.seekLevel != null && action.phase !== 'seeking') {
          state.seekLevel = null;
          state.pendingLevel = null;
          hls.loadLevel = action.cap;
        } else if (action.change || action.cap !== oldCap) {
          eventTrace(state,'quality-decision',{
            target:action.cap,reason:action.reason,
            buffer,requestAge:requestAge(video,state,now),playing:hls.currentLevel,
          });
          if (state.inflight && buffer >= 3) {
            state.pendingLevel = action.cap;
          } else {
            state.pendingLevel = null;
            hls.loadLevel = action.cap;
          }
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
      pendingLevel:String(state.pendingLevel??''),
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

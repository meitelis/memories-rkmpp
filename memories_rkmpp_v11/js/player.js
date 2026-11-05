(function () {
  'use strict';

  const isOriginal = level => (Array.isArray(level?.url) ? level.url : [level?.url]).some(u => /\/direct\.m3u8(?:\?|$)/.test(u || ''));
  const bandwidth = level => level?.bitrate || Number(level?.attrs?.BANDWIDTH) || Infinity;

  const {PlaybackPolicy, chooseLevel, audioProfile} = typeof module !== 'undefined' && module.exports
    ? require('./policy.js') : window.MemoriesRkmppPolicy;

  function cancelPreparation(state) {
    const pending = state?.preparing;
    if (pending) {
      state.preparing = null;
      pending.abort.abort();
    }
    return pending;
  }

  async function prepareRendition(level, time, signal, oldCuts) {
    const playlist = Array.isArray(level.url) ? level.url[0] : level.url;
    const response = await fetch(playlist, {cache:'no-store', signal});
    if (!response.ok) throw Error('Rendition unavailable');
    const text = await response.text();
    const init = text.match(/^#EXT-X-MAP:URI="([^"]+)"/m)?.[1];
    const clock = typeof time === 'function' ? time : () => time;
    let start = 0, duration = 0;
    const fragments = [];
    // go-vod serves unencrypted VOD playlists with an explicit fMP4 init.
    // Original has an irregular keyframe grid, so do not guess segment IDs.
    for (const line of text.split(/\r?\n/).map(s => s.trim())) {
      if (line.startsWith('#EXTINF:')) duration = Number.parseFloat(line.slice(8));
      else if (line && !line.startsWith('#') && duration > 0) {
        fragments.push({start, end:start + duration, url:line});
        start += duration;
        duration = 0;
      }
    }
    if (!init) throw Error('No switch init');
    const ready = async path => {
      // Nextcloud does not cache m4s responses. HEAD waits for completed
      // server output without downloading the same fragment twice.
      const part = await fetch(new URL(path, playlist).href, {method:'HEAD', cache:'no-store', signal});
      if (!part.ok) throw Error('Rendition not ready');
    };
    // A fast handoff must be an old GOP end and a new IDR start. Never
    // truncate an irregular Original GOP to force a 3s encoded boundary.
    const cuts = new Set(oldCuts.map(t => t.toFixed(4)));
    // Allow the cold hardware producer to publish a complete fragment before
    // playback reaches its IDR; a 1.5 s lead was too short for real 4K input.
    const upcoming = fragments.filter(f => f.start >= clock() + 3 && cuts.has(f.start.toFixed(4))).slice(0, 2);
    for (const fragment of upcoming) {
      // Publishing a complete fragment also guarantees its init is ready.
      // Warming init first can start an unnecessary encode at zero, racing
      // the request that starts the producer at the actual switch position.
      await ready(fragment.url);
      if (fragment.start >= clock() + 1) return fragment.start;
    }
    throw Error('Switch boundary passed');
  }

  function commitPreparedSwitch(video, hls, level, start, signal, ownerSignal) {
    const {Events} = hls.constructor;
    // Both GOP grids meet here; retain the playing clock and shared audio.
    hls.loadLevel = level;
    if (start >= video.currentTime + bufferAhead(video) - 0.5) return;
    return new Promise((resolve, reject) => {
      const clear = () => {
        hls.off(Events.BUFFER_FLUSHED, resume);
        hls.off(Events.FRAG_BUFFERED, buffered);
        signal.removeEventListener('abort', cancel);
      };
      const resume = (_event, data) => {
        if (data.type !== 'video') return;
        clear();
        hls.resumeBuffering();
        resolve();
      };
      const cancel = () => {
        clear();
        if (hls.media === video && !ownerSignal?.aborted) hls.resumeBuffering();
        reject(Error('Switch canceled'));
      };
      const flush = () => {
        hls.off(Events.FRAG_BUFFERED, buffered);
        if (start < video.currentTime + 0.5) { cancel(); return; }
        // Retain the boundary sample until the new IDR replaces it. A cut
        // exactly at start can round the buffered end just below start;
        // first-load lookup then selects the preceding GOP with zero tolerance.
        hls.trigger(Events.BUFFER_FLUSHING, {startOffset:start + 0.001, endOffset:Infinity, type:'video'});
      };
      const buffered = (_event, data) => { if (data.frag?.type === 'main') flush(); };
      // Preserve fragPrevious: stopLoad/startLoad clears it and can make
      // hls.js backtrack into an old GOP, overwriting already-playing video.
      // Let any active request finish before removing its future pictures.
      hls.pauseBuffering();
      hls.on(Events.BUFFER_FLUSHED, resume);
      signal.addEventListener('abort', cancel, {once:true});
      const active = hls.inFlightFragments?.main?.frag;
      if (active && !active.stats?.buffering?.end) hls.on(Events.FRAG_BUFFERED, buffered);
      else flush();
    });
  }

  function selectQuality(video, hls, id, state) {
    cancelPreparation(state);
    if (state) {
      state.switchAt = 0;
      state.switchLevel = -1;
      delete state.badge.dataset.switchBoundary;
    }
    if (id === 'auto') {
      hls.loadLevel = -1;
    } else {
      const option = video.qualityList?.find(o => o.id === id);
      if (!option || !Number.isInteger(option.index)) return;
      const level = hls.levels[option.index];
      const oldGrid = hls.levels[hls.currentLevel]?.details?.fragments;
      const canPrepare = state?.fastSwitch !== false && state?.abort && !state.abort.signal.aborted &&
        !video.paused && !video.seeking && video.readyState >= 3 &&
        oldGrid?.length && hls.currentLevel !== option.index && bufferAhead(video) > 4 &&
        bandwidth(level) * 1.3 < Math.max(state.bps || 0, hls.bandwidthEstimate || 0);
      if (!canPrepare) hls.loadLevel = option.index;
      else {
        const pending = {abort:new AbortController(), level:option.index};
        state.preparing = pending;
        // Keep the current rendition and all queued media until the new
        // producer and its first required segment are ready.
        hls.loadLevel = hls.currentLevel;
        const ownerSignal = state.abort.signal;
        const cancel = () => pending.abort.abort();
        ownerSignal.addEventListener('abort', cancel, {once:true});
        const timeout = setTimeout(cancel, 4000);
        void prepareRendition(level, () => video.currentTime, pending.abort.signal, oldGrid.map(f => f.end)).then(start => {
          if (state.preparing === pending && !pending.abort.signal.aborted) {
            state.badge.dataset.switchBoundary = String(start);
            return commitPreparedSwitch(video, hls, option.index, start, pending.abort.signal, ownerSignal);
          }
        }).catch(() => {
          // A timeout or failed preparation must never discard the safety buffer.
          if (state.preparing === pending && !ownerSignal.aborted) hls.loadLevel = option.index;
        }).finally(() => {
          clearTimeout(timeout);
          ownerSignal.removeEventListener('abort', cancel);
          if (state.preparing === pending) state.preparing = null;
        });
      }
      if (state) {
        state.switchAt = hls.currentLevel === option.index ? 0 : Date.now();
        state.switchLevel = option.index;
        delete state.badge.dataset.switchMs;
      }
    }
    video._qualitySelected = id;
    video.dispatchEvent(new CustomEvent('quality-selected'));
  }

  function selectAudio(hls, index, startup) {
    if (startup) hls.audioTrack = index;
    else hls.nextAudioTrack = index;
  }

  function beginSeek(state) {
    const pending = cancelPreparation(state);
    if (pending) state.hls.loadLevel = pending.level;
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

  function renditionText(video, hls) {
    if (!video.videoWidth || !video.videoHeight) return 'Loading video…';
    const level = hls?.levels?.[hls.currentLevel];
    const codec = level?.videoCodec || level?.attrs?.CODECS || '';
    const name = /hvc1|hev1/i.test(codec) ? 'HEVC' : /avc1/i.test(codec) ? 'H.264' : '';
    const mode = isOriginal(level) ? 'Original' : hls?.autoLevelEnabled ? 'Auto' : 'Playing';
    return `${mode} · ${Math.min(video.videoWidth, video.videoHeight)}p (${video.videoWidth}×${video.videoHeight})${name ? ' · ' + name : ''}`;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {chooseLevel, audioProfile, selectQuality, selectAudio, beginSeek, requestAge, renditionText, prepareRendition, commitPreparedSwitch, configure};
  }
  if (typeof document === 'undefined') return;
  const debug = new URLSearchParams(location.search).has('rkmpp_debug');

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

  async function warmOriginal(state, force = false) {
    const hls = state.hls;
    const level = hls.levels.find(isOriginal);
    if (!level || state.originalReady || state.warming || (!force && Date.now() - state.lastWarm < 5000)) return;
    state.warming = true;
    state.lastWarm = Date.now();
    try {
      const url = Array.isArray(level.url) ? level.url[0] : level.url;
      const response = await fetch(url, {cache:'no-store', signal:state.abort.signal});
      state.originalReady = response.ok;
      // A pending keyframe probe responds 409; encoded playback stays usable.
      await response.body?.cancel();
    } catch { /* Retry later without blocking playback. */ }
    finally { state.warming = false; }
  }

  function setAudio(state, startup = false) {
    if (!(state.bps > 0)) return;
    startup = startup || !state.audioInitialized;
    const desired = audioProfile(state.bps);
    const now = Date.now();
    if (desired !== state.audioCandidate) {
      state.audioCandidate = desired;
      state.audioCandidateSince = now;
    }
    const current = state.audioProfile || 'audio';
    const down = ['audio32','audio64','audio96','audio'].indexOf(desired) < ['audio32','audio64','audio96','audio'].indexOf(current);
    if (!startup && (now - state.audioCandidateSince < (down ? 6000 : 25000) || now - state.audioChanged < 15000)) return;
    const tracks = state.hls.audioTracks || [];
    const index = tracks.findIndex(t => (t.url || '').split('?')[0].endsWith('/' + desired + '.m3u8'));
    if (index >= 0 && state.hls.audioTrack !== index) {
      selectAudio(state.hls, index, startup);
      state.audioChanged = now;
    }
    if (index >= 0) {
      state.audioProfile = desired;
      state.audioInitialized = true;
    }
  }

  function configure(video, state, hls) {
    state.abort?.abort();
    cancelPreparation(state);
    clearTimeout(state.retryTimer);
    for (const [event, fn] of state.events || []) state.hls.off(event, fn);
    state.hls = hls;
    state.abort = new AbortController();
    state.selected = 'auto';
    state.seekLevel = null;
    state.audioInitialized = false;
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
        set:id => { state.seekLevel = null; state.selected = id; selectQuality(video, hls, id, state); },
      });
    }
    Object.assign(hls.config, {
      autoStartLoad:false, startFragPrefetch:false,
      // Bound bytes as well as seconds: 4K/60 AVC can exceed 65 Mbps.
      maxBufferLength:3, maxBufferSize:48*1024*1024, maxMaxBufferLength:18, backBufferLength:3,
      capLevelOnFPSDrop:true, fpsDroppedMonitoringThreshold:0.2,
      abrBandWidthFactor:0.8, abrBandWidthUpFactor:0.65,
      abrEwmaFastVoD:3, abrEwmaSlowVoD:10,
    });
    // stopLoad also aborts an in-flight manifest in hls.js 1.7. Wait for
    // its normal parse event; autoStartLoad=false already holds fragments.
    if (hls.levels.length) hls.stopLoad();
    state.badge.dataset.phase = 'waiting-manifest';
    let starting = false;
    const measured = speedProbe(state.abort.signal);
    const start = async () => {
      if (starting || !hls.levels.length) return;
      starting = true;
      state.badge.dataset.levels = hls.levels.map(l => `${l.width}x${l.height}:${l.bitrate}:${isOriginal(l) ? 'original' : 'encoded'}`).join(',');
      state.badge.dataset.phase = 'probing';
      void warmOriginal(state);
      state.bps = await measured;
      if (state.abort.signal.aborted) return;
      state.badge.dataset.initialBandwidth = String(Math.round(state.bps));
      // Give an affordable Original a bounded chance to finish its copy-grid
      // preflight, rather than racing that request and starting an encoder.
      if (isOriginal(hls.levels[chooseLevel(hls.levels, state.bps)])) {
        const deadline = Date.now() + 1500;
        while (!state.originalReady && Date.now() < deadline && !state.abort.signal.aborted) {
          await warmOriginal(state, true);
          if (!state.originalReady) await new Promise(resolve => setTimeout(resolve, 150));
        }
      }
      if (state.abort.signal.aborted) return;
      state.policy = new PlaybackPolicy(hls.levels, state.bps, state.originalReady);
      state.cap = state.policy.cap;
      // Older hls.js builds exposed this estimate as a read-only getter.
      try { hls.bandwidthEstimate = state.bps; }
      catch { hls.config.abrEwmaDefaultEstimate = state.bps; }
      hls.autoLevelCapping = state.cap;
      hls.loadLevel = -1;
      hls.startLevel = state.cap;
      setAudio(state, true);
      state.checking = false;
      state.badge.dataset.phase = 'loading';
      hls.startLoad();
    };
    listen(Events.MANIFEST_PARSED, start);
    listen(Events.AUDIO_TRACKS_UPDATED, () => setAudio(state, state.checking));
    listen(Events.FRAG_LOADED, (_event, data) => {
      if (data.frag?.type !== 'main') return;
      if (state.inflight === data.frag) state.inflight = null;
      const stats = data.stats || data.frag.stats;
      state.policy?.sample(stats);
      if (state.policy) state.bps = state.policy.bps;
    });
    listen(Events.FRAG_LOADING, (_event, data) => {
      if (data.frag?.type === 'main') state.inflight = data.frag;
    });
    listen(Events.LEVEL_SWITCHED, (_event, data) => {
      if (data.level === state.switchLevel && state.switchAt) {
        state.badge.dataset.switchMs = String(Date.now() - state.switchAt);
        state.switchAt = 0;
      }
    });
    listen(Events.FRAG_BUFFERED, (_event, data) => {
      if (state.debug && data.frag?.type === 'main') {
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
    listen(Events.FPS_DROP_LEVEL_CAPPING, (_event, data) => { state.decoderCap = data.level >= 0 ? data.level : Infinity; });
    listen(Events.ERROR, (_event, data) => {
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
    const state = {badge, debug, hls:null, decoderCap:Infinity, bps:0, audioChanged:0,
      fastSwitch:new URLSearchParams(location.search).has('rkmpp_fast_switch')};
    const diagnostics = new AbortController();
    const metric = (name, fn) => video.addEventListener(name, fn, {signal:diagnostics.signal});
    metric('playing', () => {
      state.hasPlayed = true;
      if (state.waitingAt) state.waitingMs = (state.waitingMs || 0) + Date.now() - state.waitingAt;
      state.waitingAt = 0;
    });
    metric('waiting', () => {
      if (!state.hasPlayed || video.seeking || video.paused || state.waitingAt) return;
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
    if (hls && state.policy && !state.checking) {
      const stats = state.inflight?.stats;
      const action = state.policy.step({
        now, buffer, playing:!video.paused && !video.ended, seeking:video.seeking,
        auto:state.selected === 'auto', originalReady:state.originalReady, decoderCap:state.decoderCap,
        requestAge:requestAge(video, state, now),
        loaded:stats?.loaded || 0,
        targetBuffer:Math.min(hls.config.maxMaxBufferLength,
          Math.max(hls.config.maxBufferLength, 8*hls.config.maxBufferSize/bandwidth(hls.levels[hls.currentLevel]))),
      });
      state.bps = action.bps;
      state.cap = action.cap;
      state.badge.dataset.phase = action.phase;
      if (state.selected === 'auto') {
        if (state.seekLevel != null && action.phase !== 'seeking') {
          state.seekLevel = null;
          hls.bandwidthEstimate = state.bps;
          hls.loadLevel = -1;
        }
        hls.autoLevelCapping = action.cap;
        if (action.cancel) {
          // Stop downloads only. Keep the media source and playing buffers.
          hls.stopLoad();
          hls.loadLevel = -1;
          hls.nextAutoLevel = action.cap;
          hls.startLoad(video.currentTime, true);
        }
        void warmOriginal(state);
      }
      setAudio(state);
    }
    const text = state.failure || (state.checking ? 'Checking connection…' : renditionText(video, hls));
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

(function () {
  'use strict';

  const isOriginal = level => (Array.isArray(level?.url) ? level.url : [level?.url]).some(u => /\/direct\.m3u8(?:\?|$)/.test(u || ''));
  const bandwidth = level => level?.bitrate || Number(level?.attrs?.BANDWIDTH) || Infinity;

  const {PlaybackPolicy, chooseLevel, audioProfile} = typeof module !== 'undefined' && module.exports
    ? require('./policy.js') : window.MemoriesRkmppPolicy;

  function selectQuality(video, hls, id) {
    if (id === 'auto') {
      hls.loadLevel = -1;
    } else {
      const option = video.qualityList?.find(o => o.id === id);
      if (!option || !Number.isInteger(option.index)) return;
      // Never replace the fragment currently playing. A shared audio buffer
      // survives the next-video-fragment switch; legacy muxed audio drains.
      if (hls.levels[option.index]?.audioGroupIds?.length) hls.nextLevel = option.index;
      else hls.loadLevel = option.index;
    }
    video._qualitySelected = id;
    video.dispatchEvent(new CustomEvent('quality-selected'));
  }

  function selectAudio(hls, index, startup) {
    if (startup) hls.audioTrack = index;
    else hls.nextAudioTrack = index;
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
    module.exports = {chooseLevel, audioProfile, selectQuality, selectAudio, renditionText, configure};
  }
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
        if (estimate < 4000000 || (size >= 393216 && estimate < 25000000)) break;
      }
    } catch { /* Timeout uses partial bytes; unavailable probe starts low. */ }
    finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
    return estimate || 750000;
  }

  async function warmOriginal(state) {
    const hls = state.hls;
    const level = hls.levels.find(isOriginal);
    if (!level || state.originalReady || state.warming || Date.now() - state.lastWarm < 5000) return;
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
    if (index >= 0) state.audioProfile = desired;
  }

  function configure(video, state, hls) {
    state.abort?.abort();
    clearTimeout(state.retryTimer);
    for (const [event, fn] of state.events || []) state.hls.off(event, fn);
    state.hls = hls;
    state.abort = new AbortController();
    state.selected = 'auto';
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
        set:id => { state.selected = id; selectQuality(video, hls, id); },
      });
    }
    Object.assign(hls.config, {
      autoStartLoad:false, startFragPrefetch:false,
      maxBufferLength:12, maxMaxBufferLength:18, backBufferLength:20,
      capLevelOnFPSDrop:true, fpsDroppedMonitoringThreshold:0.05,
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
      state.policy = new PlaybackPolicy(hls.levels, state.bps, state.originalReady);
      state.cap = state.policy.cap;
      // Older hls.js builds exposed this estimate as a read-only getter.
      try { hls.bandwidthEstimate = state.bps; }
      catch { hls.config.abrEwmaDefaultEstimate = state.bps; }
      hls.autoLevelCapping = state.cap;
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
    listen(Events.FRAG_BUFFERED, () => {
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
    const state = {badge, hls:null, decoderCap:Infinity, bps:0, audioChanged:0};
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
    metric('seeking', () => { state.waitingAt = 0; state.seekAt = Date.now(); });
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
    const hls = video._qualityHls;
    if (hls && state.hls !== hls) configure(video, state, hls);
    const buffer = bufferAhead(video);
    const now = Date.now();
    if (hls && state.policy && !state.checking) {
      const stats = state.inflight?.stats;
      const action = state.policy.step({
        now, buffer, playing:!video.paused && !video.ended, seeking:video.seeking,
        auto:state.selected === 'auto', originalReady:state.originalReady, decoderCap:state.decoderCap,
        requestAge:stats?.loading?.start > 0 ? performance.now() - stats.loading.start : 0,
        loaded:stats?.loaded || 0,
      });
      state.bps = action.bps;
      state.cap = action.cap;
      state.badge.dataset.phase = action.phase;
      if (state.selected === 'auto') {
        hls.autoLevelCapping = action.cap;
        if (action.cancel) {
          // Stop downloads only. Keep the media source and playing buffers.
          hls.stopLoad();
          hls.loadLevel = -1;
          hls.nextAutoLevel = action.cap;
          hls.startLoad(video.currentTime, true);
        }
        setAudio(state);
        void warmOriginal(state);
      }
    }
    const text = state.failure || (state.checking ? 'Checking connection…' : renditionText(video, hls));
    if (state.badge.textContent !== text) state.badge.textContent = text;
    Object.assign(state.badge.dataset, {
      bandwidth: String(Math.round(state.bps)), buffer:buffer.toFixed(2),
      cap:String(state.cap ?? ''), audio:state.audioProfile || '',
      waitingCount:String(state.waitingCount || 0),
      waitingMs:String((state.waitingMs || 0) + (state.waitingAt ? now - state.waitingAt : 0)),
    });
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
  }).observe(document.documentElement, {childList:true, subtree:true});
  document.querySelectorAll('video').forEach(attach);
  setInterval(() => {
    for (const [video, state] of attached) {
      if (!video.isConnected) { state.detach(); attached.delete(video); }
      else update(video, state);
    }
  }, 500);
})();

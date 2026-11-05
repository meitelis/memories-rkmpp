(function (root) {
  'use strict';
  function attach(host, bridge) {
    let state = null;
    let list = '';
    let selected = 'auto';
    const badge = host.ownerDocument.createElement('div');
    badge.className = 'mr-v11-status';
    badge.setAttribute('role', 'status');
    const emit = name => host.dispatchEvent(new Event(name));
    function sync() {
      try { state = JSON.parse(bridge.getNativeVideoQualityState()); } catch { return; }
      if (!state || state.url !== host.src) return;
      state.qualities = [...(state.qualities || [])].sort((a, b) =>
        (a.id === 'auto' ? -1 : b.id === 'auto' ? 1 : b.size - a.size || b.bitrate - a.bitrate));
      const next = JSON.stringify(state.qualities);
      if (next !== list) { list = next; emit('quality-list'); }
      if (state.selected !== selected) { selected = state.selected; emit('quality-selected'); }
      const codec = state.codec === 'video/hevc' ? 'HEVC' : state.codec === 'video/avc' ? 'H.264' : state.codec?.replace('video/', '');
      const text = state.width && state.height
        ? `${state.original ? 'Original' : selected === 'auto' ? 'Auto' : 'Playing'} · ${Math.min(state.width, state.height)}p (${state.width}×${state.height})${codec ? ' · ' + codec : ''}`
        : 'Loading video…';
      if (badge.textContent !== text) badge.textContent = text;
      const controls = host.closest('.video-container')?.querySelector('.m-vc-controls');
      if (controls && badge.parentElement !== controls) controls.prepend(badge);
    }
    Object.defineProperties(host, {
      qualityList: {configurable: true, get: () => state?.url === host.src ? state.qualities || [] : []},
      currentQuality: {configurable: true, get: () => selected, set: id => {
        if (state?.url !== host.src || !state.qualities?.some(option => option.id === id)) return;
        bridge.nativeVideoCommand(JSON.stringify({action: 'quality', url: host.src, id}));
        selected = id;
        emit('quality-selected');
      }},
    });
    const events = ['timeupdate', 'loadedmetadata', 'progress', 'resize', 'pause', 'playing'];
    for (const event of events) host.addEventListener(event, sync);
    sync();
    return () => {
      for (const event of events) host.removeEventListener(event, sync);
      delete host.qualityList;
      delete host.currentQuality;
      badge.remove();
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {attach};
  if (!root?.document || !root.nativex?.getNativeVideoQualityState) return;
  const active = new Map();
  const scan = () => {
    for (const [host, dispose] of active) if (!host.isConnected) { dispose(); active.delete(host); }
    for (const host of document.querySelectorAll('viewer-video-native-hole')) {
      if (!active.has(host)) active.set(host, attach(host, root.nativex));
    }
  };
  new MutationObserver(scan).observe(document.documentElement, {childList: true, subtree: true});
  scan();
})(typeof window === 'undefined' ? null : window);

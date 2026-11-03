(() => {
  'use strict';

  const STORAGE_KEY = 'memories-rkmpp-playback-v1';
  const DEFAULTS = Object.freeze({ codec: 'auto', buffer: 'auto', customSeconds: 12 });

  function normalizePreferences(value) {
    const input = value && typeof value === 'object' ? value : {};
    return {
      codec: ['auto', 'hevc', 'h264'].includes(input.codec) ? input.codec : DEFAULTS.codec,
      buffer: ['auto', 'responsive', 'smooth', 'custom'].includes(input.buffer) ? input.buffer : DEFAULTS.buffer,
      customSeconds: typeof input.customSeconds === 'number' && Number.isFinite(input.customSeconds) &&
        input.customSeconds >= 6 && input.customSeconds <= 30 ? Math.round(input.customSeconds) : DEFAULTS.customSeconds,
    };
  }

  function createPreferencesStore(storage) {
    let preferences = { ...DEFAULTS };
    let persistent = !!storage;
    const listeners = new Set();
    try {
      const saved = storage?.getItem(STORAGE_KEY);
      if (saved) {
        try { preferences = normalizePreferences(JSON.parse(saved)); } catch { /* Ignore corrupt saved data. */ }
      }
    } catch {
      persistent = false;
    }
    const getPreferences = () => ({ ...preferences });
    function setPreferences(patch) {
      const next = normalizePreferences({ ...preferences, ...patch });
      const changed = JSON.stringify(next) !== JSON.stringify(preferences);
      preferences = next;
      try {
        if (storage) { storage.setItem(STORAGE_KEY, JSON.stringify(next)); persistent = true; }
        else persistent = false;
      } catch {
        persistent = false;
      }
      if (changed) for (const listener of listeners) listener(getPreferences());
      return getPreferences();
    }
    return {
      getPreferences, setPreferences,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      get persistent() { return persistent; },
    };
  }

  function recommendConnection(samples) {
    if (!Array.isArray(samples) || samples.length < 2 || samples.some((sample) => !Number.isFinite(sample) || sample <= 0)) {
      throw new Error('The connection test returned invalid timing data.');
    }
    const minimum = Math.min(...samples);
    const maximum = Math.max(...samples);
    const unstable = maximum / minimum >= 1.8;
    const mbps = samples.length / samples.reduce((total, sample) => total + 1 / sample, 0);
    const buffer = minimum < 6 || unstable ? 'smooth' : minimum > 25 ? 'responsive' : 'auto';
    return { mbps, minimum, maximum, unstable, preferences: { codec: 'auto', buffer, customSeconds: 12 } };
  }

  async function testConnection(fetcher, route, {
    origin, now = () => performance.now(), nonce = () => `${Date.now()}-${Math.random()}`, signal,
  } = {}) {
    const base = new URL(route, origin);
    if (!origin || base.origin !== new URL(origin).origin) throw new Error('Connection test must use this Nextcloud server.');
    const rates = [];
    for (const bytes of [128 * 1024, 1024 * 1024, 1024 * 1024]) {
      const url = new URL(base.href);
      url.searchParams.set('bytes', `${bytes}`);
      url.searchParams.set('nonce', nonce());
      const started = now();
      const response = await fetcher(url.href, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal,
        headers: { Accept: 'application/octet-stream' } });
      if (!response.ok) throw new Error('Connection test request failed.');
      const data = await response.arrayBuffer();
      const elapsed = now() - started;
      if (data.byteLength !== bytes || !Number.isFinite(elapsed) || elapsed <= 0) {
        throw new Error('Connection test returned an unexpected response.');
      }
      if (bytes === 1024 * 1024) rates.push(bytes * 8 / (elapsed / 1000) / 1000000);
    }
    return { ...recommendConnection(rates), samples: rates, bytes: 128 * 1024 + 2 * 1024 * 1024 };
  }

  if (typeof document === 'undefined' && typeof module === 'object' && module.exports) {
    module.exports = { STORAGE_KEY, DEFAULTS, normalizePreferences, createPreferencesStore, recommendConnection, testConnection };
    return;
  }
  if (!/\/apps\/memories(?:\/|$)/.test(location.pathname)) return;
  const marker = Symbol.for('memories-rkmpp-settings');
  if (window[marker]) return;
  let storage;
  try { storage = window.localStorage; } catch { /* Browser storage can be disabled. */ }
  const store = createPreferencesStore(storage);
  let status = null;
  let panel = null;
  let opener = null;
  let running = null;
  let renderStatus = () => {};

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, className, action) {
    const node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }

  function createPanel() {
    const dialog = element('dialog', 'memories-playback-dialog');
    dialog.id = 'memories-playback-dialog';
    dialog.setAttribute('aria-labelledby', 'memories-playback-title');
    const content = element('div', 'memories-playback-content');
    const header = element('header', 'memories-playback-header');
    const title = element('h2', '', 'Playback settings');
    title.id = 'memories-playback-title';
    const close = button('×', 'memories-playback-close', () => dialog.close());
    close.setAttribute('aria-label', 'Close playback settings');
    header.append(title, close);
    content.append(header, element('p', 'memories-playback-description', 'Choose how video plays in this browser.'));

    const form = element('form', 'memories-playback-form');
    const codecLabel = element('label', 'memories-playback-field', 'Video format');
    const codec = element('select');
    for (const [value, text] of [['auto', 'Auto — HEVC when supported'], ['hevc', 'HEVC / H.265 preferred'], ['h264', 'H.264 — maximum compatibility']]) {
      const option = element('option', '', text); option.value = value; codec.append(option);
    }
    codecLabel.append(codec);
    const codecNote = element('p', 'memories-playback-note', 'HEVC uses less bandwidth. Unsupported players always fall back to H.264.');
    const bufferLabel = element('label', 'memories-playback-field', 'Buffering');
    const buffer = element('select');
    for (const [value, text] of [['auto', 'Auto — balanced for your connection'], ['responsive', 'Responsive — 6 seconds'], ['smooth', 'Smooth — 18 seconds'], ['custom', 'Custom']]) {
      const option = element('option', '', text); option.value = value; buffer.append(option);
    }
    bufferLabel.append(buffer);
    const customLabel = element('label', 'memories-playback-custom');
    const customHeading = element('span', '', 'Custom buffer');
    const customValue = element('output', 'memories-playback-custom-value');
    const custom = element('input');
    custom.type = 'range'; custom.min = '6'; custom.max = '30'; custom.step = '1';
    custom.setAttribute('aria-label', 'Custom buffer in seconds');
    custom.addEventListener('input', () => { customValue.textContent = `${custom.value} seconds`; });
    customLabel.append(customHeading, customValue, custom);
    buffer.addEventListener('change', () => { customLabel.hidden = buffer.value !== 'custom'; });
    form.append(codecLabel, codecNote, bufferLabel, customLabel,
      element('p', 'memories-playback-note', 'More buffer helps an uneven connection. Auto uses about 6–18 seconds. A 32 MB video budget can reduce the target for larger videos.'));
    const playback = element('p', 'memories-playback-status');
    playback.setAttribute('aria-live', 'polite');
    renderStatus = () => {
      if (!status) { playback.textContent = 'Open a video to see its current playback format and buffer target.'; return; }
      const parts = [];
      if (status.codec === 'hevc' || status.codec === 'h264') parts.push(status.codec === 'hevc' ? 'HEVC / H.265' : 'H.264');
      if (Number.isFinite(status.shortEdge) && status.shortEdge > 0) parts.push(`${Math.round(status.shortEdge)}p`);
      if (Number.isFinite(status.bufferSeconds)) parts.push(`Buffer target: ${Math.round(status.bufferSeconds * 10) / 10}s`);
      playback.textContent = parts.length ? parts.join(' · ') : 'Playback is starting…';
    };
    renderStatus();
    form.append(playback);

    const testArea = element('section', 'memories-playback-connection');
    testArea.append(element('h3', '', 'Connection recommendation'),
      element('p', 'memories-playback-note', 'Test this connection to your Nextcloud server. Uses about 2.2 MB and does not contact an outside service.'));
    const result = element('p', 'memories-playback-test-result', 'Your internet plan’s advertised speed may differ from this connection.');
    result.setAttribute('role', 'status'); result.setAttribute('aria-live', 'polite');
    let recommendation = null;
    const saved = element('p', 'memories-playback-saved');
    saved.setAttribute('role', 'status');
    function fill() {
      const preferences = store.getPreferences();
      codec.value = preferences.codec; buffer.value = preferences.buffer; custom.value = `${preferences.customSeconds}`;
      customValue.textContent = `${preferences.customSeconds} seconds`; customLabel.hidden = buffer.value !== 'custom';
    }
    function notifySaved() {
      saved.textContent = store.persistent ? 'Settings applied and saved for this browser.' : 'Settings applied for this visit. Browser storage is unavailable.';
    }
    const use = button('Use recommendation', 'memories-playback-secondary', () => {
      if (!recommendation) return;
      store.setPreferences(recommendation.preferences); fill(); notifySaved();
    });
    use.hidden = true;
    const test = button('Test connection', 'memories-playback-secondary', async () => {
      if (running) return;
      const controller = new AbortController();
      running = controller;
      const timeout = setTimeout(() => controller.abort(), 45000);
      test.disabled = true; use.hidden = true; testArea.setAttribute('aria-busy', 'true');
      result.textContent = 'Testing your Nextcloud connection…';
      try {
        const route = window.OC?.generateUrl?.('/apps/memories_rkmpp_player/connection-test');
        if (!route) throw new Error('Connection test is unavailable.');
        const measured = await testConnection(window.fetch.bind(window), route, {
          origin: location.origin, signal: controller.signal, now: () => performance.now(),
          nonce: () => window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        });
        if (running !== controller || controller.signal.aborted) return;
        recommendation = measured;
        const label = measured.preferences.buffer === 'responsive' ? 'Responsive (6 seconds)' :
          measured.preferences.buffer === 'smooth' ? 'Smooth (18 seconds)' : 'Auto (balanced)';
        result.textContent = `About ${measured.mbps.toFixed(1)} Mbps to Nextcloud. ${measured.unstable ? 'The two samples varied. ' : ''}Recommended: ${label}, with format set to Auto.`;
        use.hidden = false;
      } catch {
        if (running === controller && dialog.open) result.textContent = 'The connection test could not finish. Check your connection and try again.';
      } finally {
        clearTimeout(timeout);
        if (running === controller) { running = null; test.disabled = false; testArea.removeAttribute('aria-busy'); }
      }
    });
    const testActions = element('div', 'memories-playback-test-actions');
    testActions.append(test, use);
    testArea.append(testActions, result);
    form.append(testArea, saved);
    const actions = element('footer', 'memories-playback-actions');
    const reset = button('Reset to Auto', 'memories-playback-reset', () => {
      store.setPreferences(DEFAULTS); fill(); notifySaved();
    });
    const apply = element('button', 'memories-playback-primary', 'Apply settings');
    apply.type = 'submit';
    actions.append(reset, apply); form.append(actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      store.setPreferences({ codec: codec.value, buffer: buffer.value, customSeconds: Number(custom.value) });
      notifySaved();
    });
    content.append(form); dialog.append(content); document.body.append(dialog);
    // Keep viewer shortcuts from seeking or closing the video behind the form.
    dialog.addEventListener('keydown', (event) => event.stopPropagation());
    dialog.addEventListener('keyup', (event) => event.stopPropagation());
    let backdropPointer = null;
    function isBackdrop(event) {
      if (!dialog.open || event.target !== dialog) return false;
      const bounds = dialog.getBoundingClientRect();
      return event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom;
    }
    // Backdrop events target the dialog too. Require a full outside gesture so
    // opening clicks, dialog padding and drags from inside cannot dismiss it.
    dialog.addEventListener('pointerdown', (event) => {
      backdropPointer = event.isPrimary && event.button === 0 && isBackdrop(event) ? event.pointerId : null;
    });
    dialog.addEventListener('pointerup', (event) => {
      const dismiss = backdropPointer === event.pointerId && isBackdrop(event);
      backdropPointer = null;
      if (dismiss) dialog.close();
    });
    dialog.addEventListener('pointercancel', () => { backdropPointer = null; });
    dialog.addEventListener('cancel', () => { running?.abort(); });
    dialog.addEventListener('close', () => {
      backdropPointer = null; running?.abort(); if (opener?.isConnected) opener.focus();
    });
    return { dialog, fill, saved };
  }

  function open() {
    if (!panel) panel = createPanel();
    panel.fill(); panel.saved.textContent = '';
    opener = document.activeElement;
    if (!panel.dialog.open) panel.dialog.showModal();
  }
  const api = {
    getPreferences: store.getPreferences, setPreferences: store.setPreferences, subscribe: store.subscribe, open,
    updatePlaybackStatus(value) { status = value && typeof value === 'object' ? { ...value } : null; renderStatus(); },
  };
  window[marker] = api;
  window.dispatchEvent(new Event('memories-rkmpp-settings-ready'));

  function installNavigation() {
    if (document.getElementById('memories-playback-settings-entry')) return;
    const navigation = document.querySelector('#app-navigation-vue');
    if (!navigation) return;
    const entry = element('li', 'memories-playback-nav-entry');
    entry.id = 'memories-playback-settings-entry';
    const launch = button('Playback settings', 'memories-playback-nav-button', open);
    entry.append(launch);
    const settings = [...navigation.querySelectorAll('li')].find((item) =>
      item.textContent.trim() === 'Settings' || item.querySelector('[href$="/settings"]'));
    const list = settings?.parentElement || navigation.querySelector('ul');
    if (settings && list) list.insertBefore(entry, settings);
    else if (list) list.append(entry);
    else navigation.append(entry);
  }

  function installViewerControls() {
    const bars = new Set(document.querySelectorAll('.memories-viewer.fully-opened.is-video > .inner > .top-bar'));
    for (const launch of document.querySelectorAll('.memories-playback-viewer-button')) {
      if (!bars.has(launch.parentElement)) launch.remove();
    }
    for (const bar of bars) {
      if ([...bar.children].some((child) => child.classList.contains('memories-playback-viewer-button'))) continue;
      const launch = button('', 'memories-playback-viewer-button', (event) => {
        event.preventDefault(); event.stopPropagation(); launch.focus(); open();
      });
      launch.setAttribute('aria-label', 'Playback settings');
      launch.setAttribute('title', 'Playback settings');
      launch.setAttribute('aria-haspopup', 'dialog');
      launch.setAttribute('aria-controls', 'memories-playback-dialog');
      const icon = element('span', '', '\u2699\uFE0E');
      icon.setAttribute('aria-hidden', 'true'); launch.append(icon);
      // Keep PhotoSwipe and video gestures from interpreting a toolbar press.
      for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick']) {
        launch.addEventListener(name, (event) => event.stopPropagation());
      }
      for (const name of ['keydown', 'keyup']) {
        launch.addEventListener(name, (event) => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        });
      }
      // This is our own toolbar sibling, outside Vue's action-items children.
      bar.append(launch);
    }
  }

  function changesViewer(record) {
    if (record.type === 'attributes') return record.target.matches?.('.memories-viewer');
    const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
    // Ignore clocks, captions and other player updates; only toolbar/viewer
    // creation, replacement or removal can affect our own button.
    return target?.matches?.('.memories-viewer > .inner > .top-bar') || [...record.addedNodes, ...record.removedNodes].some((node) =>
      node.nodeType === 1 && (node.matches('.memories-viewer, .top-bar') || node.querySelector('.memories-viewer, .top-bar')));
  }

  function mount() {
    installNavigation();
    installViewerControls();
    new MutationObserver((records) => {
      if (!document.getElementById('memories-playback-settings-entry')) installNavigation();
      if (records.some(changesViewer)) installViewerControls();
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();

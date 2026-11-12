(() => {
  if (!Array.isArray(characters)) return;
  const previous = window.__DSH_WUWA_INTRO__;
  if (previous?.version === runtime.version && previous.sessionId === runtime.sessionId) return;
  if (previous && typeof previous.dispose !== 'function') return; // Pre-0.4.3 pages need one reload.
  previous?.dispose();
  const lifecycle = new AbortController();
  const key = 'dsh-wuthering-waves-intro.preferences';
  const defaults = { enabled: true, character: 'shorekeeper', mode: 'full' };
  const find = id => characters.find(character => character.id === id);
  const media = (id, extension) => `/dsh-wuthering-waves-intro/media/${id}.${extension}?v=${runtime.version}`;
  const desktop = typeof window.dshDesktopBoot?.ready === 'function' ||
    typeof window.dshDesktop?.deviceInfo === 'function' || location.protocol === 'dsh-app:';
  const bridgedMedia = desktop || !['http:', 'https:'].includes(location.protocol);
  const canBlob = typeof window.fetch === 'function' && typeof URL.createObjectURL === 'function' && typeof URL.revokeObjectURL === 'function';
  const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reducedMotion = () => motionPreference?.matches ?? false;
  const clamp = value => Math.max(0, Math.min(1, value));
  const startupKey = 'dsh-wuthering-waves-intro.host-session';
  function startupPlayed() {
    if (window.__DSH_WUWA_HOST_SESSION__ === runtime.sessionId) return true;
    try { return localStorage.getItem(startupKey) === runtime.sessionId; }
    catch { return window.__DSH_WUWA_HOST_SESSION__ === runtime.sessionId; }
  }
  function claimStartup() {
    if (startupPlayed()) return false;
    try { localStorage.setItem(startupKey, runtime.sessionId); } catch { /* In-memory fallback when storage is unavailable. */ }
    window.__DSH_WUWA_HOST_SESSION__ = runtime.sessionId;
    return true;
  }

  function read() {
    try {
      const stored = JSON.parse(localStorage.getItem(key));
      return {
        enabled: stored?.enabled !== false,
        character: find(stored?.character)?.id ?? defaults.character,
        mode: stored?.mode === 'quick' ? 'quick' : 'full'
      };
    } catch { return { ...defaults }; }
  }

  function plan(id, mode = 'full') {
    const character = find(id);
    if (!character) return null;
    const quick = mode === 'quick';
    const clip = artwork.characters[id]?.quick;
    const start = quick && clip ? clip.startFrame / 30 : (artwork.characters[id]?.startFrame ?? 0) / 30;
    const end = quick && clip ? clip.endFrame / 30 : (character.end - character.start) / 30;
    const sketchMs = reducedMotion() ? 0 : quick ? 450 : 1050;
    const outroMs = reducedMotion() ? 0 : quick ? 450 : 680;
    return { start, end, sketchMs, outroMs, totalSeconds: end - start + (sketchMs + outroMs) / 1000 };
  }

  // Deadlines use visible time; preview suspension also suspends the watchdog.
  function deadlines(signal) {
    const jobs = new Map();
    let paused = false;
    function clear(name) { clearTimeout(jobs.get(name)?.timer); jobs.delete(name); }
    function schedule(name, job) {
      job.started = performance.now();
      job.timer = setTimeout(() => { jobs.delete(name); if (!signal.aborted) job.callback(); }, job.remaining);
    }
    signal.addEventListener('abort', () => { for (const name of jobs.keys()) clear(name); }, { once: true });
    return {
      clear,
      set(name, remaining, callback) {
        clear(name);
        if (signal.aborted) return;
        const job = { remaining, callback };
        jobs.set(name, job);
        if (!paused) schedule(name, job);
      },
      pause() {
        if (paused) return;
        paused = true;
        for (const job of jobs.values()) {
          clearTimeout(job.timer);
          job.remaining = Math.max(0, job.remaining - (performance.now() - job.started));
        }
      },
      resume() {
        if (!paused) return;
        paused = false;
        for (const [name, job] of jobs) schedule(name, job);
      }
    };
  }

  function createResonanceBands(profile) {
    function span(className) {
      const element = document.createElement('span');
      element.className = `dsh-wuwa-intro-${className}`;
      return element;
    }
    function bars(className, levels) {
      const row = span(className);
      for (const level of levels) {
        const bar = span('bar');
        bar.style.setProperty('--dsh-wuwa-level', level);
        row.append(bar);
      }
      return row;
    }
    const header = span('header');
    const crest = span('crest');
    const dial = span('dial');
    dial.append(span('orbit'), span('core'));
    const wave = profile.filter((_, index) => index % 2 === 0)
      .map((level, index, samples) => (25 + level * .75) * Math.sin(Math.PI * index / (samples.length - 1)) ** .7);
    crest.append(bars('wing', wave), dial, bars('wing', wave));
    header.append(crest);
    const footer = span('footer');
    const spectrum = span('spectrum');
    spectrum.append(bars('spectrum-idle', profile), bars('spectrum-played', profile), span('playhead'));
    footer.append(spectrum);
    header.setAttribute('aria-hidden', 'true');
    footer.setAttribute('aria-hidden', 'true');
    return { header, footer };
  }

  const pathCache = new Map();
  async function loadPaths(id, mode, signal) {
    const cacheKey = `${id}:${mode}`;
    if (pathCache.has(cacheKey)) {
      const paths = pathCache.get(cacheKey);
      pathCache.delete(cacheKey); pathCache.set(cacheKey, paths);
      return paths;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal.aborted) return null;
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 250);
    try {
      const response = await fetch(media(mode === 'quick' ? `${id}-quick` : id, 'json'), {
        signal: controller.signal
      });
      if (!response.ok) return null;
      const paths = await response.json();
      if (!Array.isArray(paths) || !paths.length || paths.length > 128) return null;
      if (!paths.every(row => Array.isArray(row) && row.length === 2 && Number.isFinite(row[0]) && row[0] > 0 &&
        Array.isArray(row[1]) && row[1].length >= 6 && row[1].length <= 24000 && row[1].length % 2 === 0 && row[1].every(Number.isFinite))) return null;
      if (signal.aborted) return null;
      pathCache.set(cacheKey, paths);
      if (pathCache.size > 8) pathCache.delete(pathCache.keys().next().value);
      return paths;
    } catch { return null; }
    finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
  }

  let active = null;
  function play(id, { preview = false, mode = read().mode, onClose = () => {} } = {}) {
    if (lifecycle.signal.aborted) { onClose('unavailable'); return; }
    const character = find(id);
    if (!character || !document.body) return;
    active?.();
    const timing = plan(id, mode);
    const previousFocus = document.activeElement;
    const overlay = document.createElement('dialog');
    overlay.className = 'dsh-wuwa-intro-overlay';
    Object.assign(overlay.dataset, { wuwaCharacter: id, wuwaMode: preview ? 'preview' : 'startup', wuwaPhase: 'loading' });
    overlay.style.setProperty('--dsh-wuwa-outro', `${timing.outroMs}ms`);
    overlay.setAttribute('aria-label', `${character.name}入场动画`);
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.preload = 'auto';
    video.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const frame = document.createElement('span');
    frame.className = 'dsh-wuwa-intro-frame';
    frame.append(video, canvas);
    const surface = document.createElement('button');
    surface.type = 'button';
    surface.className = 'dsh-wuwa-intro-surface';
    surface.setAttribute('aria-label', '跳过入场动画');
    surface.style.setProperty('--dsh-wuwa-poster', `url("${media(id, 'webp')}")`);
    const appearance = artwork.characters[id];
    if (appearance?.signal?.length > 2) {
      surface.style.setProperty('--dsh-wuwa-accent', appearance.color);
      const { header, footer } = createResonanceBands(appearance.signal);
      surface.append(header, frame, footer);
    } else { surface.append(frame); }
    overlay.append(surface);
    const controller = new AbortController();
    const { signal } = controller;
    const timers = deadlines(signal);
    let started = false, suspended = false, sketchDone = false, ready = false;
    let requested = false, revealed = false, ending = false, effects, pendingFrame, attempt = 0;
    let lastVideoFrame = -Infinity;
    let videoUrl, mediaController;
    let blobAttempted = false, streamAttempted = false, mediaGeneration = 0;

    function stopFrames() {
      if (pendingFrame !== undefined) video.cancelVideoFrameCallback?.(pendingFrame);
      pendingFrame = undefined;
    }
    function finish(reason) {
      if (signal.aborted) return;
      controller.abort();
      mediaController?.abort();
      stopFrames();
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch { /* Always remove the modal. */ }
      if (videoUrl) { URL.revokeObjectURL(videoUrl); videoUrl = undefined; }
      try { if (overlay.open) overlay.close(); } finally { overlay.remove(); active = null; }
      if (preview && previousFocus?.isConnected && document.activeElement === document.body) {
        previousFocus.focus({ preventScroll: true });
      }
      onClose(reason);
    }
    const cancel = () => finish('cancelled');
    active = cancel;
    function endVideo() {
      if (ending || signal.aborted) return;
      ending = true;
      video.pause();
      stopFrames();
      timers.clear('loading');
      timers.clear('video');
      timers.clear('reveal');
      surface.style.setProperty('--dsh-wuwa-progress', 1);
      if (!timing.outroMs) { finish('ended'); return; }
      overlay.dataset.wuwaPhase = 'outro';
      timers.set('outro', timing.outroMs, () => finish('ended'));
      try { effects?.dissolve(timing.outroMs, () => finish('ended')); } catch { /* Simple fade is the fallback. */ }
    }
    function reveal() {
      if (revealed || suspended || ending || signal.aborted) return;
      revealed = true;
      overlay.dataset.wuwaPhase = 'video';
      timers.clear('loading');
      timers.clear('reveal');
      timers.set('video', (timing.end - timing.start) * 1000 + 2500, () => finish('timeout'));
    }
    function update(time) {
      if (suspended || ending || signal.aborted) return;
      const progress = clamp((time - timing.start) / (timing.end - timing.start));
      surface.style.setProperty('--dsh-wuwa-progress', progress);
      const profile = appearance?.signal;
      if (profile && !reducedMotion()) {
        const position = clamp(time / ((character.end - character.start) / 30)) * (profile.length - 1);
        const lower = Math.floor(position), fraction = position - lower;
        const energy = (profile[lower] * (1 - fraction) + profile[Math.min(lower + 1, profile.length - 1)] * fraction) / 100;
        surface.style.setProperty('--dsh-wuwa-energy', energy.toFixed(3));
      }
      if (mode === 'quick' && time >= timing.end - 1 / 60) endVideo();
    }
    function watchFrames() {
      if (pendingFrame !== undefined || !video.requestVideoFrameCallback || suspended || ending || signal.aborted) return;
      pendingFrame = video.requestVideoFrameCallback((_now, { mediaTime }) => {
        pendingFrame = undefined;
        if (signal.aborted || suspended || ending) return;
        lastVideoFrame = performance.now();
        if (requested) reveal();
        update(mediaTime);
        watchFrames();
      });
    }
    function requestPlayback() {
      if (suspended || ending || signal.aborted) return;
      const currentAttempt = ++attempt;
      watchFrames();
      try {
        Promise.resolve(video.play()).catch(() => {
          if (currentAttempt === attempt && !suspended) finish('unavailable');
        });
      } catch { finish('unavailable'); }
    }
    function startVideo() {
      if (!ready || !sketchDone || requested || suspended || signal.aborted) return;
      requested = true;
      timers.set('loading', 4500, () => finish('timeout'));
      requestPlayback();
    }
    function artworkFailed() {
      effects?.cancel();
      effects = null;
      canvas.style.opacity = '0';
      sketchDone = true;
      timers.clear('sketch');
      if (ending) return;
      startVideo();
    }
    function retryMedia() {
      if (requested || signal.aborted) return false;
      if (!blobAttempted && canBlob) { void loadVideo(true); return true; }
      if (!streamAttempted) { void loadVideo(false); return true; }
      return false;
    }
    async function loadVideo(asBlob = bridgedMedia && canBlob) {
      const generation = ++mediaGeneration;
      mediaController?.abort();
      mediaController = new AbortController();
      ready = false;
      timers.set('loading', 4500, () => { if (!retryMedia()) finish('timeout'); });
      const source = media(id, 'mp4');
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (videoUrl) { URL.revokeObjectURL(videoUrl); videoUrl = undefined; }
      if (!asBlob) { streamAttempted = true; video.src = source; return; }
      blobAttempted = true;
      // Desktop's protocol proxy strips Content-Length. On a cold media request
      // Chromium can report seekable=[0,0] and silently clamp the initial seek.
      // A Blob gives the decoder a complete, seekable resource without re-encoding.
      // Keep only this playback's clip and release it on every exit path.
      try {
        const response = await fetch(source, { signal: mediaController.signal });
        if (!response.ok) throw new Error('Video unavailable');
        const blob = await response.blob();
        if (signal.aborted || generation !== mediaGeneration) return;
        if (!blob.size) throw new Error('Empty video');
        videoUrl = URL.createObjectURL(blob);
        video.src = videoUrl;
      } catch {
        if (!signal.aborted && generation === mediaGeneration && !retryMedia()) finish('unavailable');
      }
    }
    async function begin() {
      if (started || document.hidden || signal.aborted) return;
      if (!preview && !claimStartup()) { finish('already-played'); return; }
      started = true;
      timers.set('watchdog', timing.totalSeconds * 1000 + 11000, () => finish('timeout'));
      void loadVideo();
      try {
        const paths = timing.sketchMs && appearance ? await loadPaths(id, mode, signal) : null;
        if (signal.aborted) return;
        if (paths) effects = createIntroEffects(canvas, { color: appearance.color, width: artwork.width, height: artwork.height, paths }, video, signal, artworkFailed);
        if (effects) {
          overlay.dataset.wuwaPhase = 'sketch';
          if (suspended) effects.pause();
          effects.sketchIn(timing.sketchMs);
          timers.set('sketch', timing.sketchMs, () => { sketchDone = true; startVideo(); });
        } else { artworkFailed(); }
      } catch { artworkFailed(); }
    }
    function checkReady() {
      if (signal.aborted || ready || video.readyState < 2 || video.seeking) return;
      if (Math.abs(video.currentTime - timing.start) > 1 / 30) return;
      ready = true;
      startVideo();
    }
    video.addEventListener('loadedmetadata', () => {
      if (timing.start > 0) video.currentTime = timing.start;
      checkReady();
    }, { signal });
    video.addEventListener('loadeddata', checkReady, { signal });
    video.addEventListener('seeked', checkReady, { signal });
    video.addEventListener('playing', () => {
      if (suspended) { video.pause(); return; }
      if (!video.requestVideoFrameCallback) reveal();
      else {
        watchFrames();
        if (!revealed) timers.set('reveal', 180, reveal);
      }
    }, { signal });
    video.addEventListener('timeupdate', () => {
      if (!video.requestVideoFrameCallback || performance.now() - lastVideoFrame > 500) update(video.currentTime);
    }, { signal });
    video.addEventListener('ended', endVideo, { signal });
    video.addEventListener('error', () => { if (!retryMedia()) finish('unavailable'); }, { signal });
    surface.addEventListener('click', () => finish('skipped'), { signal });
    overlay.addEventListener('cancel', event => { event.preventDefault(); finish('skipped'); }, { signal });
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish('skipped'); }
    }, { capture: true, signal });
    document.addEventListener('visibilitychange', () => {
      if (!started) { begin(); return; }
      if (document.hidden) {
        if (!preview) { finish('hidden'); return; }
        if (suspended) return;
        suspended = true;
        attempt++;
        overlay.dataset.wuwaPaused = 'true';
        timers.pause();
        effects?.pause();
        video.pause();
        stopFrames();
        overlay.getAnimations?.({ subtree: true }).forEach(animation => animation.pause());
      } else if (suspended) {
        suspended = false;
        overlay.dataset.wuwaPaused = 'false';
        timers.resume();
        effects?.resume();
        overlay.getAnimations?.({ subtree: true }).forEach(animation => animation.play());
        if (requested && !ending) requestPlayback();
        else startVideo();
      }
    }, { signal });
    document.body.append(overlay);
    try { overlay.showModal(); } catch { finish('unavailable'); return cancel; }
    begin();
    return cancel;
  }
  window.__DSH_WUWA_INTRO__ = {
    characters, media, read, play, plan, version: runtime.version, sessionId: runtime.sessionId,
    compatibility: { hostRange: runtime.hostRange, desktop, bridgedMedia, blobAvailable: canBlob },
    dispose() {
      lifecycle.abort();
      active?.();
      pathCache.clear();
      if (window.__DSH_WUWA_INTRO__?.sessionId === runtime.sessionId) delete window.__DSH_WUWA_INTRO__;
    },
    save(preferences) {
      if (!find(preferences.character) || typeof preferences.enabled !== 'boolean' || !['full', 'quick'].includes(preferences.mode)) throw new Error('无效的播放设置');
      localStorage.setItem(key, JSON.stringify(preferences));
    }
  };
  function startup() {
    if (!desktop || lifecycle.signal.aborted) return;
    const preferences = read();
    if (preferences.enabled && !startupPlayed()) play(preferences.character, { mode: preferences.mode });
  }
  if (document.body) startup();
  else document.addEventListener('DOMContentLoaded', startup, { once: true, signal: lifecycle.signal });
  window.addEventListener('pagehide', () => active?.(), { signal: lifecycle.signal });
  window.dispatchEvent(new Event('dsh-wuwa-ready'));
})();

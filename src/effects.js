function createIntroEffects(canvas, sketch, video, signal, onError = () => {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const clamp = value => Math.max(0, Math.min(1, value));
  let frame, resumeFrame, repaint, paused = false, disposed = false;
  let cssWidth = sketch.width, ratio = 1;
  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    cssWidth = Math.max(1, rect.width || sketch.width);
    ratio = window.devicePixelRatio || 1;
    const width = Math.min(3840, Math.max(1, Math.round(cssWidth * ratio)));
    const height = Math.max(1, Math.round(width * sketch.height / sketch.width));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width; canvas.height = height;
    repaint?.();
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(canvas);
  window.addEventListener('resize', resize);
  function cancel() {
    cancelAnimationFrame(frame); resumeFrame = repaint = null;
    disposed = true;
    observer?.disconnect();
    window.removeEventListener('resize', resize);
  }
  signal.addEventListener('abort', cancel, { once: true });
  resize();
  function prepare() {
    ctx.setTransform(canvas.width / sketch.width, 0, 0, canvas.height / sketch.height, 0, 0);
    ctx.clearRect(0, 0, sketch.width, sketch.height);
  }
  function animate(duration, draw, onDone) {
    cancelAnimationFrame(frame);
    let elapsed = 0, previous = performance.now(), painted = -Infinity, progress = 0;
    repaint = () => { try { draw(progress); } catch (error) { cancel(); onError(error); } };
    function tick(now) {
      if (signal.aborted || paused || disposed) return;
      elapsed += now - previous; previous = now;
      progress = clamp(elapsed / duration);
      // A 240 Hz monitor still needs only 60 Canvas paints per second.
      if (progress === 1 || elapsed - painted >= 1000 / 60 - .1) {
        painted = elapsed;
        if (ratio !== (window.devicePixelRatio || 1)) resize();
        repaint?.();
      }
      if (disposed) return;
      if (progress < 1) frame = requestAnimationFrame(tick);
      else { resumeFrame = null; onDone?.(); }
    }
    resumeFrame = () => { previous = performance.now(); frame = requestAnimationFrame(tick); };
    if (!paused) resumeFrame();
  }
  function sketchIn(duration) {
    const strokes = sketch.paths.map(([length, points]) => {
      const path = new Path2D();
      path.moveTo(points[0], points[1]);
      for (let i = 2; i < points.length; i += 2) path.lineTo(points[i], points[i + 1]);
      return { length, path };
    });
    animate(duration, progress => {
      prepare();
      ctx.lineWidth = sketch.width / cssWidth;
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.strokeStyle = ctx.shadowColor = sketch.color;
      ctx.shadowBlur = 2 * canvas.width / cssWidth;
      for (const [i, stroke] of strokes.entries()) {
        const amount = clamp((progress - .48 * i / strokes.length) / .52);
        if (!amount) continue;
        ctx.setLineDash([stroke.length, stroke.length]);
        ctx.lineDashOffset = stroke.length * (1 - amount);
        ctx.globalAlpha = .62 + amount * .35;
        ctx.stroke(stroke.path);
      }
    });
  }
  function dissolve(duration, onDone) {
    cancelAnimationFrame(frame); resumeFrame = repaint = null;
    const sampleWidth = Math.max(128, Math.min(256, Math.round(cssWidth / 6)));
    const sampleHeight = Math.round(sampleWidth * sketch.height / sketch.width);
    const particles = [];
    prepare(); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    try {
      const sample = document.createElement('canvas');
      sample.width = sampleWidth; sample.height = sampleHeight;
      const sampler = sample.getContext('2d', { willReadFrequently: true });
      if (!sampler) return;
      sampler.drawImage(video, 0, 0, sampleWidth, sampleHeight);
      const { data } = sampler.getImageData(0, 0, sampleWidth, sampleHeight);
      for (let y = 1; y < sampleHeight; y += 3) {
        for (let x = 1; x < sampleWidth; x += 3) {
          const offset = (y * sampleWidth + x) * 4;
          const red = data[offset], green = data[offset + 1], blue = data[offset + 2];
          if (red + green + blue < 105) continue;
          particles.push({ x: x * sketch.width / sampleWidth, y: y * sketch.height / sampleHeight,
            color: `rgb(${red} ${green} ${blue})`, size: 1.5 + Math.random() * 3, drift: Math.random() * 30 - 15 });
        }
      }
    } catch { /* A decoded frame may have already been released. */ }
    if (!particles.length) return;
    animate(duration, progress => {
      prepare(); ctx.shadowBlur = 0;
      const unit = sketch.width / cssWidth;
      const scatter = 1 - (1 - clamp(progress / .58)) ** 3;
      const gather = clamp((progress - .58) / .42) ** 2;
      ctx.globalAlpha = Math.sin(Math.PI * progress) * .95;
      for (const dot of particles) {
        const spreadX = dot.x + (dot.x - sketch.width / 2) * .19 * scatter + dot.drift * unit * scatter;
        const spreadY = dot.y + (dot.y - sketch.height / 2) * .28 * scatter - 18 * unit * scatter;
        const x = spreadX + (sketch.width / 2 - spreadX) * gather * .66;
        const y = spreadY + (sketch.height / 2 - spreadY) * gather * .66;
        ctx.fillStyle = dot.color;
        ctx.fillRect(x, y, dot.size * unit, dot.size * unit);
      }
    }, onDone);
  }
  return { sketchIn, dissolve, cancel,
    pause() { paused = true; cancelAnimationFrame(frame); },
    resume() { if (paused && !disposed) { paused = false; resize(); resumeFrame?.(); } }
  };
}

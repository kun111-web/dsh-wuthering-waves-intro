window.__ModuleLoader__?.load?.({
  id: 'dsh-wuthering-waves-intro',
  factory: require => {
    const { createElement: h, useEffect, useRef, useState } = require('react');
    const version = '0.4.8';

    async function ensureRuntime(signal, ownedAssets) {
      if (window.__DSH_WUWA_INTRO__?.version === version) return;
      if (window.__DSH_WUWA_INTRO__ && !window.__DSH_WUWA_INTRO__.dispose) {
        throw new Error('请重新打开 DSH 以启用新版动画。');
      }
      const attach = (tag, filename) => new Promise((resolve, reject) => {
        if (signal.aborted) { reject(new Error('Cancelled')); return; }
        const element = document.createElement(tag);
        const url = `/dsh-wuthering-waves-intro/media/${filename}?v=${version}`;
        if (tag === 'link') { element.rel = 'stylesheet'; element.href = url; }
        else element.src = url;
        ownedAssets.add(element);
        const finish = error => {
          clearTimeout(timeout);
          signal.removeEventListener('abort', abort);
          element.onload = element.onerror = null;
          if (error) { element.remove(); ownedAssets.delete(element); reject(error); }
          else resolve();
        };
        const abort = () => finish(new Error('Cancelled'));
        const timeout = setTimeout(() => finish(new Error('动画组件加载超时')), 4500);
        element.onload = () => finish();
        element.onerror = () => finish(new Error('动画组件无法加载'));
        signal.addEventListener('abort', abort, { once: true });
        document.head.append(element);
      });
      // The normal path is the early host injection. This independent path also
      // works when a host changes the injection timing or omits that event.
      await attach('link', 'style.css');
      await attach('script', 'runtime.js');
      if (window.__DSH_WUWA_INTRO__?.version !== version) throw new Error('请重新打开 DSH 以加载动画。');
    }

    function Settings() {
      const [intro, setIntro] = useState(() => window.__DSH_WUWA_INTRO__);
      const [preferences, setPreferences] = useState(() => intro?.read());
      const [notice, setNotice] = useState('');
      const cancelPreview = useRef(null);
      useEffect(() => {
        const refresh = () => {
          const next = window.__DSH_WUWA_INTRO__;
          setIntro(next);
          setPreferences(next?.read());
        };
        window.addEventListener('dsh-wuwa-ready', refresh);
        return () => { window.removeEventListener('dsh-wuwa-ready', refresh); cancelPreview.current?.(); };
      }, []);
      if (!intro || !preferences) {
        return h('p', null, '请完全退出并重新打开 DSH，以加载入场动画。');
      }

      function save(change) {
        const next = { ...preferences, ...change };
        try {
          intro.save(next);
          setPreferences(next);
          setNotice('');
        } catch {
          setNotice('无法保存设置，请检查 DSH 的本地存储是否可用。');
        }
      }

      function preview() {
        setNotice('');
        cancelPreview.current = intro.play(preferences.character, {
          preview: true,
          mode: preferences.mode,
          onClose(reason) {
            cancelPreview.current = null;
            if (reason === 'unavailable' || reason === 'timeout') {
              setNotice(reason === 'timeout' ? '动画加载超时，可以再试一次或切换角色。' : '这段动画暂时无法播放，可以重试或切换角色。');
            }
          }
        });
      }

      return h('div', { className: 'dsh-wuwa-intro-settings' },
        h('div', { className: 'dsh-wuwa-intro-controls' },
          h('label', null, h('input', {
            type: 'checkbox',
            checked: preferences.enabled,
            onChange: event => save({ enabled: event.target.checked })
          }), '启动时播放'),
          h('button', { type: 'button', onClick: preview }, '预览所选角色')),
        h('label', { className: 'dsh-wuwa-intro-mode' }, '播放模式',
          h('select', { value: preferences.mode, onChange: event => save({ mode: event.target.value }) },
            h('option', { value: 'full' }, '完整播放'),
            h('option', { value: 'quick' }, '快速开场（约 3 秒）'))),
        h('p', { className: 'dsh-wuwa-intro-help' }, '时长包含线稿与退场效果，不含加载等待。点击画面或按 Esc 跳过；预览切到后台会暂停。'),
        notice && h('p', { role: 'status' }, notice),
        h('fieldset', null, h('legend', null, '选择角色'),
          h('div', { className: 'dsh-wuwa-intro-grid' }, intro.characters.map(({ id, name }) =>
            h('label', { key: id },
              h('input', {
                type: 'radio',
                name: 'dsh-wuwa-intro-character',
                value: id,
                checked: preferences.character === id,
                onChange: () => save({ character: id })
              }),
              h('span', { className: 'dsh-wuwa-intro-card' },
                h('img', { src: intro.media(id, 'webp'), alt: '', loading: 'lazy' }),
                h('span', null, name, h('small', null, `约 ${intro.plan(id, preferences.mode).totalSeconds.toFixed(1)} 秒`))))))));
    }

    async function apply(ctx) {
      const controller = new AbortController();
      const ownedAssets = new Set();
      let intro;
      ctx.on?.('dispose', () => {
        controller.abort();
        if (intro && window.__DSH_WUWA_INTRO__ === intro) intro.dispose();
        for (const element of ownedAssets) element.remove();
        ownedAssets.clear();
      });
      try {
        await ensureRuntime(controller.signal, ownedAssets);
        intro = window.__DSH_WUWA_INTRO__;
      } catch (error) {
        if (!controller.signal.aborted) console.warn('[鸣潮入场动画]', error);
      }
      if (controller.signal.aborted) return;
      if (typeof ctx.slots?.inject !== 'function' || typeof ctx.slots?.register !== 'function') {
        console.warn('[鸣潮入场动画] 设置入口暂不可用，启动动画仍独立运行。');
        return;
      }
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'wuthering-waves-intro',
        order: 30,
        label: () => '鸣潮入场动画'
      }, Settings));
      ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
        name: 'settings.section.icon',
        id: 'wuthering-waves-intro'
      }, ({ size = 16 }) => h('span', { style: { fontSize: size }, 'aria-hidden': 'true' }, '▷')));
    }

    return { inject: ['slots'], apply };
  }
});

// UI 控制器：绑定 DOM，状态渲染（顶栏/时间/飞行快捷/信息卡/HUD/下潜提示）
import { WORLD_DEFS } from '../content/schema.js';
import { formatKm, lightTravelText, kmToKmText } from '../util/units.js';

export class UI {
  constructor(engine, callbacks) {
    this.engine = engine;
    this.cb = callbacks || {};
    this.el = {};
    const ids = ['crumb','ruler','nav-buttons','time-buttons','fly-buttons','dock-help','infocard','info-title','info-sub',
      'info-facts','info-text','info-actions','info-close','info-schematic','hud-speed','hud-dist',
      'hud-clock','hud-mode','dive-hint','dive-text','btn-dive','fade','loading',
      'world-intro','intro-title','intro-text'];
    for (const id of ids) this.el[id] = document.getElementById(id);
    this._buildNav();
    this._buildTime();
    this._buildFly();
    this._bindInfoClose();
    this._bindDive();
  }

  _buildNav() {
    const nav = this.el['nav-buttons'];
    nav.innerHTML = '';
    for (const w of WORLD_DEFS) {
      const b = document.createElement('button');
      b.textContent = w.short;
      b.dataset.world = w.id;
      b.addEventListener('click', () => this.cb.onNav && this.cb.onNav(w.id));
      nav.appendChild(b);
    }
    this.navButtons = [...nav.children];
  }

  _buildTime() {
    const tb = this.el['time-buttons'];
    tb.innerHTML = '';
    const presets = [
      ['实时', 1], ['1天/秒', 86400], ['1月/秒', 2592000], ['1年/秒', 31557600],
      ['10年/秒', 315576000], ['千年/秒', 31557600000],
    ];
    for (const [label, rate] of presets) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.rate = String(rate);
      b.addEventListener('click', () => this.cb.onRate && this.cb.onRate(rate));
      tb.appendChild(b);
    }
    const pause = document.createElement('button');
    pause.id = 'btn-pause';
    pause.textContent = '⏸ 暂停';
    pause.addEventListener('click', () => this.cb.onPause && this.cb.onPause());
    tb.appendChild(pause);
    this.timeButtons = [...tb.children];
    this.pauseBtn = pause;
  }

  // 飞行快捷按钮：合成键盘事件，复用 input.js → main 的同一条按键管线
  // （边沿检测/临时接管/模式切换逻辑单一来源，不另开控制路径）
  _tapKey(key, hold = 160) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }));
    setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { key })), hold);
  }
  _buildFly() {
    const fb = this.el['fly-buttons'];
    fb.innerHTML = '';
    const defs = [
      ['视角', 'v', '切换 追踪/座舱/环绕'],
      ['自动驾驶', 'h', '选中目标寻的；无目标=自由航行'],
      ['引力模式', 'g', '引力滑行（开普勒轨道）'],
      ['刹车', 'x', '按住减速悬停；航行中点击退出自动'],
    ];
    for (const [label, key, title] of defs) {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = `${title}（${key.toUpperCase()}）`;
      b.dataset.key = key;
      if (key === 'x') {
        // 刹车是「按住」语义：点击 = 模拟按住 0.9s
        b.addEventListener('click', () => this._tapKey('x', 900));
      } else {
        b.addEventListener('click', () => this._tapKey(key));
      }
      fb.appendChild(b);
    }
    this.flyButtons = Object.fromEntries([...fb.children].map((b) => [b.dataset.key, b]));
  }

  // 每帧同步飞行按钮状态（自动驾驶 active 高亮，由 main 调用）
  setFlyState({ auto }) {
    const b = this.flyButtons && this.flyButtons.h;
    if (b) {
      b.classList.toggle('active', !!auto);
      b.textContent = auto ? '航行中' : '自动驾驶';
    }
  }

  _bindInfoClose() {
    this.el['info-close'].addEventListener('click', () => this.hideInfo());
  }
  _bindDive() {
    this.el['btn-dive'].addEventListener('click', () => this.cb.onDive && this.cb.onDive());
  }

  // ---- 顶栏 ----
  // 尺度阶梯：顶栏只显示「当前层 + 上下浮/沉快捷按钮」（避免与底部 dock 重复）
  setCrumb(curIdx) {
    const c = this.el['crumb'];
    c.innerHTML = '';
    // 完整尺度阶梯高亮当前
    WORLD_DEFS.forEach((w, i) => {
      if (i > 0) {
        const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '›';
        c.appendChild(sep);
      }
      const item = document.createElement(i === curIdx ? 'b' : 'a');
      item.textContent = w.short;
      item.style.textDecoration = 'none';
      item.style.color = 'inherit';
      if (i !== curIdx) {
        item.style.cursor = 'pointer';
        item.style.opacity = '0.55';
        item.addEventListener('click', (e) => { e.preventDefault(); this.cb.onNav && this.cb.onNav(w.id); });
        item.addEventListener('mouseenter', () => { item.style.opacity = '1'; });
        item.addEventListener('mouseleave', () => { item.style.opacity = '0.55'; });
      }
      c.appendChild(item);
    });
  }
  setRuler(text) { this.el['ruler'].textContent = text; }

  // ---- 时间 ----
  setTimeState({ clockLabel, rateLabel, paused, pausedEnabled }) {
    if (this.el['hud-clock']) this.el['hud-clock'].textContent = clockLabel;
    this.pauseBtn.textContent = paused ? '▶ 继续' : '⏸ 暂停';
    for (const b of this.timeButtons) {
      const r = parseFloat(b.dataset.rate);
      b.classList.toggle('active', !paused && Math.abs(r - this._curRate) < 0.01);
    }
  }
  setCurrentRate(rate) { this._curRate = rate; }

  // ---- 键位提示 ----
  setDockHelp(text) {
    if (this.el['dock-help']) this.el['dock-help'].innerHTML = text;
  }

  // ---- HUD ----
  setHud({ speedText, distText, modeText }) {
    if (this.el['hud-speed']) this.el['hud-speed'].textContent = speedText;
    if (this.el['hud-dist']) this.el['hud-dist'].textContent = distText;
    if (this.el['hud-mode'] && modeText !== undefined) this.el['hud-mode'].textContent = modeText;
  }

  // ---- 信息卡 ----
  showInfo(entity) {
    const d = entity;
    if (!d || !d.info) return;
    const info = d.info;
    this.el['info-title'].textContent = d.name + (d.en ? ` · ${d.en}` : '');
    this.el['info-sub'].textContent = info.sub || '';
    const facts = this.el['info-facts'];
    facts.innerHTML = '';
    for (const [k, v] of (info.facts || [])) {
      const row = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      row.appendChild(dt); row.appendChild(dd);
      facts.appendChild(row);
    }
    const txt = this.el['info-text'];
    txt.textContent = info.text || '';
    // 示意角标
    this.el['info-schematic'].classList.toggle('hidden', !d.schematic);
    // 操作区
    const acts = this.el['info-actions'];
    acts.innerHTML = '';
    if (d.dive) {
      const b = document.createElement('button');
      b.textContent = `下潜：进入${d.dive.targetName || d.dive.toWorld}`;
      b.addEventListener('click', () => this.cb.onDiveTo && this.cb.onDiveTo(d));
      acts.appendChild(b);
    }
    this.el['infocard'].classList.remove('hidden');
  }
  hideInfo() {
    this.el['infocard'].classList.add('hidden');
    if (this.cb.onInfoClose) this.cb.onInfoClose();
  }

  // ---- 下潜提示条 ----
  showDiveHint(entity) {
    this.el['dive-text'].textContent = `前方：${entity.name} —— ${entity.info.sub || ''}`;
    this.el['dive-hint'].classList.remove('hidden');
  }
  hideDiveHint() { this.el['dive-hint'].classList.add('hidden'); }

  // ---- 层介绍卡：进入新尺度时的导览（5 秒后自动淡出） ----
  showIntro(world) {
    if (!this.el['world-intro']) return;
    this.el['intro-title'].textContent = world.title;
    this.el['intro-text'].textContent = world.intro || '';
    const el = this.el['world-intro'];
    el.classList.remove('hidden');
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(this._introTimer);
    this._introTimer = setTimeout(() => this.hideIntro(), 5200);
  }
  hideIntro() {
    if (!this.el['world-intro']) return;
    this.el['world-intro'].classList.remove('show');
    clearTimeout(this._introTimer);
  }

  // ---- 转场 ----
  fadeOut(done) {
    this.el['fade'].classList.add('show');
    setTimeout(done, 350);
  }
  fadeIn() { this.el['fade'].classList.remove('show'); }
  showLoading(text) { this.el['loading'].textContent = text; this.el['loading'].classList.remove('hidden'); }
  hideLoading() { this.el['loading'].classList.add('hidden'); }
}

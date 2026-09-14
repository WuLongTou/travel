// UI 控制器：精简游戏 HUD（顶栏面包屑 / 飞行仪表 / 信息卡 / 操控提示）
import { WORLD_DEFS } from '../content/schema.js';

export class UI {
  constructor(engine, callbacks) {
    this.cb = callbacks || {};
    this.el = {};
    const ids = ['crumb','infocard','info-title','info-sub',
      'info-facts','info-text','info-actions','info-close','info-schematic',
      'hud-speed','hud-dist','hud-clock','hud-mode','hud-rate','hud-scale',
      'fade','loading','controls-hint','cockpit-frame','layer-intro',
      'mission-box','mission-idx','mission-title','mission-desc','discoveries',
      'hud-orbit','toast','title-screen','btn-start','btn-continue','btn-reset',
      'crosshair'];
    for (const id of ids) this.el[id] = document.getElementById(id);
    this._bindInfoClose();
    this._setupHintToggle();
  }

  _bindInfoClose() {
    this.el['info-close'].addEventListener('click', () => this.hideInfo());
  }

  // 操控提示：首次进入 8 秒后淡出，Tab 键可重新显示
  _setupHintToggle() {
    const hint = this.el['controls-hint'];
    if (!hint) return;
    this._hintTimer = setTimeout(() => { hint.classList.add('fade-out'); }, 8000);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        if (hint.classList.contains('fade-out')) {
          hint.classList.remove('fade-out');
          clearTimeout(this._hintTimer);
          this._hintTimer = setTimeout(() => { hint.classList.add('fade-out'); }, 6000);
        } else {
          hint.classList.add('fade-out');
        }
      }
    });
  }

  // ---- 顶栏 ----
  setCrumb(curIdx) {
    const c = this.el['crumb'];
    c.innerHTML = '';
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

  // ---- HUD 飞行仪表 ----
  setHud({ speedText, distText, modeText, orbitText }) {
    if (this.el['hud-speed']) this.el['hud-speed'].textContent = speedText;
    if (this.el['hud-dist']) this.el['hud-dist'].textContent = distText;
    if (this.el['hud-mode'] && modeText !== undefined) this.el['hud-mode'].textContent = modeText;
    if (this.el['hud-orbit'] && orbitText !== undefined) this.el['hud-orbit'].textContent = orbitText;
  }
  // 瞬时提示 toast：独立元素展示并自动淡出，不再挤占 HUD 模式行
  toast(text, secs = 4) {
    const el = this.el['toast'];
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), secs * 1000);
  }
  setDiscoveries(n) {
    if (this.el['discoveries']) this.el['discoveries'].textContent = n;
  }
  setTimeHud({ clockLabel, rateLabel }) {
    if (this.el['hud-clock']) this.el['hud-clock'].textContent = clockLabel;
    if (this.el['hud-rate']) this.el['hud-rate'].textContent = rateLabel;
  }
  setScaleHud(text) {
    if (this.el['hud-scale']) this.el['hud-scale'].textContent = text;
  }
  // 座舱框显隐：仅飞船座舱视角显示（上帝视角/追尾/环绕隐藏）
  setCockpitFrame(on) {
    if (this.el['cockpit-frame']) this.el['cockpit-frame'].classList.toggle('hidden', !on);
  }
  // 标题画面：有存档时显示继续/重开，否则仅开始；回调由 main 提供
  setupTitleScreen({ hasProgress, onStart, onContinue, onReset }) {
    const scr = this.el['title-screen'];
    if (!scr) return;
    if (hasProgress) {
      this.el['btn-continue'].classList.remove('hidden');
      this.el['btn-reset'].classList.remove('hidden');
      this.el['btn-start'].classList.add('hidden');
    }
    const close = () => scr.classList.add('hidden');
    this.el['btn-start'].addEventListener('click', () => { close(); onStart(); });
    this.el['btn-continue'].addEventListener('click', () => { close(); onContinue(); });
    this.el['btn-reset'].addEventListener('click', () => {
      if (window.confirm('确定清空进度并重新开始？')) onReset();
    });
  }
  // 准星发现脉冲：新发现时的扩散反馈
  pingCrosshair() {
    const el = this.el['crosshair'];
    if (!el) return;
    el.classList.remove('ping');
    void el.offsetWidth; // 强制重排以重启动画
    el.classList.add('ping');
    clearTimeout(this._pingTimer);
    this._pingTimer = setTimeout(() => el.classList.remove('ping'), 750);
  }

  // 任务链挂件：主线任务序号/标题/描述；info=null 时转通关态
  setMission(info) {
    const box = this.el['mission-box'];
    if (!box) return;
    if (!info) {
      box.classList.add('cleared');
      if (this.el['mission-idx']) this.el['mission-idx'].textContent = '✓';
      if (this.el['mission-title']) this.el['mission-title'].textContent = '全部完成';
      if (this.el['mission-desc']) this.el['mission-desc'].textContent = '已通关 · 自由航行';
      return;
    }
    box.classList.remove('cleared');
    if (this.el['mission-idx']) this.el['mission-idx'].textContent = `${info.idx}/${info.total}`;
    if (this.el['mission-title']) this.el['mission-title'].textContent = info.title;
    if (this.el['mission-desc']) this.el['mission-desc'].textContent = info.desc;
  }

  // 层介绍横幅：进入新尺度层时展示该层教学文案，数秒后淡出
  showLayerIntro(text, secs = 7) {
    const el = this.el['layer-intro'];
    if (!el || !text) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._introTimer);
    this._introTimer = setTimeout(() => el.classList.remove('show'), secs * 1000);
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
    this.el['info-schematic'].classList.toggle('hidden', !d.schematic);
    // 操作区
    const acts = this.el['info-actions'];
    acts.innerHTML = '';
    if (d.dive) {
      const b = document.createElement('button');
      b.textContent = `进入${d.dive.targetName || d.dive.toWorld}`;
      b.addEventListener('click', () => this.cb.onDiveTo && this.cb.onDiveTo(d));
      acts.appendChild(b);
    }
    this.el['infocard'].classList.remove('hidden');
  }
  hideInfo() {
    this.el['infocard'].classList.add('hidden');
    if (this.cb.onInfoClose) this.cb.onInfoClose();
  }

  // ---- 转场 ----
  fadeOut(done) {
    const el = this.el['fade'];
    el.classList.remove('hidden');
    // 强制重排后再添加 show 类触发 transition
    el.offsetHeight;
    el.classList.add('show');
    setTimeout(done, 300);
  }
  fadeIn() {
    const el = this.el['fade'];
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), 350);
  }
  showLoading(text) { this.el['loading'].textContent = text; this.el['loading'].classList.remove('hidden'); }
  hideLoading() { this.el['loading'].classList.add('hidden'); }
}

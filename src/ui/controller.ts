// UI 控制器：精简游戏 HUD（顶栏面包屑 / 飞行仪表 / 信息卡 / 操控提示）
import type * as THREE from 'three';
import { WORLD_DEFS } from '../content/schema.js';

/** UI 事件回调集合（main 装配注入） */
export interface UICallbacks {
  onNav?: (worldId: string) => void;
  onDiveTo?: (entity: import('../types.js').Entity) => void;
  onInfoClose?: () => void;
}

export class UI {
  cb: UICallbacks;
  /** DOM 元素表：id 与 index.html 一一对应，集中非空断言 */
  el: Record<string, HTMLElement>;
  private _toastTimer: ReturnType<typeof setTimeout> | undefined;
  private _pingTimer: ReturnType<typeof setTimeout> | undefined;
  private _introTimer: ReturnType<typeof setTimeout> | undefined;
  private _hintTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(_engine: THREE.WebGLRenderer, callbacks: UICallbacks) {
    this.cb = callbacks || {};
    this.el = {};
    const ids = ['crumb','infocard','info-title','info-sub',
      'info-facts','info-text','info-actions','info-close','info-schematic',
      'hud-speed','hud-dist','hud-clock','hud-mode','hud-rate','hud-scale',
      'fade','loading','controls-hint','cockpit-frame','layer-intro',
      'mission-box','mission-idx','mission-title','mission-desc','discoveries',
      'hud-orbit','toast','title-screen','btn-start','btn-continue','btn-reset',
      'crosshair','settings-panel','set-volume','set-shake','set-close','btn-title-settings','title-progress',
      'pause-menu','btn-pause-resume','btn-pause-settings','btn-pause-title',
      'victory-screen','victory-stats','btn-victory-continue',
      'btn-pause-codex','pause-stats',
      'codex-panel','codex-progress','codex-close','codex-body','set-quality'];
    for (const id of ids) this.el[id] = document.getElementById(id) as HTMLElement;
    this._bindInfoClose();
    this._setupHintToggle();
  }

  private _bindInfoClose(): void {
    this.el['info-close'].addEventListener('click', () => this.hideInfo());
  }

  // 操控提示：首次进入 8 秒后淡出，Tab 键可重新显示
  private _setupHintToggle(): void {
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
  setCrumb(curIdx: number): void {
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
  setHud({ speedText, distText, modeText, orbitText }: { speedText: string; distText: string; modeText?: string; orbitText?: string }): void {
    if (this.el['hud-speed']) this.el['hud-speed'].textContent = speedText;
    if (this.el['hud-dist']) this.el['hud-dist'].textContent = distText;
    if (this.el['hud-mode'] && modeText !== undefined) this.el['hud-mode'].textContent = modeText;
    if (this.el['hud-orbit'] && orbitText !== undefined) this.el['hud-orbit'].textContent = orbitText;
  }
  // 瞬时提示 toast：独立元素展示并自动淡出，不再挤占 HUD 模式行
  toast(text: string, secs = 4): void {
    const el = this.el['toast'];
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), secs * 1000);
  }
  setDiscoveries(n: number): void {
    if (this.el['discoveries']) this.el['discoveries'].textContent = String(n);
  }
  setTimeHud({ clockLabel, rateLabel }: { clockLabel: string; rateLabel: string }): void {
    if (this.el['hud-clock']) this.el['hud-clock'].textContent = clockLabel;
    if (this.el['hud-rate']) this.el['hud-rate'].textContent = rateLabel;
  }
  setScaleHud(text: string): void {
    if (this.el['hud-scale']) this.el['hud-scale'].textContent = text;
  }
  // 座舱框显隐：仅飞船座舱视角显示（上帝视角/追尾/环绕隐藏）
  setCockpitFrame(on: boolean): void {
    if (this.el['cockpit-frame']) this.el['cockpit-frame'].classList.toggle('hidden', !on);
  }
  // 标题画面：按钮回调绑定一次；显隐与存档概览由 showTitleScreen 控制
  //（初始进入与游戏中「回到标题」复用同一入口）
  setupTitleScreen({ onStart, onContinue, onReset, onOpenSettings }: { onStart: () => void; onContinue: () => void; onReset: () => void; onOpenSettings: () => void }): void {
    const scr = this.el['title-screen'];
    if (!scr) return;
    this.el['btn-title-settings'].addEventListener('click', () => onOpenSettings && onOpenSettings());
    this.el['btn-start'].addEventListener('click', () => { scr.classList.add('hidden'); onStart && onStart(); });
    this.el['btn-continue'].addEventListener('click', () => { scr.classList.add('hidden'); onContinue && onContinue(); });
    this.el['btn-reset'].addEventListener('click', () => {
      if (window.confirm('确定清空进度并重新开始？')) onReset && onReset();
    });
  }
  // 显示标题层并按当前存档刷新按钮显隐与进度概览
  showTitleScreen({ hasProgress, progressText = '' }: { hasProgress: boolean; progressText?: string }): void {
    const scr = this.el['title-screen'];
    if (!scr) return;
    if (this.el['title-progress']) this.el['title-progress'].textContent = progressText;
    this.el['btn-continue'].classList.toggle('hidden', !hasProgress);
    this.el['btn-reset'].classList.toggle('hidden', !hasProgress);
    this.el['btn-start'].classList.toggle('hidden', !!hasProgress);
    scr.classList.remove('hidden');
  }
  // 暂停菜单：Esc/手柄 Start 开关；回调绑定一次，焦点落首项供手柄/键盘导航
  setupPauseMenu({ onResume, onCodex, onSettings, onTitle }: {
    onResume: () => void; onCodex: () => void; onSettings: () => void; onTitle: () => void;
  }): void {
    this.el['btn-pause-resume'].addEventListener('click', () => onResume());
    this.el['btn-pause-codex'].addEventListener('click', () => onCodex());
    this.el['btn-pause-settings'].addEventListener('click', () => onSettings());
    this.el['btn-pause-title'].addEventListener('click', () => onTitle());
    this.el['codex-close'].addEventListener('click', () => this.hideCodex());
  }
  // 暂停菜单统计行：任务/发现/航程（main 传格式化好的 HTML 片段）
  setPauseStats(html: string): void {
    if (this.el['pause-stats']) this.el['pause-stats'].innerHTML = html;
  }
  // 发现图鉴：main 传每层渲染数据（纯展示）
  showCodex(layers: { name: string; found: number; total: number;
    items: { name: string; found: boolean }[]; explored: boolean }[], progressText: string): void {
    const panel = this.el['codex-panel'];
    if (!panel) return;
    this.el['codex-progress'].textContent = progressText;
    const body = this.el['codex-body'];
    body.innerHTML = '';
    for (const l of layers) {
      const sec = document.createElement('div');
      sec.className = 'codex-layer';
      const k = document.createElement('div');
      k.className = 'codex-layer-k';
      k.innerHTML = `${l.name} <b>${l.explored ? `${l.found}/${l.total}` : '· 尚未抵达'}</b>`;
      sec.appendChild(k);
      const grid = document.createElement('div');
      grid.className = 'codex-grid';
      if (!l.explored) {
        const hint = document.createElement('span');
        hint.className = 'codex-unexplored';
        hint.textContent = '航行抵达此尺度后收录清单';
        grid.appendChild(hint);
      } else {
        for (const it of l.items) {
          const chip = document.createElement('span');
          chip.className = it.found ? 'codex-item' : 'codex-item locked';
          chip.textContent = it.found ? it.name : '？？？ 未发现';
          grid.appendChild(chip);
        }
      }
      sec.appendChild(grid);
      body.appendChild(sec);
    }
    panel.classList.remove('hidden');
  }
  hideCodex(): void {
    if (this.el['codex-panel']) this.el['codex-panel'].classList.add('hidden');
  }
  showPauseMenu(): void {
    const m = this.el['pause-menu'];
    if (!m) return;
    m.classList.remove('hidden');
    this.el['btn-pause-resume'].focus();
  }
  hidePauseMenu(): void {
    if (this.el['pause-menu']) this.el['pause-menu'].classList.add('hidden');
  }
  // 菜单项按钮列表（手柄 dpad 焦点导航用，顺序与视觉一致）
  pauseMenuButtons(): HTMLElement[] {
    return ['btn-pause-resume', 'btn-pause-codex', 'btn-pause-settings', 'btn-pause-title'].map((id) => this.el[id]);
  }
  // 通关结算：stats 为 [label, value] 数组；按钮回调绑定一次
  setupVictory(onContinue: () => void): void {
    this.el['btn-victory-continue'].addEventListener('click', () => onContinue && onContinue());
  }
  showVictory(stats: [string, string][]): void {
    const v = this.el['victory-screen'];
    if (!v) return;
    const dl = this.el['victory-stats'];
    dl.innerHTML = '';
    for (const [k, val] of stats) {
      const row = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = val;
      row.appendChild(dt); row.appendChild(dd);
      dl.appendChild(row);
    }
    v.classList.remove('hidden');
    this.el['btn-victory-continue'].focus();
  }
  hideVictory(): void {
    if (this.el['victory-screen']) this.el['victory-screen'].classList.add('hidden');
  }
  // 设置面板：挂滑条/开关/画质档回调并展示；hide 收起
  showSettings({ volume, shake, quality, onVolume, onShake, onQuality, onClose }: {
    volume: number; shake: boolean; quality: 'low' | 'medium' | 'high';
    onVolume: (v: number) => void; onShake: (on: boolean) => void;
    onQuality: (q: 'low' | 'medium' | 'high') => void; onClose: () => void;
  }): void {
    const panel = this.el['settings-panel'];
    const vol = this.el['set-volume'] as HTMLInputElement;
    const shakeEl = this.el['set-shake'] as HTMLInputElement;
    vol.value = String(volume);
    shakeEl.checked = shake;
    vol.oninput = (e) => onVolume(Number((e.target as HTMLInputElement).value));
    shakeEl.onchange = (e) => onShake((e.target as HTMLInputElement).checked);
    // 画质三档：当前档高亮，点击即切换
    const qGroup = this.el['set-quality'];
    const qBtns = [...qGroup.querySelectorAll('button')] as HTMLButtonElement[];
    const sync = () => qBtns.forEach((b) => b.classList.toggle('active', b.dataset.q === quality));
    sync();
    qBtns.forEach((b) => {
      b.onclick = () => {
        quality = b.dataset.q as 'low' | 'medium' | 'high';
        sync();
        onQuality(quality);
      };
    });
    this.el['set-close'].onclick = () => onClose();
    panel.classList.remove('hidden');
  }
  hideSettings(): void {
    if (this.el['settings-panel']) this.el['settings-panel'].classList.add('hidden');
  }

  // 准星发现脉冲：新发现时的扩散反馈
  pingCrosshair(): void {
    const el = this.el['crosshair'];
    if (!el) return;
    el.classList.remove('ping');
    void el.offsetWidth; // 强制重排以重启动画
    el.classList.add('ping');
    clearTimeout(this._pingTimer);
    this._pingTimer = setTimeout(() => el.classList.remove('ping'), 750);
  }

  // 任务链挂件：主线任务序号/标题/描述；info=null 时转通关态
  setMission(info: { idx: number; total: number; title: string; desc: string } | null): void {
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
  showLayerIntro(text: string, secs = 7): void {
    const el = this.el['layer-intro'];
    if (!el || !text) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._introTimer);
    this._introTimer = setTimeout(() => el.classList.remove('show'), secs * 1000);
  }

  // ---- 信息卡 ----
  showInfo(entity: import('../types.js').Entity): void {
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
  hideInfo(): void {
    this.el['infocard'].classList.add('hidden');
    if (this.cb.onInfoClose) this.cb.onInfoClose();
  }

  // ---- 转场 ----
  fadeOut(done: () => void = () => {}): void {
    const el = this.el['fade'];
    el.classList.remove('hidden');
    // 强制重排后再添加 show 类触发 transition
    el.offsetHeight;
    el.classList.add('show');
    setTimeout(done, 300);
  }
  fadeIn(): void {
    const el = this.el['fade'];
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), 350);
  }
  showLoading(text: string): void { this.el['loading'].textContent = text; this.el['loading'].classList.remove('hidden'); }
  hideLoading(): void { this.el['loading'].classList.add('hidden'); }
}

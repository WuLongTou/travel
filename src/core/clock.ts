// 宇宙时钟：驱动轨道相位与全局模拟时间；探测球运动速度另算（见 probe.js）。
// 时间倍率语义：layer 里定义了「此层时间加速的合理上限」——
//   太阳系内观察轨道需要天/年尺度；宇宙网层年尺度无意义（那里只导航）。
import { clamp } from '../util/math.js';

export class SimClock {
  t = 0; // 模拟秒（挂钟意义上的物理时间流逝）
  rate = 1; // 相对真实时间的倍率（1 = 实时）
  paused = false;

  // 真实帧步进 dt（真实秒）。返回本帧模拟时间增量。
  advance(dt: number): number {
    if (this.paused) return 0;
    const d = dt * this.rate;
    this.t += d;
    return d;
  }

  setRate(r: number): void {
    // 上限与 main.js TIME_RATES 尾档（千亿年/秒，宇宙网层跨尺度航行）
    this.rate = clamp(r, 0, 3.15576e18);
  }

  // 时间显示：自适应单位（教育友好：秒→分钟→天→年→亿年）
  timeLabel(): string {
    const s = this.t;
    if (s < 120) return s.toFixed(0) + ' 秒';
    if (s < 7200) return (s / 60).toFixed(1) + ' 分钟';
    if (s < 172800) return (s / 3600).toFixed(1) + ' 小时';
    if (s < 365.25 * 86400 * 100) return (s / 86400).toFixed(1) + ' 天';
    const yr = s / (365.25 * 86400);
    if (yr < 1e6) return yr.toFixed(1) + ' 年';
    if (yr < 1e9) return (yr / 1e6).toFixed(2) + ' 百万年';
    return (yr / 1e9).toFixed(2) + ' 十亿年';
  }

  rateLabel(): string {
    if (this.paused) return '已暂停';
    if (this.rate < 1.0001) return '实时';
    if (this.rate < 60) return '×' + this.rate.toFixed(1);
    const YR = 365.25 * 86400;
    if (this.rate < 86400 * 365.25) {
      // 转为“1 秒 = X”或“1 分钟 = X”友好表达
      if (this.rate < 86400) return '1 秒 = ' + this.rate.toFixed(0) + ' 秒';
      if (this.rate < 3600 * 24 * 30) return '1 分钟 = ' + (this.rate / 60).toFixed(1) + ' 分钟';
      return '1 秒 ≈ ' + (this.rate / 86400).toFixed(1) + ' 天';
    }
    if (this.rate < YR * 1e4) return '1 秒 ≈ ' + (this.rate / YR).toFixed(0) + ' 年';
    if (this.rate < YR * 1e6) return '1 秒 ≈ ' + (this.rate / YR / 1e4).toFixed(0) + ' 万年';
    if (this.rate < YR * 1e8) return '1 秒 ≈ ' + (this.rate / YR / 1e6).toFixed(0) + ' 百万年';
    if (this.rate < YR * 1e10) return '1 秒 ≈ ' + (this.rate / YR / 1e8).toFixed(0) + ' 亿年';
    return '1 秒 ≈ ' + (this.rate / YR / 1e10).toFixed(0) + ' 千亿年';
  }
}

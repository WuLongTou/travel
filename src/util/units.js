// 单位与换算 · 全项目唯一真源
// 常量以研究子代理核实结果为准（DESIGN.md 关键常量），此处为常用标准值：
//  AU/ly/pc 采用 IAU 定义值；光速为精确值。
export const C_KM_S = 299792.458; // 光速 km/s（精确定义）
export const AU_KM = 149597870.7; // 1 天文单位 km（IAU 精确定义）
export const LY_KM = 9460730472580.8; // 1 光年 km（IAU：光在真空中一年）
export const PC_LY = 3.261563777; // 1 秒差距 ly
export const YR_S = 365.25 * 86400; // 1 儒略年（天文年历标准）

export const AU = { km: AU_KM, m: AU_KM * 1000 };
export const LY = { km: LY_KM, m: LY_KM * 1000 };
export const PC = { ly: PC_LY, km: LY_KM * PC_LY };

// 世界单位制：每个尺度层定义 1 世界单位 = 多少 km / 多少光年
// 渲染用对数压缩时以“世界单位内的真实比例”为准，尺度栏另算。
export const WORLD_SCALES = {
  solar: { name: '太阳系', unitKm: AU_KM, unitLabel: 'AU', scale: 1 },
  stellar: { name: '星际近邻', unitKm: LY_KM, unitLabel: 'ly', scale: 1 },
  galaxy: { name: '银河系', unitKm: LY_KM, unitLabel: 'kpc', scale: 1 / 1000 },
  local: { name: '本星系群', unitKm: LY_KM, unitLabel: 'Mpc', scale: 1 / 1000000 },
  super: { name: '室女超星系团', unitKm: LY_KM, unitLabel: 'Mpc', scale: 1 / 1000000 },
  cosmos: { name: '可观测宇宙', unitKm: LY_KM, unitLabel: 'Gpc', scale: 1 / 1000000000 },
};

// 便捷：把“以某尺度的世界单位给出的数”转成 km/ly（内容层用）
export function kmToLy(km) { return km / LY_KM; }
export function lyToKm(ly) { return ly * LY_KM; }
export function auToKm(au) { return au * AU_KM; }
export function pcToLy(pc) { return pc * PC_LY; }
export function kpcToLy(kpc) { return kpc * 1000 * PC_LY; }
export function mpcToLy(mpc) { return mpc * 1e6 * PC_LY; }
export function gpcToLy(gpc) { return gpc * 1e9 * PC_LY; }

// 展示友好格式化：输入 km，输出带自适应单位的中文串（提示可包含 ± 与来源）
export function formatKm(km) {
  if (!isFinite(km)) return '—';
  const a = Math.abs(km);
  if (a >= LY_KM * 1e9) return (km / LY_KM / 1e9).toFixed(2) + ' Gpc';
  if (a >= LY_KM * 1e6) return (km / LY_KM / 1e6).toFixed(2) + ' Mpc';
  if (a >= LY_KM * 1e3) return (km / LY_KM / 1e3).toFixed(1) + ' kpc';
  if (a >= LY_KM) return (km / LY_KM).toFixed(2) + ' 光年';
  if (a >= AU_KM) return (km / AU_KM).toFixed(2) + ' AU';
  if (a >= 1e6) return (km / 1e6).toFixed(1) + ' 百万 km';
  return Math.round(km).toLocaleString('zh-CN') + ' km';
}

// 光速旅程时间（输入 km，返回“光要走多久”的友好中文，跨尺度教学必备）
export function lightTravelText(km) {
  const s = km / C_KM_S;
  if (s < 1) return '不足 1 秒';
  if (s < 90) return s.toFixed(1) + ' 秒';
  const min = s / 60;
  if (min < 90) return min.toFixed(1) + ' 分钟';
  const hr = min / 60;
  if (hr < 48) return hr.toFixed(1) + ' 小时';
  const d = hr / 24;
  if (d < 365) return d.toFixed(1) + ' 天';
  const yr = d / 365.25;
  if (yr < 1000) return yr.toFixed(1) + ' 年';
  return (yr / 1000).toFixed(1) + ' 千年';
}

export function kmToKmText(km) { return formatKm(km); }

// 颜色工具（渲染用）：黑体色温 → sRGB hex（按 K 分段插值近似）
// 依据：黑体辐射色度近似（Planckian locus 常用查找表线性化）
const TBL = [
  [1000, '#ff3800'], [1500, '#ff6a00'], [2000, '#ff8f2a'], [3000, '#ffb366'],
  [4000, '#ffcc99'], [5000, '#ffe6cc'], [6000, '#ffffff'], [8000, '#dbe9ff'],
  [10000, '#c8dcff'], [15000, '#aac9ff'], [25000, '#8fb4ff'], [40000, '#7aa2ff'],
];
export function tempToHex(tempK) {
  let t = tempK;
  if (t < 1000) t = 1000;
  if (t > 40000) t = 40000;
  for (let i = 0; i < TBL.length - 1; i++) {
    const [t1, c1] = TBL[i];
    const [t2, c2] = TBL[i + 1];
    if (t >= t1 && t <= t2) {
      const f = (t - t1) / (t2 - t1);
      return lerpHex(c1, c2, f);
    }
  }
  return '#ffffff';
}
function lerpHex(a, b, f) {
  const pa = hexRgb(a), pb = hexRgb(b);
  return rgbHex(
    Math.round(pa[0] + (pb[0] - pa[0]) * f),
    Math.round(pa[1] + (pb[1] - pa[1]) * f),
    Math.round(pa[2] + (pb[2] - pa[2]) * f),
  );
}
export function hexRgb(h) {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
export function rgbHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

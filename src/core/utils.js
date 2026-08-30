// 跨域共用的纯工具函数（模拟域 + 渲染域都引用）。
// 目录梳理第二步：从 src/cosmos.js 抽离，两边 import 复用。

// 均匀单位球方向（scale 缩放模长）。用于粒子/成员/候选方向的随机采样。
export function randomUnit(scale = 1) {
  const z = Math.random() * 2 - 1;
  const phi = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [Math.cos(phi) * r * scale, z * scale, Math.sin(phi) * r * scale];
}

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

// ---- 椭圆轨道（开普勒）----
// 布局成员的轨道角统一存"平近点角"M：随时间线性推进，与远景成员点云的
// "起始角 + spin × speed"公式严格一致（预览/细节交接不跳变）。
// e>0 时经开普勒方程 M = E - e·sinE（牛顿迭代 4 次）解出真近点角 ν，
// r = a(1-e²)/(1+e·cosν)——近快远慢（第二定律），轨迹是椭圆。
// e=0 时 θ=M、r=a，与旧的匀速圆轨道完全等价，既有布局行为不变。
// 返回共享暂存 [极角, 半径]，调用方立即取出，勿跨调用持有。
const _orbitPolar = [0, 0];
export function orbitPolar(o, M) {
  const e = o.e || 0;
  if (!e) {
    _orbitPolar[0] = M;
    _orbitPolar[1] = o.radius;
    return _orbitPolar;
  }
  const argp = o.argp || 0;
  const Mn = M - argp;
  let E = Mn;
  for (let k = 0; k < 4; k++) {
    E -= (E - e * Math.sin(E) - Mn) / (1 - e * Math.cos(E));
  }
  const nu = 2 * Math.atan2(
    Math.sqrt(1 + e) * Math.sin(E / 2),
    Math.sqrt(1 - e) * Math.cos(E / 2),
  );
  _orbitPolar[0] = argp + nu;
  _orbitPolar[1] = o.radius * (1 - e * e) / (1 + e * Math.cos(nu));
  return _orbitPolar;
}

// 确定性伪随机（0..1）：同一 seed.idx 永远得到同一值，用于天体色调等
export function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

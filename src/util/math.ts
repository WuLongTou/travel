// 极简三维向量/数学辅助（内容层用纯数组，引擎用 THREE）
type Vec3 = [number, number, number];
// 避免为小功能引入依赖：数组 [x,y,z] 逐元素运算。

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth01 = (t: number): number => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

export const v3 = (x = 0, y = 0, z = 0): [number, number, number] => [x, y, z];
export const vAdd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vSub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vScale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const vDot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vLen = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export function vNorm(a: Vec3): Vec3 {
  const l = vLen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
export function vCross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

// 可复现伪随机（mulberry32）
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

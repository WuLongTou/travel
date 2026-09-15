// 太阳系层数据表（距离/半径/轨道周期等）
// 数值来源标注：research 子代理回表后替换 `_S` 前缀并移除 APPROX。
// 采用 NASA 行星概况表 / IAU 常用值。当前为「标准参考值」：数值为公认近似，
// 精确到教学所需位数；回表后再以实际抓取页修正。
// units: 轨道半径 aAU(AU)，半径 rKm，质量 kg，周期…
export interface SunRec { id: string; name: string; en: string; type: string; rKm: number; massKg: number; tempK: number; spectral: string; lumLSun: number; ageGy: number; source: string }
export interface PlanetRec { id: string; name: string; en: string; type: string; aAU: number; e: number; rKm: number; massKg: number; periodD: number; rotH: number; moons: number; rings: boolean; tempK: number; color: string; desc: string; tiltDeg?: number }
export interface MoonRec { id: string; name: string; en: string; aKm: number; rKm: number; massKg?: number; periodD: number; color: string }

export const SOL: SunRec = {
  id: 'sun', name: '太阳', en: 'Sun', type: 'sun',
  rKm: 696000, massKg: 1.989e30, tempK: 5778, spectral: 'G2V',
  lumLSun: 1, ageGy: 4.6, source: 'standard',
};
// 每行星信息（用于 info 卡）
export const PLANETS: PlanetRec[] = [
  { id: 'mercury', name: '水星', en: 'Mercury', type: 'planet', aAU: 0.387, e: 0.206, rKm: 2439.7, massKg: 3.30e23, periodD: 87.97, rotH: 1407.6, moons: 0, rings: false, tempK: 440, color: '#b5a396', desc: '离太阳最近、温差最大的岩石行星。' },
  { id: 'venus', name: '金星', en: 'Venus', type: 'planet', aAU: 0.723, e: 0.007, rKm: 6051.8, massKg: 4.87e24, periodD: 224.70, rotH: -5832.5, moons: 0, rings: false, tempK: 737, color: '#e3c896', desc: '浓厚 CO₂ 大气与失控温室效应；自转方向相反且极慢。' },
  { id: 'earth', name: '地球', en: 'Earth', type: 'planet', aAU: 1.000, e: 0.017, rKm: 6371, massKg: 5.97e24, periodD: 365.25, rotH: 23.93, moons: 1, rings: false, tempK: 288, color: '#4f8fd8', desc: '目前已知唯一孕育生命的行星；液态水覆盖 71% 表面。' },
  { id: 'mars', name: '火星', en: 'Mars', type: 'planet', aAU: 1.524, e: 0.093, rKm: 3389.5, massKg: 6.42e23, periodD: 686.98, rotH: 24.62, moons: 2, rings: false, tempK: 210, color: '#d2824a', desc: '红色源于氧化铁；奥林帕斯山为太阳系最高火山。' },
  { id: 'jupiter', name: '木星', en: 'Jupiter', type: 'planet', aAU: 5.203, e: 0.048, rKm: 69911, massKg: 1.898e27, periodD: 4332.6, rotH: 9.93, moons: 95, rings: true, tempK: 165, color: '#e0b88e', desc: '太阳系最大行星，质量是其余行星总和的 2.5 倍。' },
  { id: 'saturn', name: '土星', en: 'Saturn', type: 'planet', aAU: 9.537, e: 0.054, rKm: 58232, massKg: 5.68e26, periodD: 10759.2, rotH: 10.66, moons: 274, rings: true, tempK: 134, color: '#e6d3a8', desc: '壮观行星环主要由冰粒构成，平均密度小于水。' },
  { id: 'uranus', name: '天王星', en: 'Uranus', type: 'planet', aAU: 19.19, e: 0.047, rKm: 25362, massKg: 8.68e25, periodD: 30688.5, rotH: -17.24, moons: 28, rings: true, tempK: 76, color: '#9ad9dc', desc: '自转轴倾斜 98°，几乎“躺着”绕太阳公转。' },
  { id: 'neptune', name: '海王星', en: 'Neptune', type: 'planet', aAU: 30.07, e: 0.009, rKm: 24622, massKg: 1.02e26, periodD: 60182, rotH: 16.11, moons: 16, rings: true, tempK: 72, color: '#5f86d6', desc: '太阳系最远的行星，风速可达 2100 km/h。' },
];
// 主要卫星（随母行星渲染小点）
export const MOONS: Record<string, MoonRec[]> = {
  earth: [{ id: 'moon', name: '月球', en: 'Moon', aKm: 384400, rKm: 1737.4, massKg: 7.34e22, periodD: 27.32, color: '#c8c8cc' }],
  mars: [
    { id: 'phobos', name: '火卫一', en: 'Phobos', aKm: 9376, rKm: 11.3, periodD: 0.319, color: '#a08a78' },
    { id: 'deimos', name: '火卫二', en: 'Deimos', aKm: 23463, rKm: 6.2, periodD: 1.263, color: '#a08a78' },
  ],
  jupiter: [
    { id: 'io', name: '木卫一', en: 'Io', aKm: 421700, rKm: 1821.6, periodD: 1.769, color: '#e8d27a' },
    { id: 'europa', name: '木卫二', en: 'Europa', aKm: 671034, rKm: 1560.8, periodD: 3.551, color: '#d8c9b4' },
    { id: 'ganymede', name: '木卫三', en: 'Ganymede', aKm: 1070412, rKm: 2634.1, periodD: 7.155, color: '#9a8f80' },
    { id: 'callisto', name: '木卫四', en: 'Callisto', aKm: 1882709, rKm: 2410.3, periodD: 16.689, color: '#8a7a66' },
  ],
  saturn: [
    { id: 'titan', name: '土卫六', en: 'Titan', aKm: 1221870, rKm: 2574.7, periodD: 15.945, color: '#d8a44a' },
    { id: 'rhea', name: '土卫五', en: 'Rhea', aKm: 527108, rKm: 763.8, periodD: 4.518, color: '#c8c0b4' },
  ],
};
// 小行星带示意（半径范围 AU）
export const ASTEROID_BELT: { id: string; name: string; en: string; aMin: number; aMax: number; count: number; color: string } = { id: 'belt', name: '小行星带', en: 'Asteroid belt', aMin: 2.2, aMax: 3.2, count: 1400, color: '#a89880' };
// 柯伊伯带示意
export const KUIPER_BELT: { id: string; name: string; en: string; aMin: number; aMax: number; count: number; color: string } = { id: 'kuiper', name: '柯伊伯带', en: 'Kuiper belt', aMin: 30, aMax: 50, count: 2000, color: '#8fb8d8' };
export const SOURCE_NOTE = '数值为 IAU/NASA 常用标准值；research 回表后逐项标注来源。';

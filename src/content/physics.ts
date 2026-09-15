// 分层真实物理口径 · 全项目真源
// 太阳系层落地真实口径后的同一配方推广到其余五层：
//   GM = G·M 真实值（按层世界单位换算）、碰撞半径 = 真实半径、
//   飞船性能全层统一（0.6 m/s²、巡航 ≤300 km/s ≈0.001c，永远低于光速），
//   跨层航行的节奏全部由自动时间倍率承担（main.js TIME_RATES）。
// GM☉（IAU）= GM_SUN_KM（units.js），按层单位的立方换算：
import { GM_SUN_KM, LY_KM, PC_LY } from '../util/units.js';

// 层单位换算（km）：1 kpc = 1000 pc，1 Mpc = 1e6 pc，1 Gpc = 1e9 pc
export const KPC_KM = 1000 * PC_LY * LY_KM;
export const MPC_KM = 1e6 * PC_LY * LY_KM;
export const GPC_KM = 1e9 * PC_LY * LY_KM;

// GM☉ 换算到各层单位制（层单位³/s²）
export const GM_SUN_LY = GM_SUN_KM / (LY_KM ** 3);   // ≈1.568e-28 ly³/s²
export const GM_SUN_KPC = GM_SUN_KM / (KPC_KM ** 3); // ≈4.514e-39 kpc³/s²
export const GM_SUN_MPC = GM_SUN_KM / (MPC_KM ** 3); // ≈4.514e-48 Mpc³/s²

// 飞船性能按层单位换算（unitKm = 1 层单位的 km 数）
export const shipMaxSpeed = (unitKm: number): number => 300 / unitKm;              // 300 km/s
export const shipAcc = (unitKm: number): number => 0.6 / (unitKm * 1000);          // 0.6 m/s²

// 飞行器真实包络半径（km）：旅行者级探测器高增益天线 3.7 m，全展开
// 包络取 ~8 m 半径（教学近似）。船在一切层、一切缩放下都按此真实尺寸
// 渲染——拉远即按透视变小成光点（亚像素标记接管），绝不随视距放大
export const SHIP_RADIUS_KM = 0.008;

// 船半径换算到层世界单位（船模型半长 ≈1 单位，scale=该值即真实尺寸）
export const shipRadiusUnits = (unitKm: number): number => SHIP_RADIUS_KM / unitKm;

// 第三人称跟拍视距：12 倍船半径（6 船长），船约占屏高 1/3 的游戏惯例
export const chaseDistFor = (unitKm: number): number => shipRadiusUnits(unitKm) * 12;

// 恒星碰撞半径：主序质量-半径近似 R ≈ R☉·M^0.8（教学近似，0.1–10 M☉ 量级正确）
export const R_SUN_LY = 6.957e5 / LY_KM; // ≈7.353e-8 ly
export function starRadiusLy(massSun?: number): number { return R_SUN_LY * Math.pow(massSun ?? 1, 0.8); }

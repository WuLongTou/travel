// HUD 真实天文物理仪表盘呈现器
// 纯逻辑格式化——处理速度（m/s、km/s、c）、光行时间与距离、开普勒轨道能量（比机械能）判定与模式文本组装
import { C_KM_S, formatKm, lightTravelText } from '../util/units.js';
import type { Entity, GravityWell, Vec3 } from '../types.js';

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** 速度自适应单位转换：亚 km/s 的近景机动用 m/s 表达，避免显示「0 km/s」 */
export function formatSpeedText(spKmS: number): string {
  if (spKmS >= C_KM_S) {
    const cfrac = spKmS / C_KM_S;
    return `≈${cfrac.toFixed(2)} c`;
  }
  if (spKmS >= 1) {
    return Math.max(spKmS, 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) + ' km/s';
  }
  const spMS = Math.max(spKmS * 1000, 0);
  return spMS.toFixed(spMS >= 100 ? 0 : 2) + ' m/s';
}

/** 目标距离与光行时间展示文案 */
export function formatTargetDistanceText(
  probePos: Vec3,
  showEnt: Entity | null,
  kmPerUnit: number,
  isSelected: boolean,
): string {
  if (!showEnt) return '无目标（点击天体锁定）';
  const dkm = dist3(probePos, showEnt.pos) * kmPerUnit;
  let text = `${showEnt.name} · ${formatKm(dkm)} · 光 ${lightTravelText(dkm)}`;
  if (isSelected && showEnt.dive) {
    text += ' · F 下潜进入';
  }
  return text;
}

/** 真实开普勒比机械能 E = v^2/2 - GM/r 判定 */
export function calculateOrbitState(
  probePos: Vec3,
  probeVel: Vec3,
  well: GravityWell | null,
): { orbitText: string; orbitState: '束缚轨道' | '逃逸轨道' } | null {
  if (!well || well.GM <= 0) return null;
  const c = (well.ref ? well.ref.pos : well.center)!;
  const r = Math.hypot(probePos[0] - c[0], probePos[1] - c[1], probePos[2] - c[2]) || 1;
  const speedSq = probeVel[0] ** 2 + probeVel[1] ** 2 + probeVel[2] ** 2;
  const energy = speedSq / 2 - well.GM / r;
  const isBound = energy < 0;
  const orbitState = isBound ? '束缚轨道' : '逃逸轨道';
  return {
    orbitText: `${well.name} · ${isBound ? '束缚' : '逃逸'}轨道`,
    orbitState,
  };
}

export interface HudPresenterInput {
  probePos: Vec3;
  probeVel: Vec3;
  speedKmS: number;
  dominantWell: GravityWell | null;
  selected: Entity | null;
  hoveredEntity: Entity | null;
  kmPerUnit: number;
  flightStatus: string;
  viewName: string;
  godSpeed: string;
  crashEventName: string | null;
  isRecentlyCrashed: boolean;
  tourStatusPrefix: string;
}

export interface HudPresenterOutput {
  speedText: string;
  distText: string;
  modeText: string;
  orbitText: string;
}

/** 组装 HUD 仪表盘数据 */
export function presentHud(input: HudPresenterInput): HudPresenterOutput {
  const speedText = formatSpeedText(input.speedKmS);

  const targetEntity = input.selected || input.hoveredEntity;
  const distText = formatTargetDistanceText(
    input.probePos,
    targetEntity,
    input.kmPerUnit,
    input.selected === targetEntity,
  );

  const orbit = calculateOrbitState(input.probePos, input.probeVel, input.dominantWell);
  const orbitText = orbit ? orbit.orbitText : '—';

  let modeText = `${input.flightStatus} · ${input.viewName}${input.godSpeed}`;
  if (orbit && input.dominantWell) {
    modeText = `${input.flightStatus} · ${input.dominantWell.name} (${orbit.orbitState}) · ${input.viewName}${input.godSpeed}`;
  }

  // 撞击损毁警报覆盖
  if (input.isRecentlyCrashed && input.crashEventName) {
    modeText = `⚠ 撞入 ${input.crashEventName}！已在安全轨道部署`;
  }

  // 大巡游进度前缀
  if (input.tourStatusPrefix) {
    modeText = `${input.tourStatusPrefix} · ${modeText}`;
  }

  return { speedText, distText, modeText, orbitText };
}

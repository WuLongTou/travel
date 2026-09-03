// 渲染域：天体等级配色（含每个天体的确定性色调偏移）
import * as THREE from 'three';

export function levelColor(level) {
  const colors = {
    void: 0x6f82b4,
    dust: 0xa9b8da,
    planet: 0xaaccff,
    star: 0xffdfa8,
    cluster: 0x9fb4ff,
    galaxy: 0x6c8cff,
    supercluster: 0x8e6bff,
    blackhole: 0xff9a3c,
  };
  return new THREE.Color(colors[level] ?? 0x8f9bb8);
}

// 带"每个天体确定性色调偏移"的等级配色：让同类系统颜色各有特色
// （有的星系偏蓝、有的偏紫、有的偏青），体现宇宙多样性。
// g 是 seedGroup，其 hueShift/satShift/lightShift 在创建时按 seed.idx 定好。
export function levelColorTinted(level, g) {
  const c = levelColor(level);
  if (g && (g.hueShift || g.satShift || g.lightShift)) {
    c.offsetHSL(g.hueShift || 0, g.satShift || 0, g.lightShift || 0);
  }
  return c;
}

export function levelCoreScale(level, seed) {
  const m = seed.mass;
  switch (level) {
    case 'void': return 0.85 + m * 0.20;
    case 'dust': return 0.75 + m * 0.20;
    case 'planet': return 0.70 + m * 0.30;
    case 'star': return 2.00 + m * 0.70;
    case 'cluster': return 3.30 + m * 0.70;
    // 星系/超星系团的远景核球辉光与本体尺度（detailR 115/100）成比例
    case 'galaxy': return 20.0 + m * 4.0;
    case 'supercluster': return 28.0 + m * 5.0;
    case 'blackhole': return 0;
    default: return 0.7;
  }
}

export function levelSolidScale(level, seed) {
  const m = seed.mass;
  switch (level) {
    case 'void': return 0.04;
    case 'dust': return 0.06;
    case 'planet': return 0.16 + m * 0.12;
    case 'star': return 0.30 + m * 0.12;
    case 'cluster': return 0.36 + m * 0.10;
    case 'galaxy': return 0.45 + m * 0.10;
    case 'supercluster': return 0.55 + m * 0.11;
    case 'blackhole': return 0.90 + m * 0.24;
    default: return 0.06;
  }
}


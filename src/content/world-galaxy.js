// 银河系层构建器：程序化螺旋星系「从外看」+ 位置标签 + 可下潜目标
// 世界单位：kpc（银河盘半径约 15-20 kpc）
// 教学：展示银河系旋臂/核球/银晕结构；太阳系位于猎户臂(约 8.2-8.3 kpc 处，
// 数据待 research 回表校准)。
import * as THREE from 'three';
import { registerWorld } from './worlds.js';
import { buildGalaxy, buildStarSwarm } from './galaxy-gen.js';
import { makeGlowSprite } from '../render/bodies.js';
import { makeTextSprite, labelScaleFor } from '../render/labels.js';

const KPC_KM = 3.0857e16; // 1 kpc km

// 世界内容构造（engine 渲染），返回：group / entities / update
export function buildGalaxyWorld() {
  const group = new THREE.Group();
  const entities = [];

  // 星系主体：盘半径 = 15 kpc 单位（可视半径设为 15，便于标尺）
  // 银河系实为棒旋星系：两条主臂（盾牌-半人马臂/英仙臂）+ 中央棒 + 次级碎臂
  const diskR = 15; // world units = kpc
  // 盘组件放入 diskGroup：自转时星点、银晕、太阳标签整体随盘旋转
  const diskGroup = new THREE.Group();
  const gal = buildGalaxy({
    rCore: 0.14, rDisk: 1, arms: 2, pitch: 3.2, barLength: 0.2,
    countStars: 140000, armFraction: 0.62, flatten: 0.032,
    tilt: 0, seed: 2024,
  });
  gal.scale.set(diskR, diskR, diskR);
  diskGroup.add(gal);

  // 银晕（球状星团与老星）——真实银晕恒星极稀疏，只作低亮度点缀
  const halo = buildStarSwarm(5200, diskR * 0.95, { seed: 9, flatten: 1, color: '#e8c8a0', size: 1.1 });
  halo.material.opacity = 0.5;
  diskGroup.add(halo);

  // 银心辉光：核球中心的暖色柔光（类比核球恒星密集区）
  const coreGlow = makeGlowSprite(3.2, '#ffd9a8', 0.85);
  diskGroup.add(coreGlow);
  group.add(diskGroup);
  // 演示速率自转：~11 分钟一圈（真实银河年 ~2.3 亿年，教学用慢速演示）
  const GALAXY_SPIN_RATE = 0.0095; // rad/真实秒

  // 可见的位置标注：太阳（猎户臂/本地泡），银心 Sgr A*（可下潜）
  const sunPos = [diskR * 0.55, 0, 0]; // 8.2kpc/15kpc ≈ 0.55 盘半径
  const centerPos = [0, 0, 0];

  // 太阳系位置标签（随盘自转——太阳在猎户臂上绕银心公转）
  const sunLabel = makeTextSprite('太阳系（猎户臂）', { color: '#7fe8ff', priority: 1 });
  const sunLs = labelScaleFor(sunLabel, 0.85);
  sunLabel.scale.set(sunLs[0], sunLs[1], 1);
  sunLabel.position.set(sunPos[0], sunPos[1] + 0.5, sunPos[2]);
  diskGroup.add(sunLabel);
  // 银心标签
  const coreLabel = makeTextSprite('银心 · 人马座 A*', { color: '#ffcf7f', priority: 2 });
  const coreLs = labelScaleFor(coreLabel, 0.85);
  coreLabel.scale.set(coreLs[0], coreLs[1], 1);
  coreLabel.position.set(0, 0.7, 0);
  diskGroup.add(coreLabel);

  // 可下潜实体：银河系（下潜到本星系群视角看它？不——本世界就是银河；下潜应到
  // 太阳系/星际层。我们把「下潜」交给子世界导航，由导航器提供）。这里只放两个
  // 点选目标：银心与太阳系（无下潜，展示 info）。

  const coreEntity = {
    id: 'sgrA', name: '人马座 A*', en: 'Sagittarius A*', type: 'blackhole',
    pos: centerPos, pickRadius: 0.5,
    info: {
      kind: '超大质量黑洞', sub: '银河系中心',
      facts: [['质量', '约 430 万倍太阳质量'], ['距离', '约 26000 光年'], ['视直径', '极小（事件视界约 0.1 AU 级）']],
      text: '人马座 A* 是银河系中心的超大质量黑洞，位于人马座方向约 2.6 万光年处。2022 年事件视界望远镜(EHT)发布了它的首张影像。',
    },
    visual: { color: '#ffcf7f' },
  };
  entities.push(coreEntity);
  coreGlow.userData.entity = coreEntity;

  // 银河系本体（点选显示银河信息）
  const galEntity = {
    id: 'milkyway', name: '银河系', en: 'Milky Way', type: 'galaxy',
    pos: [0, 0, 0], pickRadius: diskR,
    info: {
      kind: '棒旋星系（SBbc）', sub: '我们所在的星系',
      facts: [
        ['直径', '约 10 万光年（盘）'],
        ['恒星', '约 2000–4000 亿颗'],
        ['太阳位置', '距银心约 2.6 万光年'],
        ['绕银心一周', '约 2.2–2.5 亿年（银河年）'],
      ],
      text: '银河系是一个棒旋星系，直径约 10 万光年，包含数千亿颗恒星。太阳带着整个太阳系以约 220 km/s 绕银心公转。图中为程序化示意。',
      source: 'research 回表后标注',
    },
    visual: { color: '#cfe0ff' },
  };
  entities.push(galEntity);

  // 世界返回（group 用于 engine 装载）
  return {
    id: 'galaxy', title: '银河系', unitName: 'kpc', kmPerUnit: KPC_KM,
    intro: '直径约 10 万光年的棒旋星系。我们位于猎户臂，距银心约 2.6 万光年，正以约 220 km/s 绕银心运动（图中自转为演示速率）。',
    worldRadius: diskR,
    // 教学引力（演示校准，与 solar 层的真实 GM 不同）：本层时间倍速上限为
    // 实时，真实银心 GM 下轨道周期 ~2.3 亿年不可见，故取演示值让轨道运动
    // 实时可看；引力平方律与圆轨道关系保持。
    gravity: { center: [0, 0, 0], GM: 0.12, minR: 0.6, name: '银心' },
    spawn: [diskR * 0.75, diskR * 0.45, diskR * 0.75], // 斜上方观测位，看向银心
    spawnLookAt: [0, 0, 0],
    viewDist: 12,
    labelFadeDist: 40, // 全景下银心/太阳标注保持可读
    maxSpeedWorldPerS: 0.35, // kpc/真实秒（演示）
    thrustAccWorldPerS2: 0.12, dragPerSec: 0.35, timeScaleMax: 1,
    ambient: { starCount: 1500, starSpread: 60 },
    group, entities,
    update(dtSim, clock) {
      // 盘自转（演示速率）：恒星点云、银晕与太阳标签整体随盘
      diskGroup.rotation.y = clock.t * GALAXY_SPIN_RATE;
    },
  };
}

// 自注册工厂
registerWorld('galaxy', buildGalaxyWorld);

// 渲染域：大爆炸特效子系统（奇点闪光 / 火球 / 冲击波球壳 / 余晖 + 全屏闪光 overlay）
// 目录梳理阶段 3：从 createCosmosRenderer 巨型闭包中提取出的第一个独立
// 子系统——它只依赖 scene + glowTex，不触碰镜头/轨迹/粒子等其它状态，
// 是"把闭包变量收敛成工厂函数返回值"的验证案例。
import * as THREE from 'three';
import { createFlashOverlay } from './overlays.js';

export function createExplosionFx(scene, glowTex) {
  const makeSprite = (map, color) => new THREE.Sprite(new THREE.SpriteMaterial({
    map, color, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, depthTest: false,
  }));

  const flashSprite = makeSprite(glowTex, 0xffffff);
  flashSprite.position.set(0, 0, 0);
  flashSprite.scale.setScalar(1.2);
  flashSprite.renderOrder = 20;
  scene.add(flashSprite);

  const coreSprite = makeSprite(glowTex, 0xffe6b0);
  coreSprite.position.set(0, 0, 0);
  coreSprite.scale.setScalar(1.0);
  coreSprite.renderOrder = 19;
  scene.add(coreSprite);

  // ---- 体积冲击波球壳（取代旧的扁平"光圈" billboard）----
  // 用 3D 球面壳表达"暴胀"：半径按 r(t)=R∞(1-e^{-kt}) 瞬间撑开（初始
  // 速率 ~5000 单位/s），DoubleSide + 菲涅尔——从内部看是"笼罩整个视野
  // 的发光罩"（掠射角路径长所以边缘更亮），从外部看是"边缘发光的膨胀
  // 光球"。扩张即消散：扫过整个可视宇宙后立刻归于黑暗。
  const shockShellGeo = new THREE.SphereGeometry(1, 40, 24);
  const shockShellMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 vW;
      varying vec3 vN;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      varying vec3 vW;
      varying vec3 vN;
      uniform float uFade;
      void main() {
        vec3 v = normalize(cameraPosition - vW);
        vec3 n = normalize(vN);
        float edge = pow(1.0 - abs(dot(n, v)), 2.0);
        vec3 col = vec3(1.0, 0.80, 0.52);
        float a = (0.07 + edge * 0.5) * uFade;
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a);
      }
    `,
    uniforms: { uFade: { value: 1 } },
  });
  const shockShell = new THREE.Mesh(shockShellGeo, shockShellMat);
  shockShell.position.set(0, 0, 0);
  shockShell.renderOrder = 21;
  shockShell.frustumCulled = false;
  scene.add(shockShell);

  // 第二道冲击波（余波前锋）：比主壳慢、更大、更暗——两次冲击先后掠过
  // 整个可视宇宙，"能量分层次释放"（2026-09-03 大爆炸能量感重做）
  const shockShell2 = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 20),
    shockShellMat.clone(),
  );
  shockShell2.position.set(0, 0, 0);
  shockShell2.renderOrder = 21;
  shockShell2.frustumCulled = false;
  shockShell2.visible = false;
  scene.add(shockShell2);

  const afterglowSprite = makeSprite(glowTex, 0x7fa8ff);
  afterglowSprite.position.set(0, 0, 0);
  afterglowSprite.scale.setScalar(2.0);
  afterglowSprite.renderOrder = 10;
  scene.add(afterglowSprite);

  // 中心火球（从内部看也有体积感）
  const fireball = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffe3b0, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  fireball.position.set(0, 0, 0);
  fireball.renderOrder = 18;
  scene.add(fireball);

  const flashOverlay = createFlashOverlay();

  // 大爆炸是"一瞬间"，但能量的释放要有层次和余势（2026-09-03 重做）：
  // 奇点白闪 → 主冲击波（0.4s 掠过可视宇宙）→ 余波前锋（慢一拍、更大）
  // → 火球从白热冷却到深橙红 → 归于黑暗。全部按**真实显示时间**推进
  // （不受物理慢放倍率拖长），总共 ~2.5s 内完成，之后奇点附近不留任何
  // 光晕/光环（物质早已飞散）。传入的 t 是显示秒（renderer 传 state.time）。
  function update(t) {
    // 白热奇点闪光：0.3s 内消失，尺度瞬间撑开
    const flashA = Math.exp(-t * 13.0);
    flashSprite.scale.setScalar(0.9 + (1 - Math.exp(-t * 8.0)) * 150);
    flashSprite.material.opacity = Math.min(1, 0.6 + flashA * 1.6);
    flashSprite.visible = flashA > 0.004;

    // 中心火球：极速膨胀 + 冷却（白热 → 橙红），0.6s 内消散
    const coreA = Math.exp(-t * 6.0);
    coreSprite.scale.setScalar(1.1 + t * 38);
    coreSprite.material.opacity = Math.min(1, 0.35 + coreA * 1.2);
    coreSprite.material.color.setRGB(
      1.0,
      Math.max(0.32, 0.90 - t * 0.9),
      Math.max(0.12, 0.68 - t * 1.3),
    );
    coreSprite.visible = coreA > 0.004;
    fireball.scale.setScalar(Math.max(0.001, 0.28 + t * 30));
    // 火球温度梯度：100000K 白热 → 冷却中的恒星形成区橙红
    fireball.material.color.setRGB(
      1.0,
      Math.max(0.28, 0.89 - t * 1.0),
      Math.max(0.08, 0.69 - t * 1.5),
    );
    fireball.material.opacity = Math.max(0, 0.96 * coreA);
    fireball.visible = coreA > 0.006;

    // 主冲击波球壳：暴胀式扩张 r(t) = R∞·(1-e^{-kt})——初始扩张速率
    // ~5500 单位/s，0.35s 内越过整个可视宇宙，3.2/s 指数消散
    const shockA = Math.exp(-t * 3.2);
    shockShell.scale.setScalar(Math.max(0.001, 2 + 1800 * (1 - Math.exp(-t * 3.2))));
    shockShell.material.uniforms.uFade.value = Math.min(1, shockA * 1.35);
    shockShell.visible = shockA > 0.004;

    // 余波前锋：慢一拍（k=1.7）、更大、更暗——两道波前先后扫过全宇宙
    const shock2A = Math.exp(-t * 2.1);
    shockShell2.visible = shock2A > 0.004;
    if (shockShell2.visible) {
      shockShell2.scale.setScalar(Math.max(0.001, 2 + 2500 * (1 - Math.exp(-t * 1.7))));
      shockShell2.material.uniforms.uFade.value = Math.min(0.8, shock2A * 0.9);
    }

    // 余晖：爆炸后宇宙归于黑暗（0.5s 内的短衰减）
    const afterA = Math.exp(-t * 8.0);
    afterglowSprite.scale.setScalar(2.2 + t * 6);
    afterglowSprite.material.opacity = Math.min(0.18, 0.05 + afterA * 0.16);
    afterglowSprite.visible = afterA > 0.008;

    flashOverlay.mat.uniforms.uTime.value = t;
    flashOverlay.mat.uniforms.uAlpha.value = t < 0.42 ? 1 : Math.max(0, 1 - (t - 0.42) * 2.6);
  }

  return { flashSprite, coreSprite, shockShell, afterglowSprite, fireball, flashOverlay, update };
}

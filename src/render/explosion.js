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
  // 旧 shockSprite 是一个始终面向相机的橙色圆环贴图，从任何角度看都是
  // 一个扁平"贴纸环"，又丑又没有体积感。现在用 3D 球面壳：从奇点爆发后
  // 以超光速膨胀到覆盖整个场景（半径 ~500 单位），DoubleSide + 菲涅尔——
  // 从内部看是"笼罩整个视野的发光罩"（掠射角路径长所以边缘更亮），
  // 从外部看是"边缘发光的膨胀光球"。这才是"冲击波扩散到全宇宙"。
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

  // 大爆炸是"一瞬间"：全部爆炸视觉在 ~1.2s 内完成并消散，之后奇点附近
  // 不留任何光晕/光环（物质早已飞散）。
  function update(t) {
    // 白热奇点闪光：更亮，0.5s 内消失
    const flashA = Math.exp(-t * 12.0);
    flashSprite.scale.setScalar(0.9 + t * 46 + (1 - flashA) * 3);
    flashSprite.material.opacity = Math.min(1, 0.4 + flashA * 1.35);
    flashSprite.visible = flashA > 0.004;

    // 中心火球：更大更快膨胀，0.9s 内快速冷却消散
    const coreA = Math.exp(-t * 5.5);
    coreSprite.scale.setScalar(1.1 + t * 15);
    coreSprite.material.opacity = Math.min(1, 0.25 + coreA * 1.0);
    coreSprite.visible = coreA > 0.004;
    fireball.scale.setScalar(Math.max(0.001, 0.28 + t * 4.2));
    fireball.material.opacity = Math.max(0, 0.95 * coreA);
    fireball.visible = coreA > 0.006;

    // 体积冲击波球壳：以超光速持续膨胀到覆盖整个场景空间，再消散
    const shockA = Math.exp(-t * 1.6);
    shockShell.scale.setScalar(Math.max(0.001, 2 + t * 160));
    shockShell.material.uniforms.uFade.value = Math.min(1, shockA * 1.2);
    shockShell.visible = shockA > 0.004;

    // 余晖：爆炸后宇宙立刻归于黑暗，只保留 0.5s 内的极短衰减辉光
    const afterA = Math.exp(-t * 7.0);
    afterglowSprite.scale.setScalar(2.2 + t * 4);
    afterglowSprite.material.opacity = Math.min(0.20, 0.05 + afterA * 0.16);
    afterglowSprite.visible = afterA > 0.008;

    flashOverlay.mat.uniforms.uTime.value = t;
    flashOverlay.mat.uniforms.uAlpha.value = t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 2.5);
  }

  return { flashSprite, coreSprite, shockShell, afterglowSprite, fireball, flashOverlay, update };
}

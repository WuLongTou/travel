// 渲染域：主角小球视觉 + 死亡特效
// 目录梳理阶段 3：从 createCosmosRenderer 巨型闭包提取。
// 工厂 createProbeFx(scene, sim, glowTex, ringTex, trail, camera) 创建小球
// （能量球 + 光晕 + 重生精灵 + 推进器尾焰 + 死亡涟漪环/炽光），并提供
// update(dt, state, alpha) 每帧驱动位置插值/光晕/死亡演出/重生高亮/
// 轨迹节流采样；generation 重置与 trail.clearTrail 都在 update 内部处理。
import * as THREE from 'three';
import { DEATH_FX } from './death-fx.js';

export function createProbeFx(scene, sim, glowTex, ringTex, trail, camera) {
  const makeSprite = (map, color) => new THREE.Sprite(new THREE.SpriteMaterial({
    map, color, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, depthTest: false,
  }));

  // 主角小球：克制的能量球——淡白核心 + 轻微青蓝边缘 + 弱镜面高光。
  // 能看到即可，不做过曝高光，配 bloom 也保持低调。
  const probeMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 40, 32),
    new THREE.ShaderMaterial({
      depthTest: false,
      uniforms: {
        uCore: { value: new THREE.Color(0xd6e4ff) },
        uRim: { value: new THREE.Color(0x5a8fd0) },
        uSpec: { value: new THREE.Color(0xffffff) },
      },
      vertexShader: `
        varying vec3 vN; varying vec3 vV;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vN; varying vec3 vV;
        uniform vec3 uCore; uniform vec3 uRim; uniform vec3 uSpec;
        void main() {
          vec3 n = normalize(vN);
          vec3 v = normalize(vV);
          // 菲涅尔边缘：中心淡白，向边缘轻微过渡为青蓝
          float fresnel = pow(1.0 - abs(dot(n, v)), 1.6);
          // 弱镜面高光：只给一点点立体感，不抢眼
          vec3 L = normalize(vec3(0.35, 1.0, 0.6));
          vec3 R = reflect(-L, n);
          float spec = pow(max(0.0, dot(R, v)), 42.0);
          vec3 col = mix(uCore, uRim, fresnel);
          col += uSpec * spec * 0.25;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  probeMesh.renderOrder = 100;
  scene.add(probeMesh);

  // 光冕（菲涅尔）：边缘泛蓝白光，给小球"体积光"的质感；作为小球子节点，
  // 死亡演出（潮汐拉伸/汽化收缩）时自动同步缩放。
  const probeCorona = new THREE.Mesh(
    new THREE.SphereGeometry(0.85, 32, 24),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec3 vN; varying vec3 vV;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vN; varying vec3 vV;
        uniform float uIntensity;
        void main() {
          float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
          vec3 col = mix(vec3(0.42, 0.72, 1.0), vec3(1.0, 1.0, 1.0), rim);
          float a = rim * uIntensity;
          if (a < 0.012) discard;
          gl_FragColor = vec4(col, a);
        }
      `,
      uniforms: { uIntensity: { value: 0.5 } },
    }),
  );
  probeCorona.renderOrder = 99;
  probeMesh.add(probeCorona);

  // 光晕：远处仍是可辨认的亮光点，近处不压过天体
  const probeGlow = makeSprite(glowTex, 0xffffff);
  probeGlow.scale.setScalar(1.0);
  probeGlow.material.opacity = 0.7;
  probeGlow.renderOrder = 15;
  scene.add(probeGlow);

  const probeHalo = makeSprite(glowTex, 0x5aa7ff);
  probeHalo.scale.setScalar(1.7);
  probeHalo.material.opacity = 0.22;
  probeHalo.renderOrder = 14;
  scene.add(probeHalo);

  const respawnSprite = makeSprite(ringTex, 0x8ef0ff);
  respawnSprite.visible = false;
  respawnSprite.renderOrder = 22;
  scene.add(respawnSprite);
  let lastProbeGeneration = sim.probe.generation;

  // ---- 引擎尾焰（§10 推进器）：推进器开启时显示的"光锥" ----
  // 圆锥（粗端在球侧、细端远端）朝速度反方向延伸；shader 让远端自然
  // 衰减归零，开启推进时由 render 接管位置/朝向/长度。
  // 半径与长度故意比直觉大：cone 自身的可见面积小（远端渐细 + 衰减
  // 渐弱），加上 bloom 阈值 0.30，只有"够粗"才能在远景里看出方向。
  const probeTrailGeo = new THREE.ConeGeometry(0.7, 1.0, 24, 1, true);
  // 把底端（粗端）从 +Y/2 平移到原点，模型坐标系下底端 = (0,0,0)、顶端 = (0,1,0)
  probeTrailGeo.translate(0, 0.5, 0);
  const probeTrailMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `
      varying float vT;
      void main() {
        vT = position.y; // 0 = 球侧、1 = 远端
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vT;
      uniform vec3 uColor;
      void main() {
        // 远端衰减 + 整体足够亮以触发 bloom 边缘
        float a = pow(1.0 - vT, 1.4) * 0.95;
        if (a < 0.01) discard;
        // 近端偏白热、远端偏青蓝 → 真实喷气温度梯度
        vec3 col = mix(vec3(1.0, 0.95, 0.88), uColor, vT);
        gl_FragColor = vec4(col, a);
      }
    `,
    uniforms: { uColor: { value: new THREE.Color(0x7ab8ff) } },
  });
  const probeTrail = new THREE.Mesh(probeTrailGeo, probeTrailMat);
  probeTrail.renderOrder = 16;
  probeTrail.visible = false;
  probeTrail.frustumCulled = false;
  scene.add(probeTrail);
  // 推进器状态切换时给一个微妙的"开关灯"过渡：靠 opacity 抖动一下
  let probeTrailOnAt = -1; // 上次开启时间（用于"刚开启"的瞬时增亮）

  // ---- 差异化死亡特效（§9.3 碰撞与吸积）----
  // 小球死法不同，特效不同：
  //   atmosphere 行星/星尘大气烧蚀：暖橙单环，慢扩散
  //   vaporize   恒星吞没汽化：白炽强闪，快扩散短寿命
  //   tidal      黑洞/星系核潮汐撕碎：蓝白三重涟漪（延迟回声），最长寿命
  //   wormhole   虫洞逃逸：全屏虫洞叠加层已足够，不播死亡特效
  //   generic    兜底 = 原蓝色重生环
  // DEATH_FX 已提取到 render/death-fx.js（顶部 import）
  // 死亡点特效池：3 道涟漪环 + 1 个中心炽光，按需激活
  const deathRings = [0, 1, 2].map(() => {
    const sprite = makeSprite(ringTex, 0xffffff);
    sprite.visible = false;
    sprite.renderOrder = 23;
    scene.add(sprite);
    return { sprite, active: false, age: 0, life: 1, expand: 9 };
  });
  const deathGlow = makeSprite(glowTex, 0xffffff);
  deathGlow.visible = false;
  deathGlow.renderOrder = 23;
  scene.add(deathGlow);
  let deathGlowAge = -1; // <0 表示未激活

  // 在死亡位置生成对应类型的特效
  function spawnDeathFx(pos, fx) {
    deathRings.forEach((r, i) => {
      r.active = i < fx.rings;
      // 潮汐撕碎的第 2/3 道涟漪延迟出现，形成"撕碎回声"
      r.age = -i * 0.24;
      r.life = fx.life;
      r.expand = fx.expand;
      r.sprite.position.set(pos[0], pos[1], pos[2]);
      r.sprite.material.color.setHex(fx.ring);
      r.sprite.material.rotation = Math.random() * Math.PI;
      r.sprite.visible = false;
    });
    deathGlowAge = 0;
    deathGlow.position.set(pos[0], pos[1], pos[2]);
    deathGlow.material.color.setHex(fx.ring);
  }

  function updateDeathFx(dt) {
    for (const r of deathRings) {
      if (!r.active) continue;
      r.age += dt;
      if (r.age < 0) continue; // 延迟未到
      if (r.age >= r.life) { r.active = false; r.sprite.visible = false; continue; }
      const k = r.age / r.life;
      r.sprite.visible = true;
      r.sprite.scale.setScalar(1.4 + k * r.expand * 3);
      r.sprite.material.opacity = (1 - k) * 0.85;
    }
    if (deathGlowAge >= 0) {
      const life = 0.55;
      deathGlowAge += dt;
      if (deathGlowAge >= life) { deathGlowAge = -1; deathGlow.visible = false; }
      else {
        const k = deathGlowAge / life;
        deathGlow.visible = true;
        deathGlow.scale.setScalar(1.5 + k * 6);
        deathGlow.material.opacity = (1 - k) * 0.8;
      }
    }
  }

  const _deathDir = new THREE.Vector3();
  const _trailDir = new THREE.Vector3();
  const _trailQuat = new THREE.Quaternion();
  const _X_AXIS = new THREE.Vector3(1, 0, 0);
  const _Y_AXIS = new THREE.Vector3(0, 1, 0);

  // 固定按时间采样，保留时长 = trailLength × TRAIL_SAMPLE 秒。
  const TRAIL_SAMPLE = 0.045;
  let trailClock = 0;

  // ===== 每帧 update（原 render 主循环 probe 块迁移）=====
  function update(dt, state, alpha) {
    const pr = sim.probe;
    const px = pr.prevPos[0] + (pr.pos[0] - pr.prevPos[0]) * alpha;
    const py = pr.prevPos[1] + (pr.pos[1] - pr.prevPos[1]) * alpha;
    const pz = pr.prevPos[2] + (pr.pos[2] - pr.prevPos[2]) * alpha;
    // 死亡序列起点：立即播死亡特效，并标记本次死亡已播（重生时不再重复）
    if (pr.dying && !state._prevDying) {
      state._deathFx = DEATH_FX[pr.deathType] || DEATH_FX.generic;
      if (pr.deathType !== 'wormhole') {
        spawnDeathFx(pr.deathPos, state._deathFx);
        state._fxSpawnedForDeath = true;
      }
    }
    state._prevDying = pr.dying;
    if (pr.generation !== lastProbeGeneration) {
      lastProbeGeneration = pr.generation;
      trail.clearTrail();
      // 重生后速度方向突变：平滑速度直接重置为新方向（前向偏置不拖泥带水），
      // 但**方位角不跟着转**（用户要求任何时候都不得跟随小球旋转）。
      const pv0 = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
      if (pv0 > 0.02) {
        state.velSmooth.set(pr.vel[0], pr.vel[1], pr.vel[2]);
      }
      // 死亡方式驱动的特效与配色（虫洞逃逸不播死亡特效）；
      // 死亡序列起点已播过则不重复
      state._deathFx = DEATH_FX[pr.deathType] || DEATH_FX.generic;
      if (pr.deathType !== 'wormhole' && !state._fxSpawnedForDeath) spawnDeathFx(pr.deathPos, state._deathFx);
      state._fxSpawnedForDeath = false;
    }
    probeMesh.position.set(px, py, pz);
    probeGlow.position.copy(probeMesh.position);
    probeHalo.position.copy(probeMesh.position);
    // ---- 引擎尾焰：推进器开启且有实际输入时显示 ----
    // 朝向 = 速度反方向（"推力把球往前推，火焰从发动机往后喷"），
    // 长度随速率自适应（0.6~4.5 单位）。朝向上用 +Y 转到 -velDir：
    //   q.setFromUnitVectors(Y, -velDir) 等价于"模型 +Y 指远端、底端在球侧"。
    {
      const tv = sim.thrust;
      const thrustActive = sim.config.thrustEnabled && (tv[0] !== 0 || tv[1] !== 0 || tv[2] !== 0);
      if (thrustActive) {
        probeTrail.visible = true;
        // probeTrail 加在 scene 而非 probeMesh 子节点（避免被缩放/旋转的死亡演出
        // 污染），所以每帧自己同步到 probe 位置
        probeTrail.position.set(px, py, pz);
        const spd = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
        _trailDir.set(pr.vel[0], pr.vel[1], pr.vel[2]);
        if (_trailDir.lengthSq() > 1e-4) {
          _trailDir.divideScalar(spd);
          _trailDir.negate(); // 朝速度反方向
          _trailQuat.setFromUnitVectors(_Y_AXIS, _trailDir);
          probeTrail.quaternion.copy(_trailQuat);
        }
        // 长度：随速度从 0.8 拉到 6.0，再被推力大小稍微加强
        const len = Math.min(6.0, 0.8 + spd * 0.22 + sim.config.thrustMag * 0.05);
        probeTrail.scale.set(1, len, 1);
        // 刚开启的一帧用更深一点的"点火热"（短暂强闪）
        if (probeTrailOnAt < 0) probeTrailOnAt = sim.time;
        const justOn = Math.max(0, 1 - (sim.time - probeTrailOnAt) / 0.25);
        probeTrail.material.uniforms.uColor.value.setRGB(
          0.63 + justOn * 0.37, 0.83 + justOn * 0.17, 1.0,
        );
      } else {
        probeTrail.visible = false;
        probeTrailOnAt = -1;
      }
    }
    // 小球光晕：远处仍是一颗可辨认的亮星，近处保持清晰但不炸白。
    // 小球光晕：能看到即可，收敛到克制——远处是可辨的光点，近处不过曝
    const camDist = camera.position.distanceTo(probeMesh.position);
    const glowScale = 1.6 * Math.max(0.5, Math.min(2.2, 15 / Math.max(camDist, 4)));
    probeGlow.scale.setScalar(glowScale);
    probeHalo.scale.setScalar(glowScale * 1.4);
    // ---- 死亡演出：潮汐拉伸（意大利面化）/ 汽化收缩 / 烧蚀压缩 + 配色跟随 ----
    if (pr.dying) {
      const k = 1 - Math.max(0, pr.dyingT) / Math.max(1e-4, pr.dyingDur);
      if (pr.deathType === 'tidal') {
        const kp = pr.deathKillerPos;
        _deathDir.set(kp[0] - px, kp[1] - py, kp[2] - pz);
        if (_deathDir.lengthSq() > 1e-8) {
          _deathDir.normalize();
          probeMesh.quaternion.setFromUnitVectors(_X_AXIS, _deathDir);
        }
        probeMesh.scale.set(1 + 3.5 * k, Math.max(0.12, 1 - 0.8 * k), Math.max(0.12, 1 - 0.8 * k));
        probeGlow.scale.setScalar(glowScale * (1 + 1.2 * k));
      } else if (pr.deathType === 'vaporize') {
        probeMesh.scale.setScalar(Math.max(0.06, 1 - k));
        probeGlow.scale.setScalar(glowScale * (1 + 2.5 * k));
      } else {
        probeMesh.scale.setScalar(1 - 0.3 * k);
      }
    } else {
      probeMesh.scale.setScalar(1);
    }
    // 重生高亮/死亡期间配色跟随死亡方式：汽化偏白、烧蚀偏暖橙、潮汐偏蓝白
    const deathFx = state._deathFx || DEATH_FX.generic;
    const highlight = pr.dying || pr.respawnFlash > 0.05;
    probeGlow.material.color.setHex(highlight ? deathFx.halo : 0xffffff);
    probeHalo.material.color.setHex(highlight ? deathFx.halo : 0x5aa7ff);

    if (pr.respawnFlash > 0.01) {
      respawnSprite.visible = true;
      respawnSprite.position.copy(probeMesh.position);
      respawnSprite.scale.setScalar(1.6 + (1 - pr.respawnFlash) * 9);
      respawnSprite.material.opacity = Math.min(1, pr.respawnFlash * 1.1);
      respawnSprite.material.color.setHex(deathFx.launch);
    } else {
      respawnSprite.visible = false;
    }
    updateDeathFx(dt);
    // 轨迹按固定时间采样（不是每帧），并在采样点记录当时的速率用于着色。
    // 注意 pv 定义在镜头分支块内、此处不可见，所以现算一次
    trailClock += dt;
    if (trailClock >= TRAIL_SAMPLE) {
      trailClock = 0;
      const pvNow = Math.hypot(pr.vel[0], pr.vel[1], pr.vel[2]);
      trail.pushTrail(px, py, pz, pvNow);
    }
  }

  return { update, probeMesh, probeGlow, probeHalo, respawnSprite, probeTrail };
}

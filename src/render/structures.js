// 渲染域：天体结构（seedGroups）与成员点云（远景 preview / 细节点云 detail）
// 目录梳理阶段 3：从 createCosmosRenderer 巨型闭包提取的最大子系统。
// 工厂 createStructures(scene, sim, glowTex, ringTex, camera) 创建每个暗物质晕
// 视觉组（实心球/核心/光晕/盘面/黑洞吸积盘/喷流/星系核），管理远景成员点云
// 与细节系统点云；返回三个 update 函数。updateStructures 单独成段（中间隔
// probe 视觉/state/particles/trail/缓存向量等 renderer 全局状态）。
import * as THREE from 'three';
import { levelColor, levelColorTinted, levelCoreScale, levelSolidScale } from './colors.js';
import { COLLECTION_LEVELS } from '../core/config.js';
import { hash01, clamp01, smoothstep, randomUnit, orbitPolar, easeInOut } from '../core/utils.js';

export function createStructures(scene, sim, glowTex, ringTex, camera) {
  const makeSprite = (map, color) => new THREE.Sprite(new THREE.SpriteMaterial({
    map, color, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, depthTest: false,
  }));

  const seedGroups = [];
  for (const s of sim.seeds) {
    const group = new THREE.Group();
    group.position.set(s.pos[0], s.pos[1], s.pos[2]);
    const m4 = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(s.u[0], s.u[1], s.u[2]),
      new THREE.Vector3(s.v[0], s.v[1], s.v[2]),
      new THREE.Vector3(s.axis[0], s.axis[1], s.axis[2]),
    );
    group.quaternion.setFromRotationMatrix(m4);

    // 每个天体的确定性色调偏移（宇宙多样性）：同类系统颜色各异。
    // 黑洞吸积盘偏暖、星系偏蓝紫——偏移幅度克制，不破坏类型辨识度。
    group.hueShift = (hash01(s.idx * 3 + 1) - 0.5) * 0.14;
    group.satShift = (hash01(s.idx * 5 + 7) - 0.5) * 0.16;
    group.lightShift = (hash01(s.idx * 7 + 13) - 0.5) * 0.10;

    const solid = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 18),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    solid.renderOrder = 5;
    group.add(solid);

    const core = makeSprite(glowTex, 0x8f9bb8);
    core.renderOrder = 6;
    group.add(core);

    const halo = makeSprite(glowTex, 0x6c8cff);
    halo.renderOrder = 3;
    group.add(halo);

    const disk = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 1.55, 96),
      new THREE.MeshBasicMaterial({
        color: 0x6c8cff, transparent: true, opacity: 0.55,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    disk.renderOrder = 4;
    group.add(disk);

    // 吸积盘：扁平的等离子体盘（shader 而非贴图）。内缘白热、外缘红冷
    // （真实温度梯度），并带多普勒增亮——盘绕黑洞旋转，一侧物质朝观察者
    // 接近而更亮、另一侧远离而更暗。几何在赤道面，随黑洞自转旋转。
    const accretionDisk = new THREE.Mesh(
      new THREE.RingGeometry(2.0, 6.0, 128),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uInner: { value: 2.0 },
          uOuter: { value: 6.0 },
        },
        vertexShader: `
          varying vec3 vPos;
          void main() {
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vPos;
          uniform float uInner;
          uniform float uOuter;
          void main() {
            vec2 p = vPos.xy;
            float r = length(p);
            float ang = atan(p.y, p.x);
            // 盘边缘软化
            float innerEdge = smoothstep(uInner, uInner * 1.06, r);
            float outerEdge = 1.0 - smoothstep(uOuter * 0.80, uOuter, r);
            float edge = innerEdge * outerEdge;
            // 温度梯度：内缘(白热) → 外缘(橙红暗)
            float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
            // 多普勒增亮：朝观察者转动的一侧更亮
            float doppler = 0.58 + 0.42 * sin(ang);
            float brightness = mix(1.0, 0.10, t) * doppler;
            vec3 hot = vec3(1.0, 0.90, 0.78);
            vec3 cool = vec3(1.0, 0.42, 0.12);
            vec3 col = mix(hot, cool, t) * brightness;
            float a = edge * (0.2 + 0.8 * clamp(brightness, 0.0, 1.0));
            if (a < 0.012) discard;
            gl_FragColor = vec4(col, a);
          }
        `,
      }),
    );
    accretionDisk.renderOrder = 7;
    group.add(accretionDisk);

    // 光子环（爱因斯坦环）：引力透镜把背景光弯成的一圈细亮环，紧贴
    // 事件视界外侧——黑洞最标志性的视觉特征，也是"引力透镜"的直观呈现。
    const photonRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.5, 0.022, 16, 160),
      new THREE.MeshBasicMaterial({
        color: 0xfff4e6, transparent: true, opacity: 0.95,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    photonRing.renderOrder = 8;
    group.add(photonRing);

    // 相对论喷流：粒子流而非实心圆锥（真实 AGN 喷流是一束等离子体）。
    // 粒子沿自转轴分布、径向缓慢张开；**长度有限**——亮度在远端按
    // (1-t)^1.6 自然衰减到零，喷流在末端消散，而非无限延伸。
    const JET_N = 56;
    const jetPosArr = new Float32Array(JET_N * 3);
    const jetColArr = new Float32Array(JET_N * 3);
    for (let i = 0; i < JET_N; i++) {
      const t = Math.pow(Math.random(), 1.5);          // 偏向喷口，远处稀疏
      const z = 0.5 + t * 2.2;                        // 沿 +Z 轴向外（有限长度）
      const spread = 0.05 + t * 0.42;                 // 缓慢张开的准直束
      const a = Math.random() * Math.PI * 2;
      const rr = spread * Math.sqrt(Math.random());
      jetPosArr[i * 3] = Math.cos(a) * rr;
      jetPosArr[i * 3 + 1] = Math.sin(a) * rr;
      jetPosArr[i * 3 + 2] = z;
      // 远端自然消散：亮度随 (1-t) 衰减到零，喷流尽头不是硬截断而是淡出
      const fade = Math.pow(1 - t, 1.6) * (0.7 + Math.random() * 0.5);
      jetColArr[i * 3] = 0.78 * fade;
      jetColArr[i * 3 + 1] = 0.86 * fade;
      jetColArr[i * 3 + 2] = 1.0 * fade;
    }
    const jetGeo = new THREE.BufferGeometry();
    jetGeo.setAttribute('position', new THREE.BufferAttribute(jetPosArr, 3));
    jetGeo.setAttribute('color', new THREE.BufferAttribute(jetColArr, 3));
    const jetMat = new THREE.PointsMaterial({
      size: 0.34, sizeAttenuation: true, vertexColors: true,
      color: 0xc6d8ff, transparent: true, opacity: 0.8,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const jetA = new THREE.Points(jetGeo, jetMat);
    jetA.renderOrder = 9;
    const jetB = new THREE.Points(jetGeo, jetMat);
    jetB.rotation.z = Math.PI; // 镜像到 -Z：喷流成对（自转轴两极）
    jetB.renderOrder = 9;
    group.add(jetA, jetB);

    // 超星系团的伴星系亮核
    const nodes = [];
    for (let n = 0; n < 6; n++) {
      const nd = makeSprite(glowTex, 0x8e6bff);
      const a = (n / 6) * Math.PI * 2;
      const rr = 2.3 + (n % 3) * 0.95;
      nd.position.set(Math.cos(a) * rr, Math.sin(a) * rr * 0.7, 0);
      nd.scale.setScalar(0.25);
      nd.renderOrder = 6;
      group.add(nd);
      nodes.push(nd);
    }

    seedGroups.push({
      group, solid, core, halo, disk, accretionDisk, photonRing, jetA, jetB, nodes,
      coreScale: 0.5, diskAmt: 0, bhAmt: 0, nodeAmt: 0, diskAngle: Math.random() * Math.PI * 2,
      level: 'void',
    });
    scene.add(group);
  }

  // ---------- 流式细节：只有小球接近大系统时才创建内部星体 ----------
  const detailVisuals = new Map();

  // ---- 远景成员点云（§5.2 渐进发现的远景表达）----
  // 集合系统成熟后不再被渲染成"一个发光天体"：把确定性成员布局画成一团
  // 小光点，远处看到的就是"很多个天体"组成的星系 / 星团形状。
  // 小球靠近后成员被逐个发现：发现完成的成员由 detail 点云接管渲染，
  // 预览点随 revealT 淡出。两者共用同一位置，所以是无缝升级，不是重影。
  const PREVIEW_CULL = 1500; // 超出这个距离直接不画（远景已不可辨）
  const previewVisuals = new Map(); // s.idx -> { points, geo, mat, pos, size, base, layoutId }
  function updatePreviewClouds() {
    for (const s of sim.seeds) {
      let v = previewVisuals.get(s.idx);
      const eligible = COLLECTION_LEVELS.has(s.level) && s.growth > 0.55;
      const layout = eligible ? sim._memberLayout(s) : null;
      if (!layout) {
        if (v) v.points.visible = false;
        continue;
      }
      if (!v || v.layoutId !== s._layoutId) {
        if (v) { scene.remove(v.points); v.geo.dispose(); v.mat.dispose(); }
        const n = layout.length;
        const pos = new Float32Array(n * 3);
        const col = new Float32Array(n * 3);
        const base = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const m = layout[i];
          const tint = m.colorSeed;
          // 结构层越靠内越小越暗：远处也能读出"旋臂 / 核球"的层次
          const layer = 1 - (m.tier || 0) * 0.22;
          if (m.type === 'star') {
            // 与近景一致的光温三段：蓝白(年轻) / 黄白 / 橙红(老年)，暗化版
            if (tint < 0.28) {
              col[i * 3] = 0.62; col[i * 3 + 1] = 0.76; col[i * 3 + 2] = 1.0;
            } else if (tint < 0.68) {
              col[i * 3] = 0.95; col[i * 3 + 1] = 0.82; col[i * 3 + 2] = 0.58;
            } else {
              col[i * 3] = 0.95; col[i * 3 + 1] = 0.55; col[i * 3 + 2] = 0.33;
            }
            base[i] = (0.18 + tint * 0.14) * layer;
          } else if (m.type === 'blackhole' || m.type === 'galaxy') {
            col[i * 3] = 0.62; col[i * 3 + 1] = 0.70; col[i * 3 + 2] = 1.0;
            base[i] = 0.16 * layer;
          } else if (m.type === 'asteroid') {
            // 小行星：暗岩石色，远读为一条淡淡的带
            col[i * 3] = 0.46 + tint * 0.10; col[i * 3 + 1] = 0.41 + tint * 0.08; col[i * 3 + 2] = 0.36 + tint * 0.06;
            base[i] = 0.035 * layer;
          } else {
            col[i * 3] = 0.50 + tint * 0.25; col[i * 3 + 1] = 0.35 + tint * 0.25; col[i * 3 + 2] = 0.85 + tint * 0.15;
            base[i] = (0.10 + tint * 0.08) * layer;
          }
        }
        const size = new Float32Array(base);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
        // 与细节点云同款着色器，但带最小像素钳制与远距离补偿：
        // 极远处每个成员仍是可感知的光点，上百个成员融成"星系光雾"
        const mat = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
          uniforms: { uFade: { value: 1 }, uMinPx: { value: 1.15 }, uBoost: { value: 0 } },
          vertexShader: `
            attribute float aSize;
            uniform float uMinPx;
            uniform float uBoost;
            varying vec3 vColor;
            void main() {
              vColor = color;
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              float px = aSize * (620.0 / max(1.0, -mv.z));
              gl_PointSize = max(uMinPx * (1.0 + uBoost * 1.8), px * (1.0 + uBoost * 2.2));
              gl_Position = projectionMatrix * mv;
            }
          `,
          fragmentShader: `
            uniform float uFade;
            uniform float uBoost;
            varying vec3 vColor;
            void main() {
              float d = length(gl_PointCoord - 0.5) * 2.0;
              float a = (1.0 - smoothstep(0.08, 1.0, d)) * (0.55 + 0.45 * uBoost) * uFade;
              if (a < 0.01) discard;
              gl_FragColor = vec4(vColor * 0.85, a);
            }
          `,
        });
        const points = new THREE.Points(geo, mat);
        points.frustumCulled = false;
        points.renderOrder = 4;
        scene.add(points);
        v = { points, geo, mat, pos, size, base, layoutId: s._layoutId };
        previewVisuals.set(s.idx, v);
      }
      // ---- 每帧写入世界坐标（points 本体留在原点）----
      const n = Math.min(layout.length, v.size.length);
      const pos = v.pos, size = v.size, base = v.base;
      const det = s.detail;
      if (det) {
        // detail 已激活：直接取真实 body 的位置（同步轨道 / 动力学偏移），
        // 已发现的成员随 revealT 淡出，把画面交给 detail 点云
        const nb = Math.min(n, det.bodies.length);
        for (let i = 0; i < nb; i++) {
          const b = det.bodies[i];
          pos[i * 3] = b.pos[0]; pos[i * 3 + 1] = b.pos[1]; pos[i * 3 + 2] = b.pos[2];
          size[i] = b.revealed ? base[i] * (1 - clamp01(b.revealT)) : base[i];
        }
      } else {
        // 无 detail：静态布局 + 与 detail 同公式的自转
        //（angle = 布局起始角 + layoutSpin × speed），交接瞬间不跳变；
        // 椭圆轨道同样经 orbitPolar 求真近点角与半径
        const spin = s._layoutSpin || 0;
        for (let i = 0; i < n; i++) {
          const m = layout[i];
          if (m.orbit) {
            const ang = m.orbit.angle + spin * m.orbit.speed;
            const pol = orbitPolar(m.orbit, ang);
            const c = Math.cos(pol[0]), sn = Math.sin(pol[0]);
            const rEff = pol[1];
            pos[i * 3] = s.pos[0] + s.u[0] * c * rEff + s.v[0] * sn * rEff + s.axis[0] * m.orbit.height;
            pos[i * 3 + 1] = s.pos[1] + s.u[1] * c * rEff + s.v[1] * sn * rEff + s.axis[1] * m.orbit.height;
            pos[i * 3 + 2] = s.pos[2] + s.u[2] * c * rEff + s.v[2] * sn * rEff + s.axis[2] * m.orbit.height;
          } else {
            pos[i * 3] = s.pos[0]; pos[i * 3 + 1] = s.pos[1]; pos[i * 3 + 2] = s.pos[2];
          }
          size[i] = base[i];
        }
      }
      v.geo.attributes.position.needsUpdate = true;
      v.geo.attributes.aSize.needsUpdate = true;
      // ---- 三段式表达（真实的层级连续体，用户明确要求）----
      //   远（cd > ~4.5×dr）：星系是"一个"天体——成员点云整体淡出，
      //     只剩 halo/core 光斑（极远处分辨不出旋臂与星点，就是一团光）
      //   中（1.4×dr < cd < 4.5×dr）：光斑随小球接近而退场，成员点云
      //     浮现——看到的是"一群恒星"，"星系"这个整体已经看不见了
      //   近（cd < 1.4×dr）：只剩身边的天体，航线经过谁、谁才显形
      // uBoost 只服务中段（远处点云反正要淡出，不再需要远距补偿）
      const dr = sim._detailRadius(s) || sim._systemRadius(s);
      const cd = Math.hypot(
        camera.position.x - s.pos[0],
        camera.position.y - s.pos[1],
        camera.position.z - s.pos[2],
      );
      const farFade = 1 - smoothstep(dr * 3.2, dr * 4.5, cd);
      v.mat.uniforms.uBoost.value = clamp01((cd - dr * 1.5) / (dr * 2.5)) * farFade;
      v.mat.uniforms.uFade.value = smoothstep(0.5, 0.7, s.growth) * farFade;
      v.points.visible = v.mat.uniforms.uFade.value > 0.01 && cd < PREVIEW_CULL;
    }
  }

  function updateDetailVisuals(alpha) {
    for (const s of sim.seeds) {
      let v = detailVisuals.get(s.idx);
      if (s.detail) {
        const bodies = s.detail.bodies;
        if (!v) {
          // 预留二级系统槽位：靠近恒星后生成的行星/卫星与行星环粒子
          // 追加写入同一点云（环粒子较多，槽位给足）
          const CHILD_CAP = 340; // 子星系恒星 + 行星环/二级行星的槽位预算
          const cap = bodies.length + CHILD_CAP;
          const geo = new THREE.BufferGeometry();
          const pos = new Float32Array(cap * 3);
          const col = new Float32Array(cap * 3);
          const size = new Float32Array(cap);
          geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
          geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
          const mat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
            vertexShader: `
              attribute float aSize;
              varying vec3 vColor;
              void main() {
                vColor = color;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = aSize * (620.0 / max(1.0, -mv.z));
                gl_Position = projectionMatrix * mv;
              }
            `,
            fragmentShader: `
              varying vec3 vColor;
              void main() {
                float d = length(gl_PointCoord - 0.5) * 2.0;
                float a = (1.0 - smoothstep(0.08, 1.0, d)) * 0.9;
                if (a < 0.01) discard;
                gl_FragColor = vec4(vColor, a);
              }
            `,
          });
          const points = new THREE.Points(geo, mat);
          points.frustumCulled = false;
          points.renderOrder = 5;
          scene.add(points);
          v = { points, geo, mat, pos, col, size };
          detailVisuals.set(s.idx, v);
        }
        const pos = v.pos, col = v.col, size = v.size;
        for (let i = 0; i < bodies.length; i++) {
          const b = bodies[i];
          // 未发现的天体真正不可见：发现是逐个、由小球行进驱动的
          if (b._hidden) {
            size[i] = 0;
            continue;
          }
          // 发现出场：天体停在它真实的轨道位置上原地淡入——
          // 远景成员点云早已把它画在那里，所以"发现"是看清，不是凭空出现
          // （revealT 由 sim 侧按天体推进，与全系统距离无关）
          const fadeIn = clamp01(b.revealT ?? 1);
          const ease = easeInOut(fadeIn);
          if (b.orbit) {
            // 在相邻两个物理步之间插值轨道角（平近点角），让绕行天体平滑运动；
            // 椭圆轨道经 orbitPolar 求真近点角与半径（对 θ 插值天然连续）
            const ang = b.prevAngle + (b.orbit.angle - b.prevAngle) * alpha;
            const pol = orbitPolar(b.orbit, ang);
            const c = Math.cos(pol[0]), sn = Math.sin(pol[0]);
            const rEff = pol[1];
            pos[i * 3] = s.pos[0] + s.u[0] * c * rEff + s.v[0] * sn * rEff + s.axis[0] * b.orbit.height;
            pos[i * 3 + 1] = s.pos[1] + s.u[1] * c * rEff + s.v[1] * sn * rEff + s.axis[1] * b.orbit.height;
            pos[i * 3 + 2] = s.pos[2] + s.u[2] * c * rEff + s.v[2] * sn * rEff + s.axis[2] * b.orbit.height;
          } else {
            pos[i * 3] = b.pos[0]; pos[i * 3 + 1] = b.pos[1]; pos[i * 3 + 2] = b.pos[2];
          }
          const tint = b.colorSeed;
          if (b.type === 'gas') {
            col[i * 3] = 0.50 + tint * 0.25;
            col[i * 3 + 1] = 0.35 + tint * 0.25;
            col[i * 3 + 2] = 0.85 + tint * 0.15;
            size[i] = 0.18 + tint * 0.12;
          } else if (b.type === 'star') {
            // 恒星光温分层：蓝白 → 黄白 → 橙红，"满天星"的层次感
            if (tint < 0.28) {
              col[i * 3] = 0.72; col[i * 3 + 1] = 0.84; col[i * 3 + 2] = 1.0;
            } else if (tint < 0.68) {
              col[i * 3] = 1.0; col[i * 3 + 1] = 0.88; col[i * 3 + 2] = 0.62;
            } else {
              col[i * 3] = 1.0; col[i * 3 + 1] = 0.58; col[i * 3 + 2] = 0.34;
            }
            size[i] = 0.55 + tint * 0.55;
          } else if (b.type === 'planet') {
            col[i * 3] = 0.55 + tint * 0.2;
            col[i * 3 + 1] = 0.72 + tint * 0.2;
            col[i * 3 + 2] = 0.95;
            size[i] = 0.15;
          } else if (b.type === 'asteroid') {
            // 小行星：暗岩石色小点，成带分布
            col[i * 3] = 0.56 + tint * 0.12;
            col[i * 3 + 1] = 0.50 + tint * 0.10;
            col[i * 3 + 2] = 0.44 + tint * 0.08;
            size[i] = 0.055 + tint * 0.035;
          } else if (b.type === 'galaxy') {
            col[i * 3] = 0.62; col[i * 3 + 1] = 0.70; col[i * 3 + 2] = 1.0;
            size[i] = 0.62;
          } else {
            col[i * 3] = 1.0; col[i * 3 + 1] = 0.55; col[i * 3 + 2] = 0.22;
            size[i] = 0.26;
          }
          // ---- 月相光照（真实感）----
          // 行星 / 星云自身不发光，靠系统中心的恒星照亮。点云 Sprite 无法表现
          // 球面明暗，但可以用**相位**调制整体亮度：被照亮的一面朝向观察者时
          // 亮（满相）、背向时暗（新相）—— 这正是我们看月球时看到的真实效果。
          // 恒星 / 星系核 / 黑洞是自发光体，不参与。
          if (b.type === 'planet' || b.type === 'gas') {
            // 行星是实心不发光体，相位明暗很明显（像看月亮）；星云气体是漫射
            // 发光的尘埃云，方向性弱得多 —— 所以用更浅的调制，避免整片星云
            // 忽明忽暗显得假。
            const shallow = b.type === 'gas';
            const bxp = pos[i * 3], byp = pos[i * 3 + 1], bzp = pos[i * 3 + 2];
            // 指向光源（系统中心的恒星）
            let lx = s.pos[0] - bxp, ly = s.pos[1] - byp, lz = s.pos[2] - bzp;
            const ll = Math.hypot(lx, ly, lz) || 1;
            lx /= ll; ly /= ll; lz /= ll;
            // 指向观察者
            let vx = camera.position.x - bxp, vy = camera.position.y - byp, vz = camera.position.z - bzp;
            const vl = Math.hypot(vx, vy, vz) || 1;
            vx /= vl; vy /= vl; vz /= vl;
            const phase = 0.5 + 0.5 * (lx * vx + ly * vy + lz * vz); // 1=满相 0=新相
            // 行星：0.16~1.0（明暗对比强）；星云：0.62~1.0（只轻轻起伏）
            const lit = shallow ? 0.62 + 0.38 * phase : 0.16 + 0.84 * phase;
            col[i * 3] *= lit;
            col[i * 3 + 1] *= lit;
            col[i * 3 + 2] *= lit;
          }
          // 加色混合下颜色乘 fadeIn 即为透明度：出场时从核心亮起
          col[i * 3] *= fadeIn;
          col[i * 3 + 1] *= fadeIn;
          col[i * 3 + 2] *= fadeIn;
          size[i] *= 0.25 + 0.75 * ease;
          // 降级档位 2：细节点整体缩小，降低 overdraw
          if (sim.config.qualityTier >= 2) size[i] *= 0.8;
        }
        // ---- 二级系统与行星环：追加到预留槽位 ----
        // 显示位置 = 母体显示位置 + 自身轨道偏转（角度同样插值，椭圆同公式）
        const cap = size.length;
        let slot = bodies.length;
        for (const b of bodies) {
          if (!b.children) continue;
          const pb = b;
          // 母体显示位置：与主循环一致（椭圆轨道插值）
          const paM = pb.prevAngle + (pb.orbit.angle - pb.prevAngle) * alpha;
          const ppol = orbitPolar(pb.orbit, paM);
          const pcd = Math.cos(ppol[0]), psn = Math.sin(ppol[0]);
          const prEff = ppol[1];
          const sx = s.pos[0] + s.u[0] * pcd * prEff + s.v[0] * psn * prEff + s.axis[0] * pb.orbit.height;
          const sy = s.pos[1] + s.u[1] * pcd * prEff + s.v[1] * psn * prEff + s.axis[1] * pb.orbit.height;
          const sz = s.pos[2] + s.u[2] * pcd * prEff + s.v[2] * psn * prEff + s.axis[2] * pb.orbit.height;
          // 母体的显形进度：环粒子随母行星一起淡入（星环不能先于行星出现）
          const pReveal = clamp01(pb.revealT ?? 1);
          for (const ch of b.children) {
            if (slot >= cap) break;
            const caM = ch.prevAngle + (ch.orbit.angle - ch.prevAngle) * alpha;
            const cpol = orbitPolar(ch.orbit, caM);
            const ccd = Math.cos(cpol[0]), csn = Math.sin(cpol[0]);
            const crEff = cpol[1];
            const cx = sx + s.u[0] * ccd * crEff + s.v[0] * csn * crEff + s.axis[0] * ch.orbit.height;
            const cy = sy + s.u[1] * ccd * crEff + s.v[1] * csn * crEff + s.axis[1] * ch.orbit.height;
            const cz = sz + s.u[2] * ccd * crEff + s.v[2] * csn * crEff + s.axis[2] * ch.orbit.height;
            const tint = ch.colorSeed;
            if (ch.type === 'ring') {
              // 行星环粒子：冰质淡灰蓝
              pos[slot * 3] = cx; pos[slot * 3 + 1] = cy; pos[slot * 3 + 2] = cz;
              col[slot * 3] = (0.72 + tint * 0.14) * pReveal;
              col[slot * 3 + 1] = (0.76 + tint * 0.12) * pReveal;
              col[slot * 3 + 2] = (0.84 + tint * 0.10) * pReveal;
              size[slot] = (0.045 + tint * 0.03) * pReveal;
            } else {
              pos[slot * 3] = cx; pos[slot * 3 + 1] = cy; pos[slot * 3 + 2] = cz;
              if (ch.type === 'gas') {
                col[slot * 3] = 0.50 + tint * 0.25;
                col[slot * 3 + 1] = 0.35 + tint * 0.25;
                col[slot * 3 + 2] = 0.85 + tint * 0.15;
                size[slot] = 0.10 + tint * 0.08;
              } else if (ch.type === 'star') {
                // 子星系恒星（超星系团星系核）：光温三段，与主点云一致
                if (tint < 0.28) {
                  col[slot * 3] = 0.62; col[slot * 3 + 1] = 0.78; col[slot * 3 + 2] = 1.0;
                } else if (tint < 0.68) {
                  col[slot * 3] = 1.0; col[slot * 3 + 1] = 0.88; col[slot * 3 + 2] = 0.62;
                } else {
                  col[slot * 3] = 1.0; col[slot * 3 + 1] = 0.58; col[slot * 3 + 2] = 0.34;
                }
                size[slot] = 0.16 + tint * 0.16;
              } else {
                col[slot * 3] = 0.55 + tint * 0.2;
                col[slot * 3 + 1] = 0.72 + tint * 0.2;
                col[slot * 3 + 2] = 0.95;
                size[slot] = 0.10;
              }
            }
            if (sim.config.qualityTier >= 2) size[slot] *= 0.8;
            slot++;
            // 二级行星自己的粒子环（最后一级嵌套）
            if (ch.children) {
              for (const rg of ch.children) {
                if (slot >= cap) break;
                const raM = rg.prevAngle + (rg.orbit.angle - rg.prevAngle) * alpha;
                const rpol = orbitPolar(rg.orbit, raM);
                const rcd = Math.cos(rpol[0]), rsn = Math.sin(rpol[0]);
                const rrEff = rpol[1];
                pos[slot * 3] = cx + s.u[0] * rcd * rrEff + s.v[0] * rsn * rrEff + s.axis[0] * rg.orbit.height;
                pos[slot * 3 + 1] = cy + s.u[1] * rcd * rrEff + s.v[1] * rsn * rrEff + s.axis[1] * rg.orbit.height;
                pos[slot * 3 + 2] = cz + s.u[2] * rcd * rrEff + s.v[2] * rsn * rrEff + s.axis[2] * rg.orbit.height;
                const rtint = rg.colorSeed;
                col[slot * 3] = (0.72 + rtint * 0.14) * pReveal;
                col[slot * 3 + 1] = (0.76 + rtint * 0.12) * pReveal;
                col[slot * 3 + 2] = (0.84 + rtint * 0.10) * pReveal;
                size[slot] = (0.04 + rtint * 0.025) * pReveal;
                if (sim.config.qualityTier >= 2) size[slot] *= 0.8;
                slot++;
              }
            }
          }
        }
        // 未用槽位尺寸清零（children 生成后不会消失，通常无需清理，防御旧数据）
        for (let i = slot; i < cap; i++) size[i] = 0;
        v.geo.attributes.position.needsUpdate = true;
        v.geo.attributes.color.needsUpdate = true;
        v.geo.attributes.aSize.needsUpdate = true;
        v.points.visible = true;
      } else if (v) {
        scene.remove(v.points);
        v.geo.dispose();
        v.mat.dispose();
        detailVisuals.delete(s.idx);
      }
    }
  }

  function updateStructures(dtReal, audioLevels, pulse) {
    const k = Math.min(1, dtReal * 2.8);
    for (let i = 0; i < sim.seeds.length; i++) {
      const s = sim.seeds[i];
      const g = seedGroups[i];
      const lv = s.level;
      g.group.position.set(s.pos[0], s.pos[1], s.pos[2]);
      // 集合类系统（星团/星系/超星系团/尘埃云）成形后，远景的"单个发光天体"
      // 表达让位于成员点云：视觉从"一个天体"切换成"一群天体"。
      // 盘面/光晕仍随小球接近（detailR*1.15 → detailR*0.7）淡出，
      // 那是星系轮廓的底雾，只在贴身时散去。
      const pd = Math.hypot(
        sim.probe.pos[0] - s.pos[0],
        sim.probe.pos[1] - s.pos[1],
        sim.probe.pos[2] - s.pos[2],
      );
      const detailR = sim._detailRadius(s) || sim._systemRadius(s);
      const isCollection = lv === 'cluster' || lv === 'galaxy' || lv === 'supercluster'
        || lv === 'dust' || lv === 'void';
      // 集合系统成形后（成员点云接管）分档让位：
      //  - 实心球彻底退出——它最像"一个天体"
      //  - 中心亮斑只留一点核球辉光，免得点云中心显得空
      //  - 盘面（圆环贴图）彻底退场——星系轮廓必须由真实成员粒子构成，
      //    不允许"一张贴图模拟多天体"（用户明确要求）；形成过程中盘面
      //    仍可用作原星系盘的过渡表达
      //  - 光晕只保留远处未分辨星系应有的"一小团光"，贴身即散
      //  - 超星系团伴星系核的光点淡出，交给点云里的 6 个星系核成员
      // 让位随 growth 平滑推进（0.6→0.85），与成员点云的淡入区间
      // （growth 0.5→0.7）错开，中间不会出现"两边都不可见"的空窗。
      const cloudMix = isCollection ? smoothstep(0.6, 0.85, s.growth) : 0;
      const solidFade = 1 - cloudMix;
      const coreFade = isCollection ? 1 - cloudMix * 0.85 : 1;
      // 星系/超星系团：halo 作为"星系轮廓光"保持到贴身（成员粒子已大幅
      // 加密，但整体发光轮廓仍由 halo 提供——接近时不会"空荡荡"）；
      // 其他集合类（星团/星云）维持原有的中距离散场
      const haloHold = (lv === 'galaxy' || lv === 'supercluster') ? 0.22 : 0.7;
      const nearFade = isCollection
        ? smoothstep(detailR * haloHold, detailR * (haloHold + 0.45), pd)
        : 1;
      const mistFade = (1 - cloudMix * 0.45) * nearFade;
      const diskFade = 1 - cloudMix;                 // 盘面贴图成形后彻底退场
      const haloDim = 1 - 0.55 * cloudMix;           // 光晕压成远处的一小团核光
      const nodeDim = 1 - 0.85 * cloudMix;           // 伴星系核光点让位给成员点云
      const m4 = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(s.u[0], s.u[1], s.u[2]),
        new THREE.Vector3(s.v[0], s.v[1], s.v[2]),
        new THREE.Vector3(s.axis[0], s.axis[1], s.axis[2]),
      );
      g.group.quaternion.setFromRotationMatrix(m4);

      if (lv !== g.level) {
        g.level = lv;
        g.solid.material.color.copy(levelColorTinted(lv, g));
        if (lv === 'blackhole') g.solid.material.color.setRGB(0, 0, 0);
      }
      const targetCore = levelCoreScale(lv, s);
      g.coreScale += (targetCore - g.coreScale) * k;
      g.core.scale.setScalar(Math.max(0.001, g.coreScale * pulse));
      g.core.material.color.copy(levelColorTinted(lv, g));
      // 核球辉光也要乘 nearFade：此前只压到 15% 却不随接近退场，
      // 小球深入星系后中心还挂着一个大光球——"星系整体"本该消失
      // （三段式：近处只剩单个天体，任何整体表达都必须退干净）
      g.core.material.opacity = coreFade * nearFade;
      g.core.visible = lv !== 'blackhole' && g.core.material.opacity > 0.02;

      const targetSolid = levelSolidScale(lv, s);
      const bhScale = 1.65 + s.mass * 0.34; // 黑洞视界/吸积盘/光子环共用的尺度基准
      // 黑洞视界黑球用 bhScale（与吸积盘/光子环同一基准），其余天体用 targetSolid
      g.solid.scale.setScalar(lv === 'blackhole' ? bhScale : targetSolid * pulse);
      // 集合类系统成形后远景实心球退出（成员点云接管）；黑洞视界黑球保留
      g.solid.visible = lv !== 'void' && targetSolid > 0.01 && solidFade > 0.05;
      if (lv === 'blackhole') {
        g.solid.material.color.setRGB(0, 0, 0);
      } else {
        g.solid.material.color.copy(levelColorTinted(lv, g));
        g.solid.material.color.offsetHSL(0, -0.05, 0.15);
      }

      const isDisk = lv === 'galaxy' || lv === 'supercluster';
      const isBH = lv === 'blackhole';
      const targetDisk = isDisk ? 1 : 0;
      g.diskAmt += (targetDisk - g.diskAmt) * k;
      g.bhAmt += ((isBH ? 1 : 0) - g.bhAmt) * k;
      g.nodeAmt += ((lv === 'supercluster' ? 1 : 0) - g.nodeAmt) * k;

      // 旋涡星系盘（原星系阶段的过渡表达；成形后由成员粒子接管，退场）
      // 尺寸与本体尺度成比例：星系 detailR 115、超星系团 100
      const diskBase = lv === 'supercluster' ? 44 + s.mass * 5 : 30 + s.mass * 4;
      g.disk.scale.setScalar(Math.max(0.001, diskBase * (0.22 + 0.78 * g.diskAmt) * pulse));
      g.disk.material.opacity = (0.14 + 0.46 * g.diskAmt * (0.8 + audioLevels.bass * 0.3)) * mistFade * diskFade;
      g.disk.material.color.copy(levelColorTinted(lv, g));
      g.disk.visible = g.diskAmt > 0.01 && diskFade > 0.02 && mistFade > 0.02;

      // 黑洞：事件视界(黑球) + 吸积盘 + 光子环 + 喷流
      g.accretionDisk.scale.setScalar(Math.max(0.001, bhScale * (0.4 + 0.6 * g.bhAmt)));
      g.accretionDisk.visible = g.bhAmt > 0.01;
      g.photonRing.scale.setScalar(Math.max(0.001, bhScale * (0.4 + 0.6 * g.bhAmt)));
      g.photonRing.material.opacity = 0.9 * g.bhAmt;
      g.photonRing.visible = g.bhAmt > 0.01;
      const jetScale = bhScale * (0.55 + 0.18 * Math.sin(sim.time * 6 + i * 1.7) + audioLevels.beat * 0.25) * g.bhAmt;
      g.jetA.scale.setScalar(Math.max(0.001, jetScale));
      g.jetB.scale.setScalar(Math.max(0.001, jetScale));
      g.jetA.position.z = bhScale * 0.82;
      g.jetB.position.z = -bhScale * 0.82;
      g.jetA.material.opacity = 0.4 * g.bhAmt;
      g.jetB.material.opacity = 0.4 * g.bhAmt;
      g.jetA.visible = g.jetB.visible = g.bhAmt > 0.01;

      // 光晕：休眠/形成中的种子也要清晰可见（航线上亮起的光点），
      // 大结构（星系）的光晕随结构成形淡入。黑洞**没有**光晕——
      // 它本身是黑的，周围只有吸积盘与光子环的细光，不能加夸张辉光。
      let haloTarget, haloFade;
      if (lv === 'galaxy') { haloTarget = 30 + s.mass * 5; haloFade = g.diskAmt; }
      else if (lv === 'supercluster') { haloTarget = 30 + s.mass * 5; haloFade = g.diskAmt; }
      else if (lv === 'blackhole') { haloTarget = 0; haloFade = 0; }
      else if (lv === 'cluster') { haloTarget = 3.2 + s.mass * 0.8; haloFade = 0.55; }
      else if (lv === 'star') { haloTarget = 1.7 + s.mass * 0.5; haloFade = 0.5; }
      else if (lv === 'planet') { haloTarget = 1.3 + s.mass * 0.4; haloFade = 0.4; }
      else { haloTarget = 2.4 + s.mass * 0.6; haloFade = 0.9; } // void / dust
      g.halo.scale.setScalar(Math.max(0.001, haloTarget * pulse * (0.5 + 0.5 * Math.max(g.diskAmt, g.bhAmt))));
      g.halo.material.color.copy(levelColorTinted(lv, g));
      // 星系/超星系团成形后光晕压暗：远处仍是一小团可辨识的光（真实：
      // 未分辨的远方星系就是一个光斑），但不再是"贴图底雾"
      g.halo.material.opacity = 0.30 * haloFade * mistFade
        * (lv === 'galaxy' || lv === 'supercluster' ? haloDim : 1);
      g.halo.visible = g.halo.material.opacity > 0.01;

      // 超星系团伴星系核（成形后由点云里的 6 个星系核成员接管）
      for (let n = 0; n < g.nodes.length; n++) {
        g.nodes[n].scale.setScalar((0.28 + (n % 3) * 0.12) * g.nodeAmt * pulse);
        g.nodes[n].material.opacity = 0.7 * g.nodeAmt * mistFade * nodeDim;
        g.nodes[n].visible = g.nodeAmt > 0.01 && nodeDim > 0.02 && mistFade > 0.02;
      }

      // 旋转动画：星系盘与黑洞吸积盘持续旋转
      const spinBase = lv === 'blackhole' ? 2.2 : lv === 'galaxy' ? 0.85 : lv === 'supercluster' ? 0.5 : 0.25;
      g.diskAngle += dtReal * spinBase * (0.75 + audioLevels.bass * 0.8);
      g.disk.rotation.z = g.diskAngle;
      // 吸积盘随黑洞自转（多普勒亮斑跟着盘转）；光子环对称，不随盘旋转
      g.accretionDisk.rotation.z = g.diskAngle * 0.55;
      g.photonRing.rotation.z = 0;
    }
  }

  return { seedGroups, detailVisuals, previewVisuals, updatePreviewClouds, updateDetailVisuals, updateStructures };
}


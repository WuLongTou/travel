// 渲染引擎核心：场景/相机/渲染循环/后处理(Bloom)
// 一个场景常驻；世界切换 = 更换 content group + 相机初始位。
// 背景（天球星空）按层配置；CMB 壳只在 cosmos 层。
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildAmbient } from './background.js';
import type { ChaseCam } from './camera.js';
import type { AmbientSpec } from '../types.js';

/** 画质档：影响像素比与 Bloom 强度（渲染参数级，即时生效不重建世界） */
export type QualityLevel = 'low' | 'medium' | 'high';

export const QUALITY_PRESETS: Record<QualityLevel, { pixelRatio: number; bloom: number }> = {
  low: { pixelRatio: 0.75, bloom: 0.15 },
  medium: { pixelRatio: 1.0, bloom: 0.3 },
  // high = 出厂默认观感（Bloom 0.35 与构造初值一致，视网膜屏全像素比）
  high: { pixelRatio: Math.min(window.devicePixelRatio || 1, 2), bloom: 0.35 },
};

export class CosmicEngine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  contentGroup = new THREE.Group();
  backgroundGroup = new THREE.Group();
  ambientGroup: THREE.Group | null = null;
  /** 追尾相机引用（main 装配注入；navigator 用其 followDist） */
  chaseCam: ChaseCam | null = null;

  constructor(canvas: HTMLCanvasElement) {
    // 对数深度缓冲：真实尺度宇宙要求 1e-7 AU（万 km 级特写）到 1e7 AU
    // 宏观视野连续覆盖，普通深度缓冲精度无法支撑
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000005);
    const w = window.innerWidth, h = window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(60, w / h, 1e-7, 2e7);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.7, 0.55);
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());
    this.bloom = bloom;
    // 常驻：内容组（当前世界实体）+ 远景背景组 + 标签组
    this.contentGroup = new THREE.Group();
    this.scene.add(this.contentGroup);
    this.backgroundGroup = new THREE.Group();
    this.scene.add(this.backgroundGroup);
    window.addEventListener('resize', () => this._resize());
    this._resize();
  }

  private _resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w/h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  // 世界加载：清空内容组与背景组，加入新组
  loadWorld(world: { ambient?: AmbientSpec }, entitiesGroup?: THREE.Group, backgroundObjects: THREE.Object3D[] = []): void {
    this._disposeGroup(this.contentGroup);
    this._disposeGroup(this.backgroundGroup);
    if (entitiesGroup) this.contentGroup.add(entitiesGroup);
    // 世界背景：跟随相机的星空（永远围绕相机）
    this.ambientGroup = buildAmbient(world.ambient || {}, this.camera);
    this.backgroundGroup.add(this.ambientGroup);
    for (const o of backgroundObjects) this.backgroundGroup.add(o);
  }

  // 每帧更新背景跟随相机
  updateAmbient(): void {
    if (this.ambientGroup) this.ambientGroup.position.copy(this.camera.position);
  }

  private _disposeGroup(g: THREE.Group): void {
    g.traverse((o) => {
      // three 的 isXxx 布尔是运行时类型判别（类层级未建模），收窄后释放资源
      const obj = o as THREE.Mesh | THREE.Points | THREE.Line | THREE.Sprite;
      const isRenderable = (obj as THREE.Mesh).isMesh || (obj as THREE.Points).isPoints
        || (obj as THREE.Line).isLine || (obj as THREE.Sprite).isSprite;
      if (isRenderable) {
        if (obj.geometry) obj.geometry.dispose();
        const mat = (obj as THREE.Mesh).material;
        if (mat) {
          const mats = Array.isArray(mat) ? mat : [mat];
          for (const m of mats) {
            const withMap = m as THREE.Material & { map?: THREE.Texture | null };
            if (withMap.map) withMap.map.dispose();
            m.dispose();
          }
        }
      }
    });
    while (g.children.length) g.remove(g.children[0]);
  }

  /** 画质档切换：即时调整像素比与 Bloom（低配设备适配） */
  setQuality(level: QualityLevel): void {
    const preset = QUALITY_PRESETS[level];
    this.renderer.setPixelRatio(preset.pixelRatio);
    this.bloom.strength = preset.bloom;
    this._resize(); // 像素比变化后按新比率重建缓冲
  }

  get qualityLevel(): QualityLevel {
    const pr = this.renderer.getPixelRatio();
    if (Math.abs(pr - QUALITY_PRESETS.low.pixelRatio) < 0.01) return 'low';
    if (Math.abs(pr - QUALITY_PRESETS.medium.pixelRatio) < 0.01) return 'medium';
    return 'high';
  }

  render(_dtReal: number): void {
    this.updateAmbient();
    this.composer.render();
  }

  dispose(): void {
    this._disposeGroup(this.contentGroup);
    this._disposeGroup(this.backgroundGroup);
    this.composer.dispose();
    this.renderer.dispose();
  }
}

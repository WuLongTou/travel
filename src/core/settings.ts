// 用户设置持久化管理器
// 管理音量、相机震屏、画质档位及 localStorage 读写容错

export const SETTINGS_KEY = 'universe-roam-settings';
export const QUALITIES = ['low', 'medium', 'high'] as const;
export type Quality = (typeof QUALITIES)[number];

export interface UserSettings {
  volume: number; // 0..1
  shake: boolean;
  quality: Quality;
}

export interface SettingsHooks {
  onVolumeChange?: (vol: number) => void;
  onShakeChange?: (shake: boolean) => void;
  onQualityChange?: (quality: Quality) => void;
}

export class SettingsManager {
  private storage: Storage | null;
  private hooks: SettingsHooks;
  settings: UserSettings;

  constructor(
    storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null,
    hooks: SettingsHooks = {},
  ) {
    this.storage = storage;
    this.hooks = hooks;
    this.settings = this.load();
  }

  load(): UserSettings {
    try {
      if (!this.storage) return { volume: 0.5, shake: true, quality: 'high' };
      const raw = this.storage.getItem(SETTINGS_KEY);
      const s = raw ? JSON.parse(raw) : {};
      return {
        volume: Number.isFinite(s.volume) ? Math.min(1, Math.max(0, s.volume)) : 0.5,
        shake: s.shake !== false,
        quality: (QUALITIES as readonly string[]).includes(s.quality) ? (s.quality as Quality) : 'high',
      };
    } catch {
      return { volume: 0.5, shake: true, quality: 'high' };
    }
  }

  save(): void {
    try {
      if (this.storage) {
        this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
      }
    } catch {
      // 忽略隐私模式或存储满异常
    }
  }

  setVolume(v: number): void {
    const clamped = Math.min(1, Math.max(0, v));
    this.settings.volume = clamped;
    this.hooks.onVolumeChange?.(clamped);
    this.save();
  }

  setShake(on: boolean): void {
    this.settings.shake = on;
    this.hooks.onShakeChange?.(on);
    this.save();
  }

  setQuality(q: Quality): void {
    if ((QUALITIES as readonly string[]).includes(q)) {
      this.settings.quality = q;
      this.hooks.onQualityChange?.(q);
      this.save();
    }
  }

  applyInitial(): void {
    this.hooks.onVolumeChange?.(this.settings.volume);
    this.hooks.onShakeChange?.(this.settings.shake);
    this.hooks.onQualityChange?.(this.settings.quality);
  }
}

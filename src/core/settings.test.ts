import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_KEY, SettingsManager, type UserSettings } from './settings.js';

class MockStorage implements Storage {
  private store: Record<string, string> = {};
  get length(): number {
    return Object.keys(this.store).length;
  }
  clear(): void {
    this.store = {};
  }
  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }
  key(index: number): string | null {
    return Object.keys(this.store)[index] ?? null;
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  setItem(key: string, value: string): void {
    this.store[key] = value;
  }
}

describe('SettingsManager', () => {
  it('在无存储时使用默认配置', () => {
    const mgr = new SettingsManager(null);
    expect(mgr.settings).toEqual({
      volume: 0.5,
      shake: true,
      quality: 'high',
    });
  });

  it('容错解析损坏的 JSON 数据', () => {
    const storage = new MockStorage();
    storage.setItem(SETTINGS_KEY, 'invalid-json{');
    const mgr = new SettingsManager(storage);
    expect(mgr.settings).toEqual({
      volume: 0.5,
      shake: true,
      quality: 'high',
    });
  });

  it('读取合法的存储并正确赋值', () => {
    const storage = new MockStorage();
    const saved: UserSettings = {
      volume: 0.8,
      shake: false,
      quality: 'medium',
    };
    storage.setItem(SETTINGS_KEY, JSON.stringify(saved));
    const mgr = new SettingsManager(storage);
    expect(mgr.settings).toEqual(saved);
  });

  it('setVolume 会进行 0..1 clamp 并通知 hook 和持久化', () => {
    const storage = new MockStorage();
    const onVolumeChange = vi.fn();
    const mgr = new SettingsManager(storage, { onVolumeChange });

    mgr.setVolume(1.5);
    expect(mgr.settings.volume).toBe(1.0);
    expect(onVolumeChange).toHaveBeenCalledWith(1.0);
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!).volume).toBe(1.0);

    mgr.setVolume(-0.2);
    expect(mgr.settings.volume).toBe(0);
    expect(onVolumeChange).toHaveBeenCalledWith(0);
  });

  it('setShake 触发 hook 并持久化', () => {
    const storage = new MockStorage();
    const onShakeChange = vi.fn();
    const mgr = new SettingsManager(storage, { onShakeChange });

    mgr.setShake(false);
    expect(mgr.settings.shake).toBe(false);
    expect(onShakeChange).toHaveBeenCalledWith(false);
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!).shake).toBe(false);
  });

  it('setQuality 校验合法性并持久化', () => {
    const storage = new MockStorage();
    const onQualityChange = vi.fn();
    const mgr = new SettingsManager(storage, { onQualityChange });

    mgr.setQuality('low');
    expect(mgr.settings.quality).toBe('low');
    expect(onQualityChange).toHaveBeenCalledWith('low');

    // 非法值忽略
    // @ts-expect-error 测试非法输入
    mgr.setQuality('ultra');
    expect(mgr.settings.quality).toBe('low');
  });

  it('applyInitial 一次性触发初始配置应用', () => {
    const onVolumeChange = vi.fn();
    const onShakeChange = vi.fn();
    const onQualityChange = vi.fn();

    const mgr = new SettingsManager(null, {
      onVolumeChange,
      onShakeChange,
      onQualityChange,
    });

    mgr.applyInitial();
    expect(onVolumeChange).toHaveBeenCalledWith(0.5);
    expect(onShakeChange).toHaveBeenCalledWith(true);
    expect(onQualityChange).toHaveBeenCalledWith('high');
  });
});

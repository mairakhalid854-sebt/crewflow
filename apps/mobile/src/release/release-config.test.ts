/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type AppConfig = {
  expo: {
    android: {
      adaptiveIcon: {
        foregroundImage: string;
        monochromeImage: string;
      };
      icon: string;
    };
    icon: string;
    plugins: unknown[];
  };
};

type EasConfig = {
  build: Record<string, unknown>;
};

const mobileRoot = resolve(__dirname, '..', '..');

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(mobileRoot, name), 'utf8')) as T;
}

function pngDimensions(relativePath: string): {
  readonly height: number;
  readonly width: number;
} {
  const bytes = readFileSync(resolve(mobileRoot, relativePath));
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  return {
    height: bytes.readUInt32BE(20),
    width: bytes.readUInt32BE(16),
  };
}

describe('mobile release configuration', () => {
  it('references square release assets with store-safe dimensions', () => {
    const config = readJson<AppConfig>('app.json').expo;

    expect(config.icon).toBe('./assets/icon.png');
    expect(config.android.icon).toBe('./assets/icon.png');
    expect(config.android.adaptiveIcon.foregroundImage).toBe(
      './assets/adaptive-icon.png',
    );
    expect(config.android.adaptiveIcon.monochromeImage).toBe(
      './assets/adaptive-monochrome.png',
    );
    expect(pngDimensions('assets/icon.png')).toEqual({
      height: 1024,
      width: 1024,
    });
    expect(pngDimensions('assets/adaptive-icon.png')).toEqual({
      height: 1024,
      width: 1024,
    });
    expect(pngDimensions('assets/adaptive-monochrome.png')).toEqual({
      height: 1024,
      width: 1024,
    });
    expect(pngDimensions('assets/splash-icon.png')).toEqual({
      height: 1024,
      width: 1024,
    });
    expect(pngDimensions('assets/notification-icon.png')).toEqual({
      height: 96,
      width: 96,
    });
  });

  it('keeps development, simulator, preview, and production build profiles', () => {
    const config = readJson<EasConfig>('eas.json');

    expect(Object.keys(config.build)).toEqual([
      'development',
      'development-simulator',
      'preview',
      'preview-simulator',
      'production',
    ]);
  });
});

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LlmConfigManager } from '../src/llm/llm-config.js';
import { LlmProviderType } from '../src/llm/provider.js';
import { NpmSafeEngine } from '../src/index.js';

const envBackup = { ...process.env };

function cleanEnv() {
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.GEMINI_BASE_URL;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.OPENAI_MODEL;
  delete process.env.GEMINI_MODEL;
  delete process.env.ANTHROPIC_MODEL;
}

function restoreEnv() {
  process.env = { ...envBackup };
}

describe('LlmConfigManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'npm-safe-llm-'));
    cleanEnv();
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    restoreEnv();
  });

  it('defaults to disabled with openai provider', () => {
    const manager = new LlmConfigManager(path.join(tmpDir, 'llm.json'));
    const config = manager.getConfig();
    expect(config.enabled).toBe(false);
    expect(config.provider).toBe(LlmProviderType.OpenAi);
    expect(config.apiKey).toBeUndefined();
    expect(config.maxTokens).toBe(4096);
    expect(manager.createProvider()).toBeUndefined();
  });

  it('returns masked status without exposing the full key', () => {
    const manager = new LlmConfigManager(path.join(tmpDir, 'llm.json'));
    manager.setConfig({ apiKey: 'sk-test-secret-key-1234', enabled: true });
    const status = manager.getStatus();
    expect(status.configured).toBe(true);
    expect(status.apiKey?.includes('secret')).toBe(false);
    expect(status.apiKey?.startsWith('sk-t')).toBeTruthy();
    expect(status.apiKey?.endsWith('1234')).toBeTruthy();
  });

  it('creates a provider when enabled and an api key is set', () => {
    const manager = new LlmConfigManager(path.join(tmpDir, 'llm.json'));
    manager.setConfig({ provider: LlmProviderType.OpenAi, apiKey: 'sk-openai', enabled: true });
    const provider = manager.createProvider();
    expect(provider).toBeTruthy();
  });

  it('does not create a provider when disabled even with a key', () => {
    const manager = new LlmConfigManager(path.join(tmpDir, 'llm.json'));
    manager.setConfig({ apiKey: 'sk-openai', enabled: false });
    expect(manager.createProvider()).toBeUndefined();
  });

  it('falls back to environment variables for api key, base url, and model', () => {
    process.env.OPENAI_API_KEY = 'env-openai-key';
    process.env.OPENAI_BASE_URL = 'https://openai.example.com';
    process.env.OPENAI_MODEL = 'gpt-env';
    const manager = new LlmConfigManager(path.join(tmpDir, 'llm.json'));
    manager.setConfig({ enabled: true });
    const status = manager.getStatus();
    expect(status.configured).toBe(true);
    expect(status.baseUrl).toBe('https://openai.example.com');
    expect(status.model).toBe('gpt-env');
    const provider = manager.createProvider();
    expect(provider).toBeTruthy();
  });

  it('prefers persisted config over environment variables', () => {
    process.env.OPENAI_API_KEY = 'env-openai-key';
    process.env.OPENAI_MODEL = 'gpt-env';
    const manager = new LlmConfigManager(path.join(tmpDir, 'llm.json'));
    manager.setConfig({ apiKey: 'persisted-key', model: 'gpt-persisted', enabled: true });
    const status = manager.getStatus();
    expect(status.configured).toBe(true);
    expect(status.apiKey?.startsWith('pers')).toBeTruthy();
    expect(status.model).toBe('gpt-persisted');
  });

  it('ignores invalid provider values and falls back to openai', () => {
    const manager = new LlmConfigManager(path.join(tmpDir, 'llm.json'));
    manager.setConfig({ provider: 'unknown' as LlmProviderType });
    expect(manager.getConfig().provider).toBe(LlmProviderType.OpenAi);
  });

  it('persists and reloads configuration', () => {
    const file = path.join(tmpDir, 'llm.json');
    const first = new LlmConfigManager(file);
    first.setConfig({ enabled: true, provider: LlmProviderType.Gemini, apiKey: 'gemini-key' });

    const second = new LlmConfigManager(file);
    const config = second.getConfig();
    expect(config.enabled).toBe(true);
    expect(config.provider).toBe(LlmProviderType.Gemini);
    expect(config.apiKey).toBe('gemini-key');
  });

  it('uses provider-specific environment variables based on provider', () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-env-key';
    const manager = new LlmConfigManager(path.join(tmpDir, 'llm.json'));
    manager.setConfig({ provider: LlmProviderType.Anthropic, enabled: true });
    expect(manager.getStatus().configured).toBe(true);
    expect(manager.createProvider()).toBeTruthy();
  });

  it('testConnection returns false when not configured', async () => {
    const manager = new LlmConfigManager(path.join(tmpDir, 'llm.json'));
    expect(await manager.testConnection()).toBe(false);
  });
});

describe('NpmSafeEngine LLM config', () => {
  let tmpDir: string;
  let engine: NpmSafeEngine;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'npm-safe-engine-llm-'));
    cleanEnv();
    engine = new NpmSafeEngine({
      dbPath: path.join(tmpDir, 'test.db'),
      llmConfigPath: path.join(tmpDir, 'llm.json'),
    });
  });

  afterEach(() => {
    try {
      engine.close();
    } catch {
      // ignore
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    restoreEnv();
  });

  it('exposes getLlmConfig, getLlmStatus, setLlmConfig, testLlmConnection', () => {
    expect(engine.getLlmConfig().enabled).toBe(false);
    expect(engine.getLlmConfig().maxTokens).toBe(4096);
    expect(engine.getLlmStatus().configured).toBe(false);
    expect(typeof engine.testLlmConnection).toBe('function');
  });

  it('updates the provider at runtime via setLlmConfig', () => {
    engine.setLlmConfig({ enabled: true, apiKey: 'sk-test' });
    const status = engine.getLlmStatus();
    expect(status.enabled).toBe(true);
    expect(status.configured).toBe(true);
  });

  it('does not break when setLlmConfig disables LLM', () => {
    engine.setLlmConfig({ enabled: true, apiKey: 'sk-test' });
    engine.setLlmConfig({ enabled: false });
    expect(engine.getLlmStatus().enabled).toBe(false);
    expect(engine.getLlmConfig().enabled).toBe(false);
  });

  it('returns masked key in status and raw key in config', () => {
    engine.setLlmConfig({ apiKey: 'sk-my-secret-key' });
    expect(engine.getLlmConfig().apiKey).toBe('sk-my-secret-key');
    expect(engine.getLlmStatus().apiKey).not.toBe('sk-my-secret-key');
  });
});

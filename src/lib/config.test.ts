import { describe, expect, it } from 'vitest';
import { allThemes, configToText, DEFAULT_CONFIG, parseConfig, withDefaults } from './config';

describe('config', () => {
  it('fills in missing fields from defaults', () => {
    const c = withDefaults({ fontSize: 20, fonts: { prose: 'Georgia', mono: '' } });
    expect(c.fontSize).toBe(20);
    expect(c.fonts.prose).toBe('Georgia');
    expect(c.pageWidth).toBe(DEFAULT_CONFIG.pageWidth);
    expect(c.snippets.math).toEqual(DEFAULT_CONFIG.snippets.math);
  });

  it('lets users replace a snippet table entirely', () => {
    const c = withDefaults({ snippets: { math: { RR: '\\mathbb{R}' } } as any });
    expect(c.snippets.math).toEqual({ RR: '\\mathbb{R}' });
    expect(c.snippets.text).toEqual(DEFAULT_CONFIG.snippets.text);
  });

  it('round-trips through its text form', () => {
    expect(parseConfig(configToText(DEFAULT_CONFIG))).toEqual(DEFAULT_CONFIG);
  });

  it('rejects malformed config', () => {
    expect(() => parseConfig('[1, 2]')).toThrow();
    expect(() => parseConfig('{ nope')).toThrow();
  });

  it('lists built-in and custom themes once each', () => {
    const c = withDefaults({ themes: { midnight: { colors: {} }, neon: { colors: {} } } });
    expect(allThemes(c)).toEqual(['midnight', 'phosphor', 'paper', 'neon']);
  });
});

import { describe, expect, it } from 'vitest';
import { MessageType, newRequestId } from '@/shared/messaging/protocol.js';

describe('MessageType', () => {
  it('exposes stable string values', () => {
    expect(MessageType.TranslateRequest).toBe('TRANSLATE_REQUEST');
    expect(MessageType.TranslateResult).toBe('TRANSLATE_RESULT');
    expect(MessageType.TranslateError).toBe('TRANSLATE_ERROR');
    expect(MessageType.HotkeyTriggered).toBe('BEELINGO_HOTKEY_TRIGGERED');
    expect(MessageType.ContextMenuTriggered).toBe('BEELINGO_CONTEXT_MENU_TRIGGERED');
  });

  it('all values are distinct', () => {
    const values = new Set(Object.values(MessageType));
    expect(values.size).toBe(Object.keys(MessageType).length);
  });
});

describe('newRequestId', () => {
  it('returns a non-empty string', () => {
    const id = newRequestId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('starts with r', () => {
    expect(newRequestId().startsWith('r')).toBe(true);
  });

  it('produces monotonic unique ids', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(newRequestId());
    expect(ids.size).toBe(1000);
  });
});
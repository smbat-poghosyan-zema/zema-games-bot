import { describe, expect, it } from 'vitest';
import { redact } from '../src/log.js';

describe('redact', () => {
  it('removes bot tokens from URLs and messages', () => {
    const url = 'request to https://api.telegram.org/bot1234567890:AAE6abcdefghijklmnopqrstuvwxyz_-123/getUpdates failed';
    expect(redact(url)).toBe('request to https://api.telegram.org/bot<redacted-token>/getUpdates failed');
  });

  it('leaves normal text alone', () => {
    expect(redact('poll 5012345 closed at 12:30')).toBe('poll 5012345 closed at 12:30');
  });
});

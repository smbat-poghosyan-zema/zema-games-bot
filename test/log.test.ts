import { describe, expect, it } from 'vitest';
import { redact } from '../src/log.js';

describe('redact', () => {
  it('removes bot tokens from URLs and messages', () => {
    // Built at runtime so secret scanners don't mistake the fixture for a real token.
    const fakeToken = `${'1'.repeat(10)}:${'x'.repeat(35)}`;
    const url = `request to https://api.telegram.org/bot${fakeToken}/getUpdates failed`;
    expect(redact(url)).toBe('request to https://api.telegram.org/bot<redacted-token>/getUpdates failed');
  });

  it('leaves normal text alone', () => {
    expect(redact('poll 5012345 closed at 12:30')).toBe('poll 5012345 closed at 12:30');
  });
});

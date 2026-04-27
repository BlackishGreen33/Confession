import { describe, expect, it } from 'vitest';

import { normalizeConfigValue } from './snapshot-codec';

describe('snapshot config normalization', () => {
  it('應保留 minimax-cn provider', () => {
    const config = normalizeConfigValue({
      llm: {
        provider: 'minimax-cn',
        apiKey: 'test-key',
        endpoint: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.7',
      },
    });

    expect(config.llm).toEqual({
      provider: 'minimax-cn',
      apiKey: 'test-key',
      endpoint: 'https://api.minimaxi.com/v1',
      model: 'MiniMax-M2.7',
    });
  });
});

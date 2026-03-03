import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ensureMcpPolicy, isServerWhitelisted } from './policy'

describe('mcp policy', () => {
  const originalWhitelist = process.env.CONFESSION_MCP_WHITELIST

  beforeEach(() => {
    process.env.CONFESSION_MCP_WHITELIST = 'trusted-server'
  })

  afterEach(() => {
    process.env.CONFESSION_MCP_WHITELIST = originalWhitelist
  })

  it('允許內建 server 的安全能力', () => {
    expect(isServerWhitelisted('builtin:pattern')).toBe(true)
    expect(ensureMcpPolicy('builtin:pattern', 'pattern_scan')).toEqual({ allowed: true })
  })

  it('拒絕未白名單 server', () => {
    const result = ensureMcpPolicy('unknown-server', 'pattern_scan')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('未列入白名單')
  })

  it('拒絕高風險能力', () => {
    const result = ensureMcpPolicy('trusted-server', 'network_probe')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('不在允許清單')
  })
})

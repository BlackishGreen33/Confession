import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { invokeMcpTool } from './broker'

describe('mcp broker', () => {
  const originalWhitelist = process.env.CONFESSION_MCP_WHITELIST

  beforeEach(() => {
    process.env.CONFESSION_MCP_WHITELIST = 'trusted-server'
  })

  afterEach(() => {
    process.env.CONFESSION_MCP_WHITELIST = originalWhitelist
  })

  it('pattern_scan 內建工具可回傳證據', async () => {
    const result = await invokeMcpTool({
      serverName: 'builtin:pattern',
      toolName: 'pattern_scan',
      filePath: '/a.ts',
      language: 'typescript',
      code: 'const x = eval(userInput)',
    })

    expect(result.ok).toBe(true)
    expect(result.evidence.length).toBeGreaterThan(0)
  })

  it('未白名單外部 server 會被拒絕', async () => {
    const result = await invokeMcpTool({
      serverName: 'unknown',
      toolName: 'pattern_scan',
      filePath: '/a.ts',
      language: 'typescript',
      code: 'console.log(1)',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('未列入白名單')
  })
})

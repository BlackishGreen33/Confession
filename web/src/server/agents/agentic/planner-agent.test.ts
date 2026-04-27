import { describe, expect, it } from 'vitest'

import { planForContext } from './planner-agent'
import type { ContextBundle } from './types'

function makeBundle(overrides: Partial<ContextBundle> = {}): ContextBundle {
  return {
    traceId: 'trace-1',
    filePath: '/workspace/a.ts',
    language: 'typescript',
    content: 'eval(userInput)',
    contentDigest: 'abc',
    depth: 'standard',
    hotspots: [
      {
        id: 'p1',
        type: 'dangerous_call',
        language: 'typescript',
        filePath: '/workspace/a.ts',
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 10,
        codeSnippet: 'eval(userInput)',
        patternName: 'eval',
        confidence: 'high',
      },
    ],
    contextBlocks: [
      {
        id: 'ctx_1',
        startLine: 1,
        endLine: 5,
        content: '1|eval(userInput)',
      },
    ],
    totalLines: 5,
    highRiskHotspotCount: 1,
    ...overrides,
  }
}

describe('planner-agent', () => {
  it('會包含核心 skills 與 MCP task', () => {
    const plan = planForContext(makeBundle())

    expect(plan.skills).toContain('ast_hotspots')
    expect(plan.skills).toContain('history_lookup')
    expect(plan.mcpTasks.some((task) => task.toolName === 'pattern_scan')).toBe(true)
  })

  it('quick 模式仍會給出假設', () => {
    const plan = planForContext(
      makeBundle({
        depth: 'quick',
      }),
    )

    expect(plan.hypotheses.length).toBeGreaterThan(0)
  })
})

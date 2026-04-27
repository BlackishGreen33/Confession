import { describe, expect, it } from 'vitest'

import {
  calculateHealthScore,
  type HealthScoreInput,
  type HealthScoreInputTask,
  type HealthScoreInputVulnerability,
} from './health-score'

function buildVulnerability(
  overrides: Partial<HealthScoreInputVulnerability> = {}
): HealthScoreInputVulnerability {
  return {
    filePath: overrides.filePath ?? '/repo/a.ts',
    line: overrides.line ?? 10,
    column: overrides.column ?? 1,
    endLine: overrides.endLine ?? 10,
    endColumn: overrides.endColumn ?? 20,
    type: overrides.type ?? 'unsafe_pattern',
    cweId: overrides.cweId ?? null,
    severity: overrides.severity ?? 'medium',
    description: overrides.description ?? 'test',
    aiConfidence: overrides.aiConfidence ?? 0.7,
    status: overrides.status ?? 'open',
    humanStatus: overrides.humanStatus ?? 'pending',
    createdAt: overrides.createdAt ?? new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-03-01T00:00:00.000Z'),
  }
}

function buildTask(
  overrides: Partial<HealthScoreInputTask> = {}
): HealthScoreInputTask {
  return {
    id: overrides.id ?? 'task-1',
    status: overrides.status ?? 'completed',
    engineMode: overrides.engineMode ?? 'agentic',
    fallbackUsed: overrides.fallbackUsed ?? false,
    totalFiles: overrides.totalFiles ?? 20,
    createdAt: overrides.createdAt ?? new Date('2026-03-04T00:00:00.000Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-03-04T00:02:00.000Z'),
  }
}

function buildInput(
  overrides: Partial<HealthScoreInput> = {}
): HealthScoreInput {
  return {
    vulnerabilities: overrides.vulnerabilities ?? [],
    scanTasks: overrides.scanTasks ?? [],
    latestTask: overrides.latestTask ?? null,
    now: overrides.now ?? new Date('2026-03-04T00:00:00.000Z'),
  }
}

describe('calculateHealthScore', () => {
  it('open critical 增加時，總分不會上升', () => {
    const baseline = calculateHealthScore(
      buildInput({
        vulnerabilities: [
          buildVulnerability({ severity: 'medium', aiConfidence: 0.6 }),
        ],
      })
    )
    const withCritical = calculateHealthScore(
      buildInput({
        vulnerabilities: [
          buildVulnerability({ severity: 'medium', aiConfidence: 0.6 }),
          buildVulnerability({
            filePath: '/repo/b.ts',
            line: 20,
            severity: 'critical',
            aiConfidence: 0.95,
          }),
        ],
      })
    )

    expect(withCritical.score.value).toBeLessThanOrEqual(baseline.score.value)
  })

  it('successRate 提升時，reliability 不會下降', () => {
    const lowSuccessTasks = Array.from({ length: 10 }, (_, index) =>
      buildTask({
        id: `low-${index}`,
        status: index < 5 ? 'completed' : 'failed',
        createdAt: new Date('2026-03-03T00:00:00.000Z'),
        updatedAt: new Date('2026-03-03T00:05:00.000Z'),
      })
    )
    const highSuccessTasks = Array.from({ length: 10 }, (_, index) =>
      buildTask({
        id: `high-${index}`,
        status: index < 9 ? 'completed' : 'failed',
        createdAt: new Date('2026-03-03T00:00:00.000Z'),
        updatedAt: new Date('2026-03-03T00:05:00.000Z'),
      })
    )

    const low = calculateHealthScore(
      buildInput({
        scanTasks: lowSuccessTasks,
        latestTask: lowSuccessTasks[lowSuccessTasks.length - 1],
      })
    )
    const high = calculateHealthScore(
      buildInput({
        scanTasks: highSuccessTasks,
        latestTask: highSuccessTasks[highSuccessTasks.length - 1],
      })
    )

    expect(high.score.components.reliability.value).toBeGreaterThanOrEqual(
      low.score.components.reliability.value
    )
  })

  it('LEV 邊界：無漏洞為 0，p=1 時接近 1', () => {
    const noVuln = calculateHealthScore(buildInput())
    const fullRisk = calculateHealthScore(
      buildInput({
        vulnerabilities: [
          buildVulnerability({
            severity: 'critical',
            aiConfidence: 1,
            humanStatus: 'pending',
          }),
        ],
      })
    )

    expect(noVuln.score.components.exposure.lev).toBe(0)
    expect(fullRisk.score.components.exposure.lev).toBe(1)
  })

  it('輸出應包含 health v2 核心結構', () => {
    const out = calculateHealthScore(buildInput())
    expect(out.score.version).toBe('v2')
    expect(typeof out.score.value).toBe('number')
    expect(out.score.components.exposure).toBeDefined()
    expect(out.score.components.remediation).toBeDefined()
    expect(out.score.components.quality).toBeDefined()
    expect(out.score.components.reliability).toBeDefined()
    expect(Array.isArray(out.score.topFactors)).toBe(true)
    expect(out.score.topFactors.length).toBeLessThanOrEqual(3)
  })

  it('riskWindowDays 切換會影響 remediation/quality 分數', () => {
    const input = buildInput({
      now: new Date('2026-03-30T00:00:00.000Z'),
      vulnerabilities: [
        buildVulnerability({
          filePath: '/repo/old.ts',
          status: 'open',
          humanStatus: 'pending',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
          updatedAt: new Date('2026-03-01T00:00:00.000Z'),
        }),
      ],
    })

    const score7d = calculateHealthScore(input, { riskWindowDays: 7 })
    const score30d = calculateHealthScore(input, { riskWindowDays: 30 })

    expect(score7d.score.components.quality.value).toBeGreaterThan(
      score30d.score.components.quality.value
    )
    expect(score7d.score.components.remediation.value).toBeGreaterThan(
      score30d.score.components.remediation.value
    )
  })

  it('fallback/mttr/p95 變差時，topFactors 會出現對應負向因子', () => {
    const tasks = Array.from({ length: 20 }, (_, index) =>
      buildTask({
        id: `task-${index}`,
        status: 'completed',
        fallbackUsed: index < 12,
        totalFiles: 30,
        createdAt: new Date(
          `2026-03-04T00:${String(index).padStart(2, '0')}:00.000Z`
        ),
        updatedAt: new Date(
          `2026-03-04T02:${String(index).padStart(2, '0')}:00.000Z`
        ),
      })
    )

    const out = calculateHealthScore(
      buildInput({
        vulnerabilities: [
          buildVulnerability({
            status: 'fixed',
            humanStatus: 'confirmed',
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
            updatedAt: new Date('2026-03-04T20:00:00.000Z'),
          }),
        ],
        scanTasks: tasks,
        latestTask: tasks[tasks.length - 1],
      })
    )

    const topKeys = out.score.topFactors.map((factor) => factor.key)
    expect(topKeys).toContain('fallback_rate')
    expect(topKeys).toContain('mttr_hours')
    expect(topKeys).toContain('workspace_p95')
    expect(
      out.score.topFactors.every((factor) => factor.direction === 'negative')
    ).toBe(true)
  })
})

import { invokeMcpTool } from '@server/mcp/broker'

import { runAstHotspotsSkill } from './skills/ast-hotspots'
import { runContextSliceSkill } from './skills/context-slice'
import { runCweMapperSkill } from './skills/cwe-mapper'
import { runHistoryLookupSkill } from './skills/history-lookup'
import { runSanitizerCheckSkill } from './skills/sanitizer-check'
import type { ContextBundle, PlannerPlan, SkillExecutionRecord } from './types'

/**
 * Skill Runner：執行內建 skill + 白名單 MCP task，回傳統一證據結構。
 */
export async function runSkillPlan(
  bundle: ContextBundle,
  plan: PlannerPlan,
): Promise<SkillExecutionRecord[]> {
  const builtinResults = await Promise.all(
    plan.skills.map(async (skill, index) => ({
      index,
      record: await runSkillByName(skill, bundle),
    })),
  )

  const mcpResults = await Promise.all(
    plan.mcpTasks.map(async (task, index) => ({
      index,
      record: await runMcpTask(bundle, task.serverName, task.toolName),
    })),
  )

  return [
    ...builtinResults.sort((a, b) => a.index - b.index).map((item) => item.record),
    ...mcpResults.sort((a, b) => a.index - b.index).map((item) => item.record),
  ]
}

async function runSkillByName(
  skill: PlannerPlan['skills'][number],
  bundle: ContextBundle,
): Promise<SkillExecutionRecord> {
  switch (skill) {
    case 'ast_hotspots':
      return runAstHotspotsSkill(bundle)
    case 'context_slice':
      return runContextSliceSkill(bundle)
    case 'sanitizer_check':
      return runSanitizerCheckSkill(bundle)
    case 'history_lookup':
      return runHistoryLookupSkill(bundle)
    case 'cwe_mapper':
      return runCweMapperSkill(bundle)
    default:
      return {
        skillName: skill,
        evidence: [],
        confidence: 0,
        cost: 0,
        latencyMs: 0,
        traceId: bundle.traceId,
        success: false,
        error: `尚未支援的 skill：${skill}`,
      }
  }
}

async function runMcpTask(
  bundle: ContextBundle,
  serverName: string,
  toolName: 'pattern_scan' | 'code_graph_lookup',
): Promise<SkillExecutionRecord> {
  const startedAt = Date.now()
  const mcp = await invokeMcpTool({
    serverName,
    toolName,
    filePath: bundle.filePath,
    language: bundle.language,
    code: bundle.content,
  })

  return {
    skillName: toolName === 'pattern_scan' ? 'mcp_pattern_scan' : 'mcp_code_graph_lookup',
    evidence: mcp.evidence,
    confidence: mcp.confidence,
    cost: mcp.evidence.length,
    latencyMs: Date.now() - startedAt,
    traceId: bundle.traceId,
    success: mcp.ok,
    error: mcp.error,
  }
}

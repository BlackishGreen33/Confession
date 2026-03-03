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
  const records: SkillExecutionRecord[] = []

  for (const skill of plan.skills) {
    switch (skill) {
      case 'ast_hotspots':
        records.push(runAstHotspotsSkill(bundle))
        break
      case 'context_slice':
        records.push(runContextSliceSkill(bundle))
        break
      case 'sanitizer_check':
        records.push(runSanitizerCheckSkill(bundle))
        break
      case 'history_lookup':
        records.push(await runHistoryLookupSkill(bundle))
        break
      case 'cwe_mapper':
        records.push(runCweMapperSkill(bundle))
        break
      default:
        break
    }
  }

  for (const task of plan.mcpTasks) {
    const startedAt = Date.now()
    const mcp = await invokeMcpTool({
      serverName: task.serverName,
      toolName: task.toolName,
      filePath: bundle.filePath,
      language: bundle.language,
      code: bundle.content,
    })

    records.push({
      skillName: task.toolName === 'pattern_scan' ? 'mcp_pattern_scan' : 'mcp_code_graph_lookup',
      evidence: mcp.evidence,
      confidence: mcp.confidence,
      cost: mcp.evidence.length,
      latencyMs: Date.now() - startedAt,
      traceId: bundle.traceId,
      success: mcp.ok,
      error: mcp.error,
    })
  }

  return records
}

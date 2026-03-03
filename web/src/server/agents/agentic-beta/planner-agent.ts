import type { PlannerPlan } from './types'
import type { ContextBundle } from './types'

const HYPOTHESIS_BY_TYPE: Record<string, string> = {
  dangerous_call: '可能存在可控輸入導致的命令或程式碼注入',
  unsafe_pattern: '可能存在 XSS 或不安全內容輸出',
  sensitive_data: '可能存在敏感資料外洩或未消毒輸入流',
  prototype_mutation: '可能存在原型鏈污染風險',
}

/**
 * Planner Agent：依檔案上下文生成分析假設與技能執行計畫。
 */
export function planForContext(bundle: ContextBundle): PlannerPlan {
  const hypotheses = Array.from(
    new Set(
      bundle.hotspots.map((point) => HYPOTHESIS_BY_TYPE[point.type] ?? `檢查 ${point.patternName} 相關安全風險`),
    ),
  )

  const mcpTasks: PlannerPlan['mcpTasks'] = []

  if (bundle.hotspots.length > 0) {
    mcpTasks.push({ serverName: 'builtin:pattern', toolName: 'pattern_scan' })
  }

  if (bundle.depth !== 'quick' || bundle.totalLines > 160) {
    mcpTasks.push({ serverName: 'builtin:graph', toolName: 'code_graph_lookup' })
  }

  return {
    hypotheses,
    skills: ['ast_hotspots', 'context_slice', 'sanitizer_check', 'history_lookup', 'cwe_mapper'],
    mcpTasks,
  }
}

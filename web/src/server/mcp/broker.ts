import { ensureMcpPolicy } from './policy'

export interface McpInvocation {
  serverName: string
  toolName: 'pattern_scan' | 'code_graph_lookup'
  filePath: string
  language: string
  code: string
}

export interface McpResult {
  ok: boolean
  source: 'builtin' | 'external'
  evidence: string[]
  confidence: number
  error?: string
}

/**
 * MCP Broker：先做 policy 驗證，再執行內建工具或外掛代理。
 */
export async function invokeMcpTool(input: McpInvocation): Promise<McpResult> {
  const policy = ensureMcpPolicy(input.serverName, input.toolName)
  if (!policy.allowed) {
    return {
      ok: false,
      source: 'external',
      evidence: [],
      confidence: 0,
      error: policy.reason,
    }
  }

  if (input.serverName.startsWith('builtin:')) {
    return input.toolName === 'pattern_scan'
      ? runBuiltinPatternScan(input)
      : runBuiltinCodeGraphLookup(input)
  }

  // 目前先保留白名單治理，外部 connector 預設降級為可觀測失敗。
  return {
    ok: false,
    source: 'external',
    evidence: [],
    confidence: 0,
    error: `外部 MCP connector 尚未啟用：${input.serverName}`,
  }
}

function runBuiltinPatternScan(input: McpInvocation): McpResult {
  const lines = input.code.split('\n')
  const evidence: string[] = []

  for (const [index, line] of lines.entries()) {
    const hasEvalLike =
      /\beval\s*\(/.test(line) ||
      /innerHTML\s*=/.test(line) ||
      /exec\.Command/.test(line)
    const hasSqlConcat =
      /\b(select|insert|update|delete|replace|drop|union|where|from|into|like)\b/i.test(
        line
      ) &&
      (/\+/.test(line) || /\$\{/.test(line))
    const hasHardcodedSecret =
      /(secret|token|api[_-]?key|password|passwd|jwt|private[_-]?key)/i.test(
        line
      ) && /['"`][^'"`]{8,}['"`]/.test(line)
    const hasPrototypePollution =
      /Object\.assign\s*\(\s*Object\.prototype\b/.test(line) ||
      /__proto__/.test(line)

    if (
      hasEvalLike ||
      hasSqlConcat ||
      hasHardcodedSecret ||
      hasPrototypePollution
    ) {
      evidence.push(`pattern_hit line=${index + 1}: ${line.trim()}`)
    }
  }

  return {
    ok: true,
    source: 'builtin',
    evidence,
    confidence: evidence.length > 0 ? 0.8 : 0.3,
  }
}

function runBuiltinCodeGraphLookup(input: McpInvocation): McpResult {
  const evidence: string[] = []
  const lines = input.code.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('import ') || trimmed.includes('require(')) {
      evidence.push(`dependency_edge: ${trimmed}`)
    }
  }

  return {
    ok: true,
    source: 'builtin',
    evidence: evidence.slice(0, 20),
    confidence: evidence.length > 0 ? 0.7 : 0.2,
  }
}

export type McpCapability = 'pattern_scan' | 'code_graph_lookup' | 'network_probe' | 'command_exec'

const SAFE_CAPABILITIES = new Set<McpCapability>(['pattern_scan', 'code_graph_lookup'])

function parseWhitelist(): Set<string> {
  const raw = process.env.CONFESSION_MCP_WHITELIST ?? ''
  const names = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

  // 內建 server 永遠允許。
  names.push('builtin:pattern', 'builtin:graph')

  return new Set(names)
}

export function isServerWhitelisted(serverName: string): boolean {
  return parseWhitelist().has(serverName)
}

export function ensureMcpPolicy(serverName: string, capability: McpCapability): {
  allowed: boolean
  reason?: string
} {
  if (!SAFE_CAPABILITIES.has(capability)) {
    return { allowed: false, reason: `能力 ${capability} 不在允許清單` }
  }

  if (!isServerWhitelisted(serverName)) {
    return { allowed: false, reason: `MCP server ${serverName} 未列入白名單` }
  }

  return { allowed: true }
}

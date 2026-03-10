import { z } from 'zod/v4'

import type { ScanEngineMode } from '@/libs/types'

export const scanBodySchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
      language: z.string(),
    }),
  ),
  depth: z.enum(['quick', 'standard', 'deep']).default('standard'),
  includeLlmScan: z.boolean().optional(),
  forceRescan: z.boolean().optional(),
  scanScope: z.enum(['file', 'workspace']).optional(),
  workspaceSnapshotComplete: z.boolean().optional(),
  workspaceRoots: z.array(z.string()).optional(),
  engineMode: z.enum(['baseline', 'agentic_beta']).optional(),
})

export type ScanBody = z.infer<typeof scanBodySchema>

export function resolveEngineMode(
  requested: ScanEngineMode | undefined,
): ScanEngineMode {
  return requested ?? 'agentic_beta'
}

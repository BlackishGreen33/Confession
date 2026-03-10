import { storage } from '@server/storage'

import { WORKSPACE_SNAPSHOT_AUTO_FIXED_MESSAGE } from './constants'
import type { ScanBody } from './schema'

interface OpenVulnerabilityRow {
  id: string
  filePath: string
  humanStatus: string
  stableFingerprint: string
}

interface CurrentOpenVulnerabilityRow {
  id: string
  humanStatus: string
}

export async function reconcileWorkspaceSnapshotVulnerabilities(
  taskId: string,
  body: ScanBody,
  assertNotCanceled: () => void,
  observedStableFingerprints: Set<string>,
): Promise<void> {
  if (body.scanScope !== 'workspace') return
  if (body.workspaceSnapshotComplete === false) {
    process.stdout.write(
      `[Confession][WorkspaceReconcile] ${JSON.stringify({
        taskId,
        skipped: true,
        reason: 'workspace_snapshot_incomplete',
      })}\n`,
    )
    return
  }

  const workspaceRoots = normalizeWorkspaceRoots(body.workspaceRoots)
  if (workspaceRoots.length === 0) {
    process.stdout.write(
      `[Confession][WorkspaceReconcile] ${JSON.stringify({
        taskId,
        skipped: true,
        reason: 'missing_workspace_roots',
      })}\n`,
    )
    return
  }

  const filePathSet = new Set(body.files.map((file) => file.path))
  if (filePathSet.size === 0) return

  try {
    assertNotCanceled()
    const openVulnsRaw = await storage.vulnerability.findMany({
      where: {
        status: 'open',
        OR: workspaceRoots.map((root) => ({ filePath: { startsWith: root } })),
      },
      select: {
        id: true,
        filePath: true,
        humanStatus: true,
        stableFingerprint: true,
      },
    })
    const openVulns = openVulnsRaw as unknown as OpenVulnerabilityRow[]

    const stale = openVulns.filter((item) => {
      if (filePathSet.has(item.filePath)) return false
      if (
        typeof item.stableFingerprint === 'string' &&
        item.stableFingerprint.trim().length > 0 &&
        observedStableFingerprints.has(item.stableFingerprint)
      ) {
        return false
      }
      return true
    })
    if (stale.length === 0) {
      process.stdout.write(
        `[Confession][WorkspaceReconcile] ${JSON.stringify({
          taskId,
          skipped: true,
          reason: 'no_stale_vulnerability',
        })}\n`,
      )
      return
    }

    const staleIds = stale.map((item) => item.id)
    const staleById = new Map(stale.map((item) => [item.id, item]))

    assertNotCanceled()
    await storage.$transaction(async (tx) => {
      const currentOpenRaw = await tx.vulnerability.findMany({
        where: {
          id: { in: staleIds },
          status: 'open',
        },
        select: {
          id: true,
          humanStatus: true,
        },
      })
      const currentOpen = currentOpenRaw as unknown as CurrentOpenVulnerabilityRow[]

      if (currentOpen.length === 0) return
      const currentIds = currentOpen.map((item) => item.id)

      await tx.vulnerability.updateMany({
        where: {
          id: { in: currentIds },
          status: 'open',
        },
        data: {
          status: 'fixed',
        },
      })

      await tx.vulnerabilityEvent.createMany({
        data: currentOpen.map((item) => ({
          vulnerabilityId: item.id,
          eventType: 'status_changed',
          message: WORKSPACE_SNAPSHOT_AUTO_FIXED_MESSAGE,
          fromStatus: 'open',
          toStatus: 'fixed',
          fromHumanStatus: item.humanStatus,
          toHumanStatus: item.humanStatus,
        })),
      })
    })

    process.stdout.write(
      `[Confession][WorkspaceReconcile] ${JSON.stringify({
        taskId,
        skipped: false,
        autoFixedCount: staleIds.length,
        staleFileSamples: Array.from(
          new Set(
            staleIds
              .map((id) => staleById.get(id)?.filePath)
              .filter((value): value is string => typeof value === 'string'),
          ),
        ).slice(0, 5),
      })}\n`,
    )
  } catch (err) {
    // 收斂失敗不應影響主掃描完成，僅記錄以供追查。
    const message = err instanceof Error ? err.message : String(err)
    process.stdout.write(
      `[Confession][WorkspaceReconcile] ${JSON.stringify({
        taskId,
        skipped: true,
        reason: 'reconcile_failed',
        message,
      })}\n`,
    )
  }
}

function normalizeWorkspaceRoots(roots: string[] | undefined): string[] {
  if (!Array.isArray(roots)) return []

  const normalized = roots
    .map((root) => root.trim())
    .filter((root) => root.length > 0)
    .map((root) => root.replace(/[\\/]$/, ''))

  return Array.from(new Set(normalized))
}

import type { VulnHumanStatus, VulnStatus } from './constants'

export interface VulnerabilityEventDelta {
  eventType: 'review_saved' | 'status_changed'
  message: string
  fromStatus?: VulnStatus
  toStatus?: VulnStatus
  fromHumanStatus?: VulnHumanStatus
  toHumanStatus?: VulnHumanStatus
}

export interface VulnerabilityPatchInput {
  status?: VulnStatus
  humanStatus?: VulnHumanStatus
  humanComment?: string | null
  owaspCategory?: string | null
}

export function buildPatchDelta(
  existing: {
    status: string
    humanStatus: string
    humanComment: string | null
    owaspCategory: string | null
  },
  body: VulnerabilityPatchInput,
): {
  data: Record<string, unknown>
  events: VulnerabilityEventDelta[]
  hasChanges: boolean
} {
  const data: Record<string, unknown> = {}
  const events: VulnerabilityEventDelta[] = []

  const statusChanged =
    body.status !== undefined && body.status !== existing.status
  const humanStatusChanged =
    body.humanStatus !== undefined && body.humanStatus !== existing.humanStatus
  const humanCommentChanged =
    body.humanComment !== undefined && body.humanComment !== existing.humanComment
  const owaspCategoryChanged =
    body.owaspCategory !== undefined && body.owaspCategory !== existing.owaspCategory
  const reviewChanged =
    humanStatusChanged || humanCommentChanged || owaspCategoryChanged

  if (statusChanged && body.status) {
    data.status = body.status
    events.push({
      eventType: 'status_changed',
      message: `狀態流轉：${existing.status} -> ${body.status}`,
      fromStatus: existing.status as VulnStatus,
      toStatus: body.status,
    })
  }

  if (humanStatusChanged && body.humanStatus) {
    data.humanStatus = body.humanStatus
  }
  if (humanCommentChanged) {
    data.humanComment = body.humanComment ?? null
  }
  if (owaspCategoryChanged) {
    data.owaspCategory = body.owaspCategory ?? null
  }
  if (reviewChanged) {
    data.humanReviewedAt = new Date()
    events.push({
      eventType: 'review_saved',
      message:
        humanStatusChanged && body.humanStatus
          ? `專家審核已更新（${existing.humanStatus} -> ${body.humanStatus}）`
          : '審核備註已更新',
      fromHumanStatus: existing.humanStatus as VulnHumanStatus,
      toHumanStatus: (body.humanStatus ??
        existing.humanStatus) as VulnHumanStatus,
    })
  }

  return { data, events, hasChanges: Object.keys(data).length > 0 }
}

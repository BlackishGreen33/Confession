export const STATUS_VALUES = ['open', 'fixed', 'ignored'] as const
export const HUMAN_STATUS_VALUES = [
  'pending',
  'confirmed',
  'rejected',
  'false_positive',
] as const

export type VulnStatus = (typeof STATUS_VALUES)[number]
export type VulnHumanStatus = (typeof HUMAN_STATUS_VALUES)[number]

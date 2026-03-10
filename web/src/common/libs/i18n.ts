import type { UiLanguage } from './types'

export type ResolvedLocale = 'zh-TW' | 'zh-CN' | 'en'

const DEFAULT_LOCALE: ResolvedLocale = 'zh-TW'

export function resolveLocaleFromLanguageTag(tag: string | null | undefined): ResolvedLocale {
  if (!tag || typeof tag !== 'string') return DEFAULT_LOCALE
  const normalized = tag.trim().toLowerCase()
  if (!normalized) return DEFAULT_LOCALE

  if (
    normalized.startsWith('zh-hant') ||
    normalized.startsWith('zh-tw') ||
    normalized.startsWith('zh-hk') ||
    normalized.startsWith('zh-mo')
  ) {
    return 'zh-TW'
  }

  if (normalized.startsWith('zh')) {
    return 'zh-CN'
  }

  return 'en'
}

export function detectHostLocale(): string | undefined {
  const nav = globalThis.navigator
  if (!nav) return undefined

  const [first] = nav.languages ?? []
  if (typeof first === 'string' && first.trim().length > 0) {
    return first
  }

  return typeof nav.language === 'string' ? nav.language : undefined
}

export function resolveLocale(
  language: UiLanguage | undefined,
  hostLocale?: string | null,
): ResolvedLocale {
  if (language === 'zh-TW' || language === 'zh-CN' || language === 'en') return language
  if (language === 'auto') {
    return resolveLocaleFromLanguageTag(hostLocale ?? detectHostLocale())
  }
  return DEFAULT_LOCALE
}

export function toIntlLocale(locale: ResolvedLocale): string {
  switch (locale) {
    case 'zh-TW':
      return 'zh-Hant-TW'
    case 'zh-CN':
      return 'zh-Hans-CN'
    case 'en':
      return 'en-US'
  }
}

export function formatDate(
  value: string | Date | number,
  locale: ResolvedLocale,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(toIntlLocale(locale), options).format(date)
}

export function formatDateTime(
  value: string | Date | number,
  locale: ResolvedLocale,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(toIntlLocale(locale), options)
}

export function formatTime(
  value: string | Date | number,
  locale: ResolvedLocale,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(toIntlLocale(locale), options)
}

export function getUiLanguageOptions(): Array<{
  value: UiLanguage
  label: Record<ResolvedLocale, string>
}> {
  return [
    {
      value: 'auto',
      label: {
        'zh-TW': '自動（跟隨 VS Code/瀏覽器）',
        'zh-CN': '自动（跟随 VS Code/浏览器）',
        en: 'Auto (Follow VS Code/Browser)',
      },
    },
    {
      value: 'zh-TW',
      label: {
        'zh-TW': '繁體中文',
        'zh-CN': '繁體中文',
        en: 'Traditional Chinese',
      },
    },
    {
      value: 'zh-CN',
      label: {
        'zh-TW': '簡體中文',
        'zh-CN': '简体中文',
        en: 'Simplified Chinese',
      },
    },
    {
      value: 'en',
      label: {
        'zh-TW': '英文',
        'zh-CN': '英文',
        en: 'English',
      },
    },
  ]
}

'use client'

import { useMemo } from 'react'

import { useConfig } from '@/hooks/use-config'
import {
  formatDate,
  formatDateTime,
  formatTime,
  getUiLanguageOptions,
  type ResolvedLocale,
  resolveLocale,
} from '@/libs/i18n'
import type { UiLanguage } from '@/libs/types'

export interface LocalizedText {
  'zh-TW': string
  'zh-CN': string
  en: string
}

export function useI18n() {
  const config = useConfig()
  const language: UiLanguage = config.ui?.language ?? 'auto'
  const locale: ResolvedLocale = useMemo(
    () => resolveLocale(language),
    [language],
  )

  return {
    language,
    locale,
    t: (text: LocalizedText) => text[locale],
    formatDate: (value: string | Date | number, options?: Intl.DateTimeFormatOptions) =>
      formatDate(value, locale, options),
    formatDateTime: (value: string | Date | number, options?: Intl.DateTimeFormatOptions) =>
      formatDateTime(value, locale, options),
    formatTime: (value: string | Date | number, options?: Intl.DateTimeFormatOptions) =>
      formatTime(value, locale, options),
    languageOptions: getUiLanguageOptions().map((item) => ({
      value: item.value,
      label: item.label[locale],
    })),
  }
}

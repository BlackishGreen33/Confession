import { describe, expect, it } from 'vitest'

import { resolveLocale, resolveLocaleFromLanguageTag } from './i18n'

describe('i18n locale resolver', () => {
  it('auto 解析：繁體語系映射到 zh-TW', () => {
    expect(resolveLocaleFromLanguageTag('zh-Hant')).toBe('zh-TW')
    expect(resolveLocaleFromLanguageTag('zh-TW')).toBe('zh-TW')
    expect(resolveLocaleFromLanguageTag('zh-HK')).toBe('zh-TW')
    expect(resolveLocaleFromLanguageTag('zh-MO')).toBe('zh-TW')
  })

  it('auto 解析：其他 zh* 映射到 zh-CN，其餘語系映射到 en', () => {
    expect(resolveLocaleFromLanguageTag('zh-CN')).toBe('zh-CN')
    expect(resolveLocaleFromLanguageTag('zh-SG')).toBe('zh-CN')
    expect(resolveLocaleFromLanguageTag('en-US')).toBe('en')
    expect(resolveLocaleFromLanguageTag('ja-JP')).toBe('en')
  })

  it('手動語言設定優先於 host locale', () => {
    expect(resolveLocale('zh-TW', 'en-US')).toBe('zh-TW')
    expect(resolveLocale('zh-CN', 'zh-Hant')).toBe('zh-CN')
    expect(resolveLocale('en', 'zh-CN')).toBe('en')
  })

  it('缺值或不可判定時回退 zh-TW', () => {
    expect(resolveLocale(undefined, null)).toBe('zh-TW')
    expect(resolveLocaleFromLanguageTag(undefined)).toBe('zh-TW')
    expect(resolveLocaleFromLanguageTag('')).toBe('zh-TW')
  })
})

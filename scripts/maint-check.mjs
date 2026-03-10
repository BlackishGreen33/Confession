import fs from 'node:fs/promises'
import path from 'node:path'

const eslintConfigPath = path.resolve('eslint.config.mjs')
const source = await fs.readFile(eslintConfigPath, 'utf8')

const offBlockRegex = /\{[\s\S]*?files:\s*\[([\s\S]*?)\][\s\S]*?rules:\s*\{[\s\S]*?'max-lines':\s*'off'[\s\S]*?\}[\s\S]*?\}/g
let hasViolation = false

for (const match of source.matchAll(offBlockRegex)) {
  const filesSection = match[1] ?? ''
  const fileMatches = filesSection.matchAll(/'([^']+)'/g)
  for (const fileMatch of fileMatches) {
    const pattern = fileMatch[1]
    if (pattern.startsWith('web/src/server/')) {
      hasViolation = true
      process.stderr.write(
        `[maint:check] 禁止在 max-lines 例外中新增 server 檔案：${pattern}\n`,
      )
    }
  }
}

if (hasViolation) {
  process.exit(1)
}

const serverHotspotFiles = [
  'web/src/server/health-score.ts',
  'web/src/server/routes/vulnerabilities.ts',
  'web/src/server/storage/upsert-vulnerabilities.ts',
]
const maxHotspotLines = 450

for (const relativePath of serverHotspotFiles) {
  const absolutePath = path.resolve(relativePath)
  const content = await fs.readFile(absolutePath, 'utf8')
  const lineCount = content.split('\n').length
  if (lineCount > maxHotspotLines) {
    hasViolation = true
    process.stderr.write(
      `[maint:check] ${relativePath} 行數 ${lineCount} 超過限制 ${maxHotspotLines}\n`,
    )
  }
}

if (hasViolation) {
  process.exit(1)
}

process.stdout.write('[maint:check] server max-lines 與 hotspot 行數檢查通過\n')

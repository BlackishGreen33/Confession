import { describe, expect, it } from 'vitest'

import { analyzeJsTs } from './jsts'

describe('analyzeJsTs', () => {
  it('detects eval() calls', () => {
    const code = `const x = eval("alert(1)")`
    const results = analyzeJsTs(code, 'test.ts', 'typescript')
    expect(results).toHaveLength(1)
    expect(results[0].patternName).toBe('eval')
    expect(results[0].type).toBe('dangerous_call')
    expect(results[0].confidence).toBe('high')
    expect(results[0].line).toBe(1)
  })

  it('detects new Function() constructor', () => {
    const code = `const fn = new Function("return 1")`
    const results = analyzeJsTs(code, 'test.ts', 'typescript')
    expect(results.some(r => r.patternName === 'Function' && r.type === 'dangerous_call')).toBe(true)
  })

  it('detects setTimeout with string argument', () => {
    const code = `setTimeout("alert(1)", 100)`
    const results = analyzeJsTs(code, 'test.js', 'javascript')
    expect(results.some(r => r.patternName === 'setTimeout')).toBe(true)
  })

  it('ignores setTimeout with function argument', () => {
    const code = `setTimeout(() => console.log("ok"), 100)`
    const results = analyzeJsTs(code, 'test.js', 'javascript')
    expect(results.filter(r => r.patternName === 'setTimeout')).toHaveLength(0)
  })

  it('detects innerHTML assignment', () => {
    const code = `document.getElementById("x").innerHTML = userInput`
    const results = analyzeJsTs(code, 'test.ts', 'typescript')
    expect(results).toHaveLength(1)
    expect(results[0].patternName).toBe('innerHTML')
    expect(results[0].type).toBe('unsafe_pattern')
  })

  it('detects outerHTML assignment', () => {
    const code = `el.outerHTML = data`
    const results = analyzeJsTs(code, 'test.ts', 'typescript')
    expect(results.some(r => r.patternName === 'outerHTML')).toBe(true)
  })

  it('detects req.query direct access', () => {
    const code = `const name = req.query.name`
    const results = analyzeJsTs(code, 'test.ts', 'typescript')
    expect(results.some(r => r.patternName === 'direct_query_query')).toBe(true)
    expect(results[0].type).toBe('sensitive_data')
  })

  it('detects req.body direct access', () => {
    const code = `const data = req.body`
    const results = analyzeJsTs(code, 'test.ts', 'typescript')
    expect(results.some(r => r.patternName === 'direct_query_body')).toBe(true)
  })

  it('detects req.params direct access', () => {
    const code = `const id = request.params.id`
    const results = analyzeJsTs(code, 'test.ts', 'typescript')
    expect(results.some(r => r.patternName === 'direct_query_params')).toBe(true)
  })

  it('detects __proto__ assignment', () => {
    const code = `obj.__proto__ = malicious`
    const results = analyzeJsTs(code, 'test.ts', 'typescript')
    expect(results.some(r => r.patternName === '__proto__' && r.type === 'prototype_mutation')).toBe(true)
  })

  it('detects Object.setPrototypeOf', () => {
    const code = `Object.setPrototypeOf(target, proto)`
    const results = analyzeJsTs(code, 'test.ts', 'typescript')
    expect(results.some(r => r.patternName === 'Object.setPrototypeOf')).toBe(true)
  })

  it('detects prototype assignment', () => {
    const code = `MyClass.prototype = newProto`
    const results = analyzeJsTs(code, 'test.ts', 'typescript')
    expect(results.some(r => r.patternName === 'prototype_assignment')).toBe(true)
  })

  it('detects Object.assign with __proto__', () => {
    const code = `Object.assign(target, { __proto__: evil })`
    const results = analyzeJsTs(code, 'test.ts', 'typescript')
    expect(results.some(r => r.patternName === 'Object.assign.__proto__')).toBe(true)
  })

  it('returns correct InteractionPoint structure', () => {
    const code = `eval("x")`
    const results = analyzeJsTs(code, 'src/app.ts', 'typescript')
    const r = results[0]
    expect(r.id).toBeDefined()
    expect(r.filePath).toBe('src/app.ts')
    expect(r.language).toBe('typescript')
    expect(r.line).toBeGreaterThan(0)
    expect(r.column).toBeGreaterThan(0)
    expect(r.codeSnippet).toContain('eval')
  })

  it('detects multiple patterns in one file', () => {
    const code = [
      'eval("x")',
      'el.innerHTML = data',
      'const q = req.query',
      'obj.__proto__ = {}',
    ].join('\n')
    const results = analyzeJsTs(code, 'test.ts', 'typescript')
    expect(results.length).toBeGreaterThanOrEqual(4)
  })

  it('returns empty array for safe code', () => {
    const code = `const x = 1 + 2; console.log(x);`
    const results = analyzeJsTs(code, 'test.ts', 'typescript')
    expect(results).toHaveLength(0)
  })
})

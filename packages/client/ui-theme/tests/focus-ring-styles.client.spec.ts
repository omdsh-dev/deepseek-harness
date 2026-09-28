/** Static ring declarations; browser interaction coverage lives in focus-rings.e2e.ts. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { INPUT_MODALITY, INPUT_MODALITY_ATTRIBUTE } from '../../ui-primitives/src/input-modality.ts'
import { atRuleBlock, packageStylesheets, parseRules, varReferences } from './stylesheet-scan.ts'

const ACCENT = '--dsw-alias-state-business-primary'
const COLOR = '--dsw-focus-ring-color'
const WIDTH = '--dsw-focus-ring-width'
const FALLBACK = `var(${COLOR}, var(${ACCENT}))`
const css = readFileSync(new URL('../src/styles/focus.css', import.meta.url), 'utf8')
const rules = parseRules(css)
const properties = new Set(['outline', 'outline-color', 'box-shadow'])
const allowedTokens = new Set([ACCENT, COLOR, WIDTH])

function ringColorViolations(source: string, forcedColors = false): string[] {
  const forced = atRuleBlock(source, '@media (forced-colors: active)')
  if (forced !== undefined) {
    return [
      ...ringColorViolations(source.slice(0, source.lastIndexOf('@media', forced.start)) + source.slice(forced.end + 1), forcedColors),
      ...ringColorViolations(source.slice(forced.start + 1, forced.end), true),
    ]
  }
  const violations: string[] = []
  for (const rule of parseRules(source)) {
    if (!rule.selectors.some(selector => /:focus(?:-visible)?\b/.test(selector))) continue
    for (const [property, value] of rule.declarations) {
      if (!properties.has(property)) continue
      const tokens = varReferences(value)
      const hasColor = tokens.includes(ACCENT) || tokens.includes(COLOR)
      const colorless = /^(none|transparent|currentcolor|inherit)$/i.test(value)
      const systemColor = forcedColors && /\b(?:CanvasText|Highlight)\b/i.test(value)
      if (tokens.some(token => !allowedTokens.has(token)) || (!hasColor && !colorless && !systemColor)) {
        violations.push(`${rule.selectors.join(', ')} { ${property}: ${value} }`)
      }
      if (rule.selectors.every(selector => selector.includes(':focus-visible'))
        && tokens.includes(ACCENT) && !tokens.includes(COLOR)) {
        violations.push(`${rule.selectors.join(', ')} bypasses ${COLOR}`)
      }
    }
  }
  return violations
}

describe('focus styles', () => {
  it('defines standard geometry and a fallback that names colour and width but never style', () => {
    expect(rules.find(rule => rule.selectors.includes(':root'))?.declarations).toEqual([[WIDTH, '2px']])
    // Naming the width is what keeps an undeclared ring at the standard geometry instead of
    // Chromium's `auto 1px`; omitting the style is what keeps `outline: none` paintless.
    expect(rules.find(rule => rule.selectors.includes(':focus-visible'))?.declarations)
      .toEqual([['outline-color', FALLBACK], ['outline-width', `var(${WIDTH})`]])
    expect(rules.flatMap(rule => rule.declarations).map(([property]) => property)).not.toContain('outline-style')
    expect(rules.flatMap(rule => rule.declarations).map(([property]) => property)).not.toContain('outline')
  })

  it('pairs pointer suppression with the modality publisher and leaves editable controls alone', () => {
    const selector = `html[${INPUT_MODALITY_ATTRIBUTE}='${INPUT_MODALITY.pointer}'] body :focus-visible:not(:read-write)`
    expect(rules.find(rule => rule.selectors.includes(selector))?.declarations)
      .toEqual([[COLOR, 'transparent'], ['outline-color', 'transparent']])
    expect(rules.flatMap(rule => rule.declarations).some(([property]) => property === 'box-shadow')).toBe(false)
  })

  it('rejects a non-blue ring and a keyboard ring that bypasses pointer suppression', () => {
    expect(ringColorViolations('.a:focus-visible { outline: 2px solid red; }')).toHaveLength(1)
    expect(ringColorViolations('.a:focus { box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }'))
      .toHaveLength(1)
    expect(ringColorViolations('.a:focus-visible .label { outline: 2px solid var(--dsw-alias-state-business-primary); }'))
      .toHaveLength(1)
    expect(ringColorViolations(`.a:focus-visible::after { outline: 2px solid ${FALLBACK}; }`)).toEqual([])
  })

  it('allows system focus colors only inside the forced-colors media query', () => {
    const ring = '.a:focus-visible { outline: 2px solid CanvasText; }'
    expect(ringColorViolations(ring)).toHaveLength(1)
    expect(ringColorViolations(`@media (forced-colors: active) { ${ring} }`)).toEqual([])
    expect(ringColorViolations(`@media (forced-colors: active) { ${ring.replace('CanvasText', 'red')} }`)).toHaveLength(1)
    expect(ringColorViolations(`@media (forced-colors: active) { ${ring} } ${ring}`)).toHaveLength(1)
  })

  it('uses the shared ring color throughout a non-empty client stylesheet corpus', () => {
    const files = packageStylesheets().filter(file => file.includes('/packages/client/'))
    expect(files.length).toBeGreaterThan(0)
    const failures = files.flatMap(file => ringColorViolations(readFileSync(file, 'utf8')).map(value => `${file}: ${value}`))
    expect(failures).toEqual([])
  })
})

// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Tooltip } from '../src/Tooltip.tsx'

describe('Tooltip module in Node', () => {
  it('loads without installing browser input listeners', () => {
    expect(typeof window).toBe('undefined')
    expect(Tooltip).toMatchObject({ $$typeof: Symbol.for('react.forward_ref') })
  })
})

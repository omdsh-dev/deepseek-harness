import { describe, expect, it, vi } from 'vitest'
import { PWSH_TEST_AVAILABLE_ENV, pinPwshTestAvailability } from './pwsh-test-availability.ts'

describe('PowerShell test availability', () => {
  it.each([
    ['1', true],
    ['0', false],
  ] as const)('reuses inherited %s without probing', (raw, expected) => {
    const probe = vi.fn(() => !expected)
    expect(pinPwshTestAvailability({ [PWSH_TEST_AVAILABLE_ENV]: raw }, probe)).toBe(expected)
    expect(probe).not.toHaveBeenCalled()
  })

  it.each([true, false])('pins a fresh %s result for later processes', (available) => {
    const env: NodeJS.ProcessEnv = {}
    const probe = vi.fn(() => available)
    expect(pinPwshTestAvailability(env, probe)).toBe(available)
    expect(env[PWSH_TEST_AVAILABLE_ENV]).toBe(available ? '1' : '0')
    expect(pinPwshTestAvailability(env, () => !available)).toBe(available)
    expect(probe).toHaveBeenCalledOnce()
  })

  it('rejects a malformed inherited fact', () => {
    expect(() => pinPwshTestAvailability({ [PWSH_TEST_AVAILABLE_ENV]: 'yes' }))
      .toThrow(`${PWSH_TEST_AVAILABLE_ENV} must be '0', '1', or unset`)
  })
})

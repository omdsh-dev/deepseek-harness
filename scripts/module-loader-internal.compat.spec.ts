import { describe, expect, it } from 'vitest'
import { ModuleLoader } from '@deepseek-ai/cordis-plugin-loader'

describe('Node internal ESM loader compatibility', () => {
  it('tags and calls the resolver by its runtime capability shape', () => {
    const internal = ModuleLoader.fromInternal()
    expect(internal).toBeDefined()
    if (internal === undefined) return

    const specifier = './module-loader-internal.compat.spec.ts'
    if (internal.version === 'v1') {
      expect(typeof internal.resolve).toBe('function')
      expect(typeof Reflect.get(internal, 'getOrCreateModuleJob')).not.toBe('function')
      expect(internal.resolveSync(specifier, import.meta.url, {}).url).toBe(import.meta.url)
      return
    }

    expect(typeof internal.getOrCreateModuleJob).toBe('function')
    expect(typeof Reflect.get(internal, 'resolve')).not.toBe('function')
    expect(internal.resolveSync(import.meta.url, { specifier, attributes: {} }).url).toBe(import.meta.url)
  })
})

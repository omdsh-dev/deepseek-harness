import { createRequire, type LoadHookContext } from 'node:module'
import type { Dict } from '@deepseek-ai/cosmokit'

/** Node internal module format names handled by loader hooks. */
export type ModuleFormat = 'builtin' | 'commonjs' | 'json' | 'module' | 'wasm'
/** Source payload accepted by Node internal module load hooks. */
export type ModuleSource = string | ArrayBuffer

/** Result returned by a Node internal resolve hook. */
export interface ResolveResult {
  format: ModuleFormat
  url: string
}

/** Result returned by a Node internal load hook. */
export interface LoadResult {
  format: ModuleFormat
  source?: ModuleSource
}

type LoadCacheData = ModuleJob // | Function

/** @see https://github.com/nodejs/node/blob/main/lib/internal/modules/esm/module_map.js */
interface LoadCache extends Omit<Map<string, Dict<LoadCacheData>>, 'get' | 'set' | 'has'> {
  get(url: string, type?: string): LoadCacheData | undefined
  set(url: string, type?: string, job?: LoadCacheData): this
  has(url: string, type?: string): boolean
}

/** Minimal Node internal ModuleWrap surface used by HMR helpers. */
export interface ModuleWrap {
  url: string
  getNamespace(): any
}

/** @see https://github.com/nodejs/node/blob/main/lib/internal/modules/esm/module_job.js */
export interface ModuleJob {
  url: string
  loader: ModuleLoader
  module?: ModuleWrap
  importAttributes: ImportAttributes
  linked: Promise<ModuleJob[]>
  instantiate(): Promise<void>
  run(): Promise<{ module: ModuleWrap }>
}

/**
 * Node 22/23 ModuleLoader interface.
 *
 * Key methods:
 * - getModuleJobForImport(specifier, parentURL, importAttributes)
 * - resolve(specifier, parentURL, importAttributes) → Promise<ResolveResult>
 * - resolveSync(specifier, parentURL, importAttributes) → ResolveResult
 */
export interface ModuleLoaderV1 {
  version: 'v1'
  loadCache: LoadCache
  import(specifier: string, parentURL: string, importAttributes: ImportAttributes): Promise<any>
  register(specifier: string | URL, parentURL?: string | URL, data?: any, transferList?: any[]): void
  getModuleJobForImport(specifier: string, parentURL: string, importAttributes: ImportAttributes): Promise<ModuleJob>
  resolve(specifier: string, parentURL: string, importAttributes: ImportAttributes): Promise<ResolveResult>
  resolveSync(specifier: string, parentURL: string, importAttributes: ImportAttributes): ResolveResult
  load(specifier: string, context: Pick<LoadHookContext, 'format' | 'importAttributes'>): Promise<LoadResult>
}

/** Newer Node 24+ module request object. */
export interface ModuleRequest {
  specifier: string
  attributes?: ImportAttributes
  phase?: ModulePhase
}

/** @see https://github.com/nodejs/node/blob/main/src/module_wrap.h */
export const enum ModulePhase {
  Source = 1,
  Evaluation = 2,
}

/** Opaque Node internal module request type marker. */
export type ModuleRequestType = unknown // internal symbols

/**
 * Newer Node 24+ ModuleLoader interface. Early Node 24 releases still expose
 * the v1 surface, so the runtime shape — not the Node major — selects this
 * interface.
 *
 * Breaking changes from v1:
 * - getModuleJobForImport removed → getOrCreateModuleJob(parentURL, request, requestType)
 * - resolve removed (became private #resolve) → resolveSync(parentURL, request)
 * - Parameter order reversed for resolveSync, request object { specifier, attributes }
 * - LoadCache became typed Map<url, { [type]: ModuleJob }> with delete only setting undefined
 */
export interface ModuleLoaderV2 {
  version: 'v2'
  loadCache: LoadCache
  import(specifier: string, parentURL: string, importAttributes: ImportAttributes, phase?: ModulePhase, isEntryPoint?: boolean): Promise<any>
  register(specifier: string | URL, parentURL?: string | URL, data?: any, transferList?: any[], isInternal?: boolean): void
  getOrCreateModuleJob(parentURL: string, request: ModuleRequest, requestType?: ModuleRequestType): Promise<ModuleJob>
  resolveSync(parentURL: string, request: ModuleRequest): ResolveResult
  load(url: string, context: Pick<LoadHookContext, 'format' | 'importAttributes'>): Promise<LoadResult>
}

/** Supported Node internal ESM loader shapes. */
export type ModuleLoader = ModuleLoaderV1 | ModuleLoaderV2

/** Helpers for locating the current Node internal module loader. */
export namespace ModuleLoader {
  let _cachedLoader: ModuleLoader | undefined

  function requireInternal(id: string): any {
    const require = createRequire(import.meta.url)
    if (process.execArgv.includes('--expose-internals')) {
      try {
        return require(id)
      } catch {}
    }
    try {
      return require('node-addon-require-builtin').requireBuiltin(id)
    } catch {}
  }

  export function fromInternal(): ModuleLoader | undefined {
    if (_cachedLoader) return _cachedLoader
    const [major] = process.versions.node.split('.').map(Number)

    if (major < 22) return
    const raw = requireInternal('internal/modules/esm/loader')?.getOrInitializeCascadedLoader()
    if (!raw || typeof raw.resolveSync !== 'function') return
    // Node 24 changed this private interface during the release line. 24.3,
    // for example, still has resolve(specifier, parentURL, attributes), while
    // later releases expose getOrCreateModuleJob(parentURL, request, type).
    // Function arity is not a discriminator (the early resolveSync reports 2
    // despite accepting the v1 call), but these named capabilities are.
    if (typeof raw.getOrCreateModuleJob === 'function') {
      return _cachedLoader = Object.assign(raw, { version: 'v2' })
    }
    if (typeof raw.resolve === 'function') {
      return _cachedLoader = Object.assign(raw, { version: 'v1' })
    }
  }
}

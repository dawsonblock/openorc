import { describe, expect, test } from 'bun:test'

import {
  KNOWN_PROVIDER_KEYS,
  PROVIDER_MATRIX,
  getExperimentalProviders,
  getProviderMatrixEntry,
  getStableProviders,
  isKnownProvider,
} from './supportedMatrix.js'

// The APIProvider union in providers.ts — keep in sync.
const API_PROVIDER_KEYS = [
  'firstParty',
  'openai',
  'gemini',
  'github',
  'codex',
  'bedrock',
  'vertex',
  'foundry',
] as const

describe('provider matrix completeness', () => {
  test('every APIProvider key is present in the matrix', () => {
    for (const key of API_PROVIDER_KEYS) {
      expect(PROVIDER_MATRIX).toHaveProperty(key)
    }
  })

  test('matrix has no extra keys beyond the known APIProvider set', () => {
    const matrixKeys = new Set(KNOWN_PROVIDER_KEYS)
    const apiKeys = new Set<string>(API_PROVIDER_KEYS)
    for (const k of matrixKeys) {
      expect(apiKeys.has(k)).toBe(true)
    }
  })

  test('every entry has a non-empty displayName', () => {
    for (const [key, entry] of Object.entries(PROVIDER_MATRIX)) {
      expect(entry.displayName.length, `${key}.displayName`).toBeGreaterThan(0)
    }
  })

  test('every entry has a valid status', () => {
    for (const [key, entry] of Object.entries(PROVIDER_MATRIX)) {
      expect(['stable', 'experimental'], `${key}.status`).toContain(entry.status)
    }
  })

  test('every entry has a non-empty activationEnvVar', () => {
    for (const [key, entry] of Object.entries(PROVIDER_MATRIX)) {
      expect(entry.activationEnvVar.length, `${key}.activationEnvVar`).toBeGreaterThan(0)
    }
  })

  test('every entry has all capability flags as booleans', () => {
    const capKeys = ['streaming', 'toolCalling', 'vision', 'usageReporting', 'webSearch']
    for (const [key, entry] of Object.entries(PROVIDER_MATRIX)) {
      for (const cap of capKeys) {
        expect(typeof entry.capabilities[cap as keyof typeof entry.capabilities], `${key}.capabilities.${cap}`)
          .toBe('boolean')
      }
    }
  })
})

describe('stable vs experimental split', () => {
  test('firstParty, openai, gemini, github, codex are stable', () => {
    const stable = getStableProviders()
    for (const key of ['firstParty', 'openai', 'gemini', 'github', 'codex']) {
      expect(stable).toContain(key)
    }
  })

  test('bedrock, vertex, foundry are experimental', () => {
    const experimental = getExperimentalProviders()
    for (const key of ['bedrock', 'vertex', 'foundry']) {
      expect(experimental).toContain(key)
    }
  })

  test('stable and experimental sets are disjoint', () => {
    const stable = new Set(getStableProviders())
    const experimental = new Set(getExperimentalProviders())
    for (const key of stable) {
      expect(experimental.has(key)).toBe(false)
    }
  })

  test('stable ∪ experimental == all known providers', () => {
    const all = new Set(KNOWN_PROVIDER_KEYS)
    const union = new Set([...getStableProviders(), ...getExperimentalProviders()])
    expect(union.size).toBe(all.size)
    for (const k of all) {
      expect(union.has(k)).toBe(true)
    }
  })
})

describe('lookup helpers', () => {
  test('getProviderMatrixEntry returns the correct entry', () => {
    const entry = getProviderMatrixEntry('openai')
    expect(entry?.displayName).toBe('OpenAI-compatible')
    expect(entry?.status).toBe('stable')
  })

  test('getProviderMatrixEntry returns undefined for unknown provider', () => {
    expect(getProviderMatrixEntry('foobar')).toBeUndefined()
  })

  test('isKnownProvider returns true for every matrix key', () => {
    for (const key of KNOWN_PROVIDER_KEYS) {
      expect(isKnownProvider(key)).toBe(true)
    }
  })

  test('isKnownProvider returns false for unknown providers', () => {
    expect(isKnownProvider('')).toBe(false)
    expect(isKnownProvider('foobar')).toBe(false)
    expect(isKnownProvider('OPENAI')).toBe(false) // case-sensitive
  })
})

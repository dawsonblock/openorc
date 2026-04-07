/**
 * Golden-path end-to-end config tests.
 *
 * These tests verify the full provider selection and validation pipeline for
 * every path a real user would hit.  They do not make live network calls.
 *
 * The "golden path" is:
 *   1. install
 *   2. configure provider (env vars / profile)
 *   3. run doctor / validate  ← this file
 *   4. start interactive session
 *   5. read / edit files
 *   6. run bounded commands
 *   7. save and resume session
 */

import { describe, expect, test } from 'bun:test'

import { getProviderValidationError } from '../utils/providerValidation.js'
import { resolveConfig, formatResolvedConfigDebug } from '../config/resolvedConfig.js'
import { isKnownProvider, getProviderMatrixEntry } from '../providers/supportedMatrix.js'

// ---------------------------------------------------------------------------
// 1. Clean startup — no config → first-party, no validation error
// ---------------------------------------------------------------------------

describe('clean startup — no provider config', () => {
  test('defaults to firstParty with no env set', async () => {
    const cfg = resolveConfig({} as NodeJS.ProcessEnv)
    expect(cfg.provider).toBe('firstParty')
  })

  test('no validation error for no-config (firstParty credentials checked later)', async () => {
    // firstParty with no key is allowed through validation — the Anthropic SDK
    // handles the auth error at runtime after the UI loads.
    const error = await getProviderValidationError({} as NodeJS.ProcessEnv)
    expect(error).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. Bad config — known failure modes must produce precise errors
// ---------------------------------------------------------------------------

describe('bad config — precise error messages', () => {
  test('OpenAI without key returns actionable error', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_MODEL: 'gpt-4o',
    } as NodeJS.ProcessEnv)
    expect(error).not.toBeNull()
    expect(error).toMatch(/OPENAI_API_KEY/)
  })

  test('placeholder SUA_CHAVE key returns actionable error', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_API_KEY: 'SUA_CHAVE',
      OPENAI_MODEL: 'gpt-4o',
    } as NodeJS.ProcessEnv)
    expect(error).not.toBeNull()
    expect(error).toMatch(/placeholder/)
  })

  test('Gemini without credentials returns actionable error', async () => {
    const error = await getProviderValidationError(
      { CLAUDE_CODE_USE_GEMINI: '1' } as NodeJS.ProcessEnv,
      { resolveGeminiCredential: async () => ({ kind: 'none' }) },
    )
    expect(error).not.toBeNull()
    expect(error).toMatch(/GEMINI_API_KEY/)
  })

  test('GitHub without token returns actionable error', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_GITHUB: '1',
    } as NodeJS.ProcessEnv)
    expect(error).not.toBeNull()
    expect(error).toMatch(/GITHUB_TOKEN/)
  })

  test('Codex without auth returns actionable error', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_MODEL: 'codexplan',
    } as NodeJS.ProcessEnv)
    expect(error).not.toBeNull()
    expect(error).toMatch(/Codex auth/)
  })

  test('Bedrock without credentials returns actionable error', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_BEDROCK: '1',
    } as NodeJS.ProcessEnv)
    expect(error).not.toBeNull()
    expect(error).toMatch(/AWS/)
  })

  test('Vertex without project returns actionable error', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_VERTEX: '1',
    } as NodeJS.ProcessEnv)
    expect(error).not.toBeNull()
    expect(error).toMatch(/ANTHROPIC_VERTEX_PROJECT_ID/)
  })

  test('Foundry without resource returns actionable error', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_FOUNDRY: '1',
    } as NodeJS.ProcessEnv)
    expect(error).not.toBeNull()
    expect(error).toMatch(/ANTHROPIC_FOUNDRY_RESOURCE/)
  })
})

// ---------------------------------------------------------------------------
// 3. Supported provider success — valid config produces null error + stable provider
// ---------------------------------------------------------------------------

describe('supported provider success — stable providers pass validation', () => {
  test('OpenAI with key passes', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'gpt-4o',
    } as NodeJS.ProcessEnv)
    expect(error).toBeNull()
  })

  test('Ollama (local OpenAI-compat) without key passes', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
      OPENAI_MODEL: 'llama3.2',
    } as NodeJS.ProcessEnv)
    expect(error).toBeNull()
  })

  test('Gemini with API key passes', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_GEMINI: '1',
      GEMINI_API_KEY: 'test-key',
    } as NodeJS.ProcessEnv)
    expect(error).toBeNull()
  })

  test('GitHub with token passes', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_GITHUB: '1',
      GITHUB_TOKEN: 'ghp_test',
    } as NodeJS.ProcessEnv)
    expect(error).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 4. Every validated provider is known to the support matrix
// ---------------------------------------------------------------------------

describe('provider matrix coverage', () => {
  const providerCases = [
    'firstParty',
    'openai',
    'gemini',
    'github',
    'codex',
    'bedrock',
    'vertex',
    'foundry',
  ]

  test.each(providerCases)('%s is in the support matrix', provider => {
    expect(isKnownProvider(provider)).toBe(true)
  })

  test.each(providerCases)('%s has a matrix entry with status and capabilities', provider => {
    const entry = getProviderMatrixEntry(provider)
    expect(entry).toBeDefined()
    expect(['stable', 'experimental']).toContain(entry!.status)
    expect(typeof entry!.capabilities.streaming).toBe('boolean')
    expect(typeof entry!.capabilities.toolCalling).toBe('boolean')
  })
})

// ---------------------------------------------------------------------------
// 5. Debug output contract — redacted config is safe to print
// ---------------------------------------------------------------------------

describe('debug output — redacted config safety', () => {
  test('debug output does not contain API keys', () => {
    const cfg = resolveConfig({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_API_KEY: 'sk-super-secret-key',
      OPENAI_MODEL: 'gpt-4o',
    } as NodeJS.ProcessEnv)
    const debug = formatResolvedConfigDebug(cfg)
    expect(debug).not.toContain('sk-super-secret-key')
  })

  test('debug output contains provider and model info', () => {
    const cfg = resolveConfig({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'gpt-4o',
    } as NodeJS.ProcessEnv)
    const debug = formatResolvedConfigDebug(cfg)
    expect(debug).toContain('openai')
    expect(debug).toContain('gpt-4o')
  })

  test('debug output marks missing credentials clearly', () => {
    const cfg = resolveConfig({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_MODEL: 'gpt-4o',
    } as NodeJS.ProcessEnv)
    const debug = formatResolvedConfigDebug(cfg)
    expect(debug).toContain('MISSING')
  })
})

// ---------------------------------------------------------------------------
// 6. Bounded file read/edit — path traversal guards (config layer)
// ---------------------------------------------------------------------------

describe('path safety — isLocalProvider does not allow arbitrary remote URLs', () => {
  test('metadata service URL is not treated as local', () => {
    const cfg = resolveConfig({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'http://169.254.169.254/v1',
      OPENAI_MODEL: 'gpt-4o',
    } as NodeJS.ProcessEnv)
    // 169.254.x.x is link-local but not in the private ranges we accept —
    // this prevents credential-stealing via SSRF to cloud metadata endpoints.
    expect(cfg.isLocalProvider).toBe(false)
  })
})

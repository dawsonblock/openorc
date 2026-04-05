/**
 * Network isolation tests.
 *
 * These tests prove two contracts:
 *
 * 1. Local-only mode: when OPENAI_BASE_URL resolves to a local address,
 *    validation passes without an API key (Ollama / LM Studio pattern) and
 *    the resolved config identifies the provider as local.
 *
 * 2. Hosted mode: when OPENAI_BASE_URL resolves to a remote address,
 *    an API key is required.  The resolved config identifies the correct
 *    remote base URL so callers can audit exactly which endpoint is contacted.
 *
 * NOTE: These tests verify the configuration layer, not live network calls.
 *       Actual outbound traffic depends on the network enforcement at the OS /
 *       container level.  For CI enforcement, use the `verify:privacy` script
 *       which checks the built bundle for banned phone-home patterns.
 */

import { describe, expect, test } from 'bun:test'

import { getProviderValidationError } from '../../utils/providerValidation.js'
import { isLocalProviderUrl } from './providerConfig.js'
import { resolveConfig } from '../../config/resolvedConfig.js'

// ---------------------------------------------------------------------------
// isLocalProviderUrl contract
// ---------------------------------------------------------------------------

describe('isLocalProviderUrl — local addresses', () => {
  const localCases = [
    'http://localhost:11434/v1',
    'http://127.0.0.1:11434/v1',
    'http://127.1.2.3:8080/v1',
    'http://0.0.0.0:11434/v1',
    'http://[::1]:11434/v1',
    'http://ollama.local/v1',
    'http://10.0.0.1/v1',
    'http://172.16.0.1/v1',
    'http://192.168.1.100/v1',
    'http://[fd00::1]/v1',
    'http://[fe80::1]/v1',
  ]

  test.each(localCases)('%s is classified as local', url => {
    expect(isLocalProviderUrl(url)).toBe(true)
  })
})

describe('isLocalProviderUrl — remote addresses', () => {
  const remoteCases = [
    'https://api.openai.com/v1',
    'https://api.deepseek.com/v1',
    'https://models.github.ai/inference',
    'https://generativelanguage.googleapis.com/v1beta/openai',
    'https://chatgpt.com/backend-api/codex',
    'http://203.0.113.1/v1',
    'http://[2001:4860:4860::8888]/v1',
  ]

  test.each(remoteCases)('%s is classified as remote', url => {
    expect(isLocalProviderUrl(url)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Local-only mode: no API key needed for local URLs
// ---------------------------------------------------------------------------

describe('validation: local provider requires no API key', () => {
  test('Ollama at localhost passes without OPENAI_API_KEY', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
      OPENAI_MODEL: 'llama3.2',
    } as NodeJS.ProcessEnv)
    expect(error).toBeNull()
  })

  test('LM Studio at private IP passes without OPENAI_API_KEY', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'http://192.168.1.50:1234/v1',
      OPENAI_MODEL: 'local-model',
    } as NodeJS.ProcessEnv)
    expect(error).toBeNull()
  })

  test('resolveConfig marks local URL as isLocalProvider=true', () => {
    const cfg = resolveConfig({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
      OPENAI_MODEL: 'llama3.2',
    } as NodeJS.ProcessEnv)
    expect(cfg.isLocalProvider).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Hosted mode: API key required for remote URLs
// ---------------------------------------------------------------------------

describe('validation: remote provider requires API key', () => {
  test('OpenAI remote URL without key returns an error', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_MODEL: 'gpt-4o',
    } as NodeJS.ProcessEnv)
    expect(error).not.toBeNull()
    expect(error).toMatch(/OPENAI_API_KEY/)
  })

  test('DeepSeek remote URL without key returns an error', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://api.deepseek.com/v1',
      OPENAI_MODEL: 'deepseek-chat',
    } as NodeJS.ProcessEnv)
    expect(error).not.toBeNull()
    expect(error).toMatch(/OPENAI_API_KEY/)
  })

  test('resolveConfig marks remote URL as isLocalProvider=false', () => {
    const cfg = resolveConfig({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'gpt-4o',
    } as NodeJS.ProcessEnv)
    expect(cfg.isLocalProvider).toBe(false)
  })

  test('resolveConfig records the exact configured base URL (hosted audit trail)', () => {
    const customUrl = 'https://my-proxy.example.com/v1'
    const cfg = resolveConfig({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: customUrl,
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'gpt-4o',
    } as NodeJS.ProcessEnv)
    expect(cfg.baseUrl).toBe(customUrl)
  })
})

// ---------------------------------------------------------------------------
// GitHub Models: no local URL, but uses GitHub token instead of API key
// ---------------------------------------------------------------------------

describe('validation: GitHub Models token requirement', () => {
  test('GitHub mode without token returns an error', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_GITHUB: '1',
    } as NodeJS.ProcessEnv)
    expect(error).not.toBeNull()
    expect(error).toMatch(/GITHUB_TOKEN/)
  })

  test('GitHub mode with token passes', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_GITHUB: '1',
      GITHUB_TOKEN: 'ghp_test123',
    } as NodeJS.ProcessEnv)
    expect(error).toBeNull()
  })

  test('GH_TOKEN is accepted as alternative', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_GITHUB: '1',
      GH_TOKEN: 'ghp_test456',
    } as NodeJS.ProcessEnv)
    expect(error).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Experimental providers: fail-closed startup checks
// ---------------------------------------------------------------------------

describe('validation: Bedrock startup checks', () => {
  test('Bedrock without any AWS credentials returns an error', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_BEDROCK: '1',
    } as NodeJS.ProcessEnv)
    expect(error).not.toBeNull()
    expect(error).toMatch(/AWS/)
  })

  test('Bedrock with AWS bearer token passes', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_BEARER_TOKEN_BEDROCK: 'bearer-tok',
    } as NodeJS.ProcessEnv)
    expect(error).toBeNull()
  })

  test('Bedrock with access key + secret passes', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_ACCESS_KEY_ID: 'AKIATEST',
      AWS_SECRET_ACCESS_KEY: 'secret',
    } as NodeJS.ProcessEnv)
    expect(error).toBeNull()
  })

  test('Bedrock with skip-auth flag passes regardless of credentials', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_SKIP_BEDROCK_AUTH: '1',
    } as NodeJS.ProcessEnv)
    expect(error).toBeNull()
  })
})

describe('validation: Vertex startup checks', () => {
  test('Vertex without project ID returns an error', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_VERTEX: '1',
    } as NodeJS.ProcessEnv)
    expect(error).not.toBeNull()
    expect(error).toMatch(/ANTHROPIC_VERTEX_PROJECT_ID/)
  })

  test('Vertex with project ID passes', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_VERTEX: '1',
      ANTHROPIC_VERTEX_PROJECT_ID: 'my-project',
    } as NodeJS.ProcessEnv)
    expect(error).toBeNull()
  })

  test('Vertex with skip-auth flag passes regardless of project ID', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_VERTEX: '1',
      CLAUDE_CODE_SKIP_VERTEX_AUTH: '1',
    } as NodeJS.ProcessEnv)
    expect(error).toBeNull()
  })
})

describe('validation: Foundry startup checks', () => {
  test('Foundry without resource returns an error', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_FOUNDRY: '1',
    } as NodeJS.ProcessEnv)
    expect(error).not.toBeNull()
    expect(error).toMatch(/ANTHROPIC_FOUNDRY_RESOURCE/)
  })

  test('Foundry with resource URL passes', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_FOUNDRY: '1',
      ANTHROPIC_FOUNDRY_RESOURCE: 'my-resource',
    } as NodeJS.ProcessEnv)
    expect(error).toBeNull()
  })

  test('Foundry with base URL passes', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_FOUNDRY: '1',
      ANTHROPIC_FOUNDRY_BASE_URL: 'https://my-resource.services.ai.azure.com',
    } as NodeJS.ProcessEnv)
    expect(error).toBeNull()
  })

  test('Foundry with skip-auth flag passes regardless of resource', async () => {
    const error = await getProviderValidationError({
      CLAUDE_CODE_USE_FOUNDRY: '1',
      CLAUDE_CODE_SKIP_FOUNDRY_AUTH: '1',
    } as NodeJS.ProcessEnv)
    expect(error).toBeNull()
  })
})

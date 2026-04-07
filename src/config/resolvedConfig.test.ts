import { describe, expect, test } from 'bun:test'

import {
  formatResolvedConfigDebug,
  resolveConfig,
  type ResolvedConfig,
} from './resolvedConfig.js'

// Minimal env builder — only the keys relevant to each test
function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv
}

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

describe('resolveConfig — provider detection', () => {
  test('defaults to firstParty when no CLAUDE_CODE_USE_* flags are set', () => {
    const cfg = resolveConfig(env({}))
    expect(cfg.provider).toBe('firstParty')
  })

  test('CLAUDE_CODE_USE_OPENAI=1 → openai provider', () => {
    const cfg = resolveConfig(env({ CLAUDE_CODE_USE_OPENAI: '1', OPENAI_MODEL: 'gpt-4o' }))
    expect(cfg.provider).toBe('openai')
  })

  test('CLAUDE_CODE_USE_OPENAI=1 + codex model alias → codex provider', () => {
    const cfg = resolveConfig(env({ CLAUDE_CODE_USE_OPENAI: '1', OPENAI_MODEL: 'codexplan' }))
    expect(cfg.provider).toBe('codex')
  })

  test('CLAUDE_CODE_USE_GEMINI=1 → gemini provider', () => {
    const cfg = resolveConfig(env({ CLAUDE_CODE_USE_GEMINI: '1' }))
    expect(cfg.provider).toBe('gemini')
  })

  test('CLAUDE_CODE_USE_GITHUB=1 → github provider', () => {
    const cfg = resolveConfig(env({ CLAUDE_CODE_USE_GITHUB: '1' }))
    expect(cfg.provider).toBe('github')
  })

  test('CLAUDE_CODE_USE_BEDROCK=1 → bedrock provider', () => {
    const cfg = resolveConfig(env({ CLAUDE_CODE_USE_BEDROCK: '1' }))
    expect(cfg.provider).toBe('bedrock')
  })

  test('CLAUDE_CODE_USE_VERTEX=1 → vertex provider', () => {
    const cfg = resolveConfig(env({ CLAUDE_CODE_USE_VERTEX: '1' }))
    expect(cfg.provider).toBe('vertex')
  })

  test('CLAUDE_CODE_USE_FOUNDRY=1 → foundry provider', () => {
    const cfg = resolveConfig(env({ CLAUDE_CODE_USE_FOUNDRY: '1' }))
    expect(cfg.provider).toBe('foundry')
  })

  test('CLAUDE_CODE_USE_GEMINI takes precedence over CLAUDE_CODE_USE_OPENAI', () => {
    const cfg = resolveConfig(
      env({ CLAUDE_CODE_USE_GEMINI: '1', CLAUDE_CODE_USE_OPENAI: '1' }),
    )
    expect(cfg.provider).toBe('gemini')
  })
})

// ---------------------------------------------------------------------------
// Local provider detection
// ---------------------------------------------------------------------------

describe('resolveConfig — isLocalProvider', () => {
  test('localhost Ollama URL is detected as local', () => {
    const cfg = resolveConfig(
      env({
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: 'http://localhost:11434/v1',
        OPENAI_MODEL: 'llama3.2',
      }),
    )
    expect(cfg.isLocalProvider).toBe(true)
  })

  test('OpenAI public URL is not local', () => {
    const cfg = resolveConfig(
      env({
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_API_KEY: 'sk-test',
        OPENAI_MODEL: 'gpt-4o',
      }),
    )
    expect(cfg.isLocalProvider).toBe(false)
  })

  test('firstParty provider is not local', () => {
    const cfg = resolveConfig(env({}))
    expect(cfg.isLocalProvider).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Credential status
// ---------------------------------------------------------------------------

describe('resolveConfig — credentials', () => {
  test('openai: key present', () => {
    const cfg = resolveConfig(
      env({ CLAUDE_CODE_USE_OPENAI: '1', OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-4o' }),
    )
    expect(cfg.credentials.openaiApiKey).toBe('present')
    expect(cfg.credentials.anthropicApiKey).toBe('not-required')
  })

  test('openai: key missing shows missing', () => {
    const cfg = resolveConfig(
      env({ CLAUDE_CODE_USE_OPENAI: '1', OPENAI_MODEL: 'gpt-4o' }),
    )
    expect(cfg.credentials.openaiApiKey).toBe('missing')
  })

  test('firstParty: anthropic key present', () => {
    const cfg = resolveConfig(env({ ANTHROPIC_API_KEY: 'sk-ant-test' }))
    expect(cfg.credentials.anthropicApiKey).toBe('present')
    expect(cfg.credentials.openaiApiKey).toBe('not-required')
  })

  test('gemini: api key present', () => {
    const cfg = resolveConfig(env({ CLAUDE_CODE_USE_GEMINI: '1', GEMINI_API_KEY: 'key' }))
    expect(cfg.credentials.geminiApiKey).toBe('present')
  })

  test('gemini: falls back to GOOGLE_API_KEY', () => {
    const cfg = resolveConfig(env({ CLAUDE_CODE_USE_GEMINI: '1', GOOGLE_API_KEY: 'key' }))
    expect(cfg.credentials.geminiApiKey).toBe('present')
  })

  test('github: token present', () => {
    const cfg = resolveConfig(env({ CLAUDE_CODE_USE_GITHUB: '1', GITHUB_TOKEN: 'ghp_test' }))
    expect(cfg.credentials.githubToken).toBe('present')
  })

  test('vertex: project id present', () => {
    const cfg = resolveConfig(
      env({ CLAUDE_CODE_USE_VERTEX: '1', ANTHROPIC_VERTEX_PROJECT_ID: 'proj' }),
    )
    expect(cfg.credentials.vertexProjectId).toBe('present')
  })

  test('bedrock: bearer token present', () => {
    const cfg = resolveConfig(
      env({ CLAUDE_CODE_USE_BEDROCK: '1', AWS_BEARER_TOKEN_BEDROCK: 'tok' }),
    )
    expect(cfg.credentials.awsCredentials).toBe('present')
  })

  test('bedrock: access key alone (no secret) shows missing', () => {
    const cfg = resolveConfig(
      env({ CLAUDE_CODE_USE_BEDROCK: '1', AWS_ACCESS_KEY_ID: 'AKIATEST' }),
    )
    expect(cfg.credentials.awsCredentials).toBe('missing')
  })

  test('bedrock: access key + secret shows present', () => {
    const cfg = resolveConfig(
      env({ CLAUDE_CODE_USE_BEDROCK: '1', AWS_ACCESS_KEY_ID: 'AKIATEST', AWS_SECRET_ACCESS_KEY: 'sec' }),
    )
    expect(cfg.credentials.awsCredentials).toBe('present')
  })

  test('bedrock: ECS task role shows present', () => {
    const cfg = resolveConfig(
      env({ CLAUDE_CODE_USE_BEDROCK: '1', AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/test' }),
    )
    expect(cfg.credentials.awsCredentials).toBe('present')
  })

  test('bedrock: EKS IRSA shows present when both token file and role ARN are set', () => {
    const cfg = resolveConfig(
      env({
        CLAUDE_CODE_USE_BEDROCK: '1',
        AWS_WEB_IDENTITY_TOKEN_FILE: '/var/run/secrets/token',
        AWS_ROLE_ARN: 'arn:aws:iam::123:role/r',
      }),
    )
    expect(cfg.credentials.awsCredentials).toBe('present')
  })

  test('foundry: resource present', () => {
    const cfg = resolveConfig(
      env({ CLAUDE_CODE_USE_FOUNDRY: '1', ANTHROPIC_FOUNDRY_RESOURCE: 'my-resource' }),
    )
    expect(cfg.credentials.foundryResource).toBe('present')
  })
})

// ---------------------------------------------------------------------------
// Debug format — secrets must be redacted
// ---------------------------------------------------------------------------

describe('formatResolvedConfigDebug — secret redaction', () => {
  const secretCases: Array<[string, Partial<ResolvedConfig>]> = [
    ['openaiApiKey', { provider: 'openai', credentials: { openaiApiKey: 'present', anthropicApiKey: 'not-required', codexApiKey: 'not-required', geminiApiKey: 'not-required', githubToken: 'not-required', awsCredentials: 'not-required', vertexProjectId: 'not-required', foundryResource: 'not-required' } }],
    ['geminiApiKey', { provider: 'gemini', credentials: { openaiApiKey: 'not-required', anthropicApiKey: 'not-required', codexApiKey: 'not-required', geminiApiKey: 'present', githubToken: 'not-required', awsCredentials: 'not-required', vertexProjectId: 'not-required', foundryResource: 'not-required' } }],
  ]

  const baseConfig: ResolvedConfig = {
    provider: 'openai',
    isLocalProvider: false,
    resolvedModel: 'gpt-4o',
    requestedModel: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
    transport: 'chat_completions',
    credentials: {
      anthropicApiKey: 'not-required',
      openaiApiKey: 'present',
      codexApiKey: 'not-required',
      geminiApiKey: 'not-required',
      githubToken: 'not-required',
      awsCredentials: 'not-required',
      vertexProjectId: 'not-required',
      foundryResource: 'not-required',
    },
  }

  test('output does not contain [REDACTED] placeholder literally in non-secret fields', () => {
    const output = formatResolvedConfigDebug(baseConfig)
    // provider line should be unredacted
    expect(output).toContain('provider:')
    expect(output).toContain('openai')
  })

  test('secret key with "present" status is redacted in output', () => {
    const output = formatResolvedConfigDebug(baseConfig)
    expect(output).toContain('[REDACTED]')
    // The actual key value should never appear
    expect(output).not.toContain('sk-')
  })

  test('missing credential shows MISSING in output', () => {
    const cfg: ResolvedConfig = {
      ...baseConfig,
      credentials: { ...baseConfig.credentials, openaiApiKey: 'missing' },
    }
    const output = formatResolvedConfigDebug(cfg)
    expect(output).toContain('MISSING')
  })

  test('not-required credential shows not-required in output', () => {
    const output = formatResolvedConfigDebug(baseConfig)
    expect(output).toContain('not-required')
  })

  test('output includes provider and baseUrl lines', () => {
    const output = formatResolvedConfigDebug(baseConfig)
    expect(output).toContain('provider:')
    expect(output).toContain('baseUrl:')
    expect(output).toContain('transport:')
  })

  test.each(secretCases)('credential key %s with present status is redacted', (key, partial) => {
    const cfg = { ...baseConfig, ...partial } as ResolvedConfig
    const output = formatResolvedConfigDebug(cfg)
    // value should not bleed through as plain text
    expect(output).not.toMatch(/sk-|ghp_|key123/)
    expect(output).toContain('[REDACTED]')
  })

  test('URL with embedded password is sanitized in debug output', () => {
    const cfg: ResolvedConfig = {
      ...baseConfig,
      baseUrl: 'https://user:super-secret-pass@proxy.example.com/v1',
    }
    const output = formatResolvedConfigDebug(cfg)
    expect(output).not.toContain('super-secret-pass')
    expect(output).toContain('proxy.example.com')
  })

  test('URL with query-string API key is sanitized in debug output', () => {
    const cfg: ResolvedConfig = {
      ...baseConfig,
      baseUrl: 'https://proxy.example.com/v1?api_key=my-secret-token',
    }
    const output = formatResolvedConfigDebug(cfg)
    expect(output).not.toContain('my-secret-token')
    expect(output).toContain('proxy.example.com')
  })

  test('plain URL without credentials is preserved in debug output', () => {
    const output = formatResolvedConfigDebug(baseConfig)
    expect(output).toContain('api.openai.com')
  })
})

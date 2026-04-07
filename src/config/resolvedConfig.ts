/**
 * Canonical config resolver — single entry point for all runtime provider config.
 *
 * Reads environment variables exactly once and assembles a typed `ResolvedConfig`
 * object.  All other code should consume this object rather than reading
 * process.env directly for provider/model/credential decisions.
 *
 * Call `printResolvedConfigDebug()` (guarded by CLAUDE_CODE_DEBUG=1) to print a
 * redacted view of what was resolved — useful for debugging misconfigured setups
 * without exposing secrets.
 */

import { isEnvTruthy } from '../utils/envUtils.js'
import {
  isLocalProviderUrl,
  resolveCodexApiCredentials,
  resolveProviderRequest,
  type ResolvedProviderRequest,
} from '../services/api/providerConfig.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderKind =
  | 'firstParty'
  | 'openai'
  | 'gemini'
  | 'github'
  | 'codex'
  | 'bedrock'
  | 'vertex'
  | 'foundry'

export type CredentialStatus = 'present' | 'missing' | 'not-required'

export type ResolvedConfig = {
  /** Which provider will handle API calls */
  provider: ProviderKind
  /** Whether the provider URL / endpoint resolves to localhost / private range */
  isLocalProvider: boolean
  /** Resolved model name (after alias expansion) */
  resolvedModel: string
  /** The model string as the user supplied it */
  requestedModel: string
  /** Base URL for API calls (secrets redacted elsewhere — this is the URL only) */
  baseUrl: string
  /** Transport layer selection */
  transport: ResolvedProviderRequest['transport']
  /** Credential availability per-provider */
  credentials: {
    anthropicApiKey: CredentialStatus
    openaiApiKey: CredentialStatus
    codexApiKey: CredentialStatus
    geminiApiKey: CredentialStatus
    githubToken: CredentialStatus
    awsCredentials: CredentialStatus
    vertexProjectId: CredentialStatus
    foundryResource: CredentialStatus
  }
  /** Optional reasoning effort (Codex models) */
  reasoningEffort?: string
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function credentialStatus(
  value: string | undefined,
): CredentialStatus {
  if (!value || !value.trim()) return 'missing'
  return 'present'
}

function notRequired(): CredentialStatus {
  return 'not-required'
}

function resolveProviderRequestFromEnv(
  env: NodeJS.ProcessEnv,
): ResolvedProviderRequest {
  return resolveProviderRequest({
    model: env.OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL ?? env.OPENAI_API_BASE,
  })
}

function detectProvider(env: NodeJS.ProcessEnv): ProviderKind {
  if (isEnvTruthy(env.CLAUDE_CODE_USE_GEMINI)) return 'gemini'
  if (isEnvTruthy(env.CLAUDE_CODE_USE_GITHUB)) return 'github'
  if (isEnvTruthy(env.CLAUDE_CODE_USE_OPENAI)) {
    const request = resolveProviderRequestFromEnv(env)
    return request.transport === 'codex_responses' ? 'codex' : 'openai'
  }
  if (isEnvTruthy(env.CLAUDE_CODE_USE_BEDROCK)) return 'bedrock'
  if (isEnvTruthy(env.CLAUDE_CODE_USE_VERTEX)) return 'vertex'
  if (isEnvTruthy(env.CLAUDE_CODE_USE_FOUNDRY)) return 'foundry'
  return 'firstParty'
}

/**
 * Return the CredentialStatus for AWS Bedrock credentials.
 * Mirrors the logic in validateBedrockConfig() so the debug view is consistent
 * with what startup validation checks.
 */
function bedrockCredentialStatus(env: NodeJS.ProcessEnv): CredentialStatus {
  if (env.AWS_BEARER_TOKEN_BEDROCK?.trim()) return 'present'
  if (env.AWS_ACCESS_KEY_ID?.trim() && env.AWS_SECRET_ACCESS_KEY?.trim()) return 'present'
  if (env.AWS_PROFILE?.trim() || env.AWS_SHARED_CREDENTIALS_FILE?.trim()) return 'present'
  if (
    env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI?.trim() ||
    env.AWS_CONTAINER_CREDENTIALS_FULL_URI?.trim()
  ) return 'present'
  if (env.AWS_WEB_IDENTITY_TOKEN_FILE?.trim() && env.AWS_ROLE_ARN?.trim()) return 'present'
  return 'missing'
}

function buildCredentials(
  provider: ProviderKind,
  env: NodeJS.ProcessEnv,
): ResolvedConfig['credentials'] {
  const codexCreds = (provider === 'codex')
    ? resolveCodexApiCredentials(env)
    : null

  return {
    anthropicApiKey:
      provider === 'firstParty'
        ? credentialStatus(env.ANTHROPIC_API_KEY)
        : notRequired(),
    openaiApiKey:
      provider === 'openai'
        ? credentialStatus(env.OPENAI_API_KEY)
        : notRequired(),
    codexApiKey:
      provider === 'codex'
        ? (codexCreds?.apiKey ? 'present' : 'missing')
        : notRequired(),
    geminiApiKey:
      provider === 'gemini'
        ? credentialStatus(
            env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? env.GEMINI_ACCESS_TOKEN,
          )
        : notRequired(),
    githubToken:
      provider === 'github'
        ? credentialStatus(env.GITHUB_TOKEN ?? env.GH_TOKEN)
        : notRequired(),
    awsCredentials:
      provider === 'bedrock'
        ? bedrockCredentialStatus(env)
        : notRequired(),
    vertexProjectId:
      provider === 'vertex'
        ? credentialStatus(
            env.ANTHROPIC_VERTEX_PROJECT_ID ??
              env.GCLOUD_PROJECT ??
              env.GOOGLE_CLOUD_PROJECT,
          )
        : notRequired(),
    foundryResource:
      provider === 'foundry'
        ? credentialStatus(
            env.ANTHROPIC_FOUNDRY_RESOURCE ?? env.ANTHROPIC_FOUNDRY_BASE_URL,
          )
        : notRequired(),
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the complete runtime provider config from the given environment.
 * Defaults to `process.env`.
 */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const provider = detectProvider(env)

  const request = (provider === 'openai' || provider === 'codex' || provider === 'github')
    ? resolveProviderRequestFromEnv(env)
    : {
        transport: 'chat_completions' as const,
        requestedModel: env.OPENAI_MODEL ?? env.GEMINI_MODEL ?? env.ANTHROPIC_MODEL ?? '',
        resolvedModel: env.OPENAI_MODEL ?? env.GEMINI_MODEL ?? env.ANTHROPIC_MODEL ?? '',
        baseUrl: '',
        reasoning: undefined,
      }

  return {
    provider,
    isLocalProvider: isLocalProviderUrl(request.baseUrl),
    resolvedModel: request.resolvedModel,
    requestedModel: request.requestedModel,
    baseUrl: request.baseUrl,
    transport: request.transport,
    credentials: buildCredentials(provider, env),
    reasoningEffort: request.reasoning?.effort,
  }
}

// ---------------------------------------------------------------------------
// Redacted debug view
// ---------------------------------------------------------------------------

/** Keys whose values must be redacted in debug output */
const SECRET_KEYS: ReadonlySet<string> = new Set([
  'anthropicApiKey',
  'openaiApiKey',
  'codexApiKey',
  'geminiApiKey',
  'githubToken',
])

function redactCredential(key: string, status: CredentialStatus): string {
  if (status === 'not-required') return 'not-required'
  if (status === 'missing') return 'MISSING'
  // present — show redacted marker for secret keys
  return SECRET_KEYS.has(key) ? '[REDACTED]' : 'present'
}

/**
 * Strip userinfo (username:password) and query string from a URL so it is safe
 * to include in debug output.  Returns the URL unchanged if it cannot be parsed.
 */
function sanitizeUrlForDisplay(url: string): string {
  if (!url) return url
  try {
    const parsed = new URL(url)
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * Build a human-readable, secret-free representation of the resolved config.
 * Safe to print to stderr or log files.
 */
export function formatResolvedConfigDebug(config: ResolvedConfig): string {
  const credLines = Object.entries(config.credentials)
    .map(([k, v]) => `    ${k}: ${redactCredential(k, v as CredentialStatus)}`)
    .join('\n')

  return [
    '[ResolvedConfig]',
    `  provider:        ${config.provider}`,
    `  isLocalProvider: ${config.isLocalProvider}`,
    `  transport:       ${config.transport}`,
    `  requestedModel:  ${config.requestedModel || '(none)'}`,
    `  resolvedModel:   ${config.resolvedModel || '(none)'}`,
    `  baseUrl:         ${sanitizeUrlForDisplay(config.baseUrl) || '(default)'}`,
    ...(config.reasoningEffort
      ? [`  reasoningEffort: ${config.reasoningEffort}`]
      : []),
    '  credentials:',
    credLines,
  ].join('\n')
}

/**
 * Print the resolved config debug view to stderr when CLAUDE_CODE_DEBUG=1.
 * Secrets are always redacted regardless of debug level.
 */
export function printResolvedConfigDebug(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isEnvTruthy(env.CLAUDE_CODE_DEBUG)) return
  const config = resolveConfig(env)
  // biome-ignore lint/suspicious/noConsole: intentional debug output to stderr
  console.error(formatResolvedConfigDebug(config))
}

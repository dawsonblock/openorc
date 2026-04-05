import {
  isLocalProviderUrl,
  resolveCodexApiCredentials,
  resolveProviderRequest,
} from '../services/api/providerConfig.js'
import {
  type GeminiResolvedCredential,
  resolveGeminiCredential,
} from './geminiAuth.js'
import { redactSecretValueForDisplay } from './providerProfile.js'

function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== '0' && normalized !== 'false' && normalized !== 'no'
}

/** Validate Bedrock config: at least one auth path must be resolvable. */
function validateBedrockConfig(env: NodeJS.ProcessEnv): string | null {
  // Bearer token is the simplest auth path
  if (env.AWS_BEARER_TOKEN_BEDROCK?.trim()) return null
  // Skip-auth flag is an explicit opt-out for proxy/testing setups
  if (isEnvTruthy(env.CLAUDE_CODE_SKIP_BEDROCK_AUTH)) return null
  // Standard AWS SDK credential chain: access key + secret
  if (env.AWS_ACCESS_KEY_ID?.trim() && env.AWS_SECRET_ACCESS_KEY?.trim()) return null
  // Credential file / profile / EC2 instance role cannot be checked here without
  // making a network call; emit a warning rather than a hard failure so that
  // users relying on IAM roles or ~/.aws/credentials can still start.
  if (env.AWS_PROFILE?.trim() || env.AWS_SHARED_CREDENTIALS_FILE?.trim()) return null
  // Roles via the metadata service can't be probed at startup — allow through
  // but the runtime will fail if credentials are absent.
  return (
    'CLAUDE_CODE_USE_BEDROCK=1 is set but no AWS credentials were found.\n' +
    '  Set AWS_BEARER_TOKEN_BEDROCK, or set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY,\n' +
    '  or use an IAM role / AWS_PROFILE and ensure the credential chain is configured.\n' +
    '  Set CLAUDE_CODE_SKIP_BEDROCK_AUTH=1 to bypass this check for proxy/testing setups.\n' +
    '  Note: Bedrock support is EXPERIMENTAL.'
  )
}

/** Validate Vertex config: project ID is required. */
function validateVertexConfig(env: NodeJS.ProcessEnv): string | null {
  if (isEnvTruthy(env.CLAUDE_CODE_SKIP_VERTEX_AUTH)) return null
  const projectId = (
    env.ANTHROPIC_VERTEX_PROJECT_ID ??
    env.GCLOUD_PROJECT ??
    env.GOOGLE_CLOUD_PROJECT
  )?.trim()
  if (projectId) return null
  return (
    'CLAUDE_CODE_USE_VERTEX=1 is set but ANTHROPIC_VERTEX_PROJECT_ID (or ' +
    'GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT) is not set.\n' +
    '  Set CLAUDE_CODE_SKIP_VERTEX_AUTH=1 to bypass this check for proxy setups.\n' +
    '  Note: Vertex support is EXPERIMENTAL.'
  )
}

/** Validate Foundry config: endpoint resource is required. */
function validateFoundryConfig(env: NodeJS.ProcessEnv): string | null {
  if (isEnvTruthy(env.CLAUDE_CODE_SKIP_FOUNDRY_AUTH)) return null
  const resource = (
    env.ANTHROPIC_FOUNDRY_RESOURCE ?? env.ANTHROPIC_FOUNDRY_BASE_URL
  )?.trim()
  if (resource) return null
  return (
    'CLAUDE_CODE_USE_FOUNDRY=1 is set but neither ANTHROPIC_FOUNDRY_RESOURCE nor ' +
    'ANTHROPIC_FOUNDRY_BASE_URL is set.\n' +
    '  Set CLAUDE_CODE_SKIP_FOUNDRY_AUTH=1 to bypass this check for proxy setups.\n' +
    '  Note: Foundry support is EXPERIMENTAL.'
  )
}

export async function getProviderValidationError(
  env: NodeJS.ProcessEnv = process.env,
  options?: {
    resolveGeminiCredential?: (
      env: NodeJS.ProcessEnv,
    ) => Promise<GeminiResolvedCredential>
  },
): Promise<string | null> {
  const useOpenAI = isEnvTruthy(env.CLAUDE_CODE_USE_OPENAI)
  const useGithub = isEnvTruthy(env.CLAUDE_CODE_USE_GITHUB)

  if (isEnvTruthy(env.CLAUDE_CODE_USE_GEMINI)) {
    const geminiCredential = await (
      options?.resolveGeminiCredential ?? resolveGeminiCredential
    )(env)
    if (geminiCredential.kind === 'none') {
      return 'GEMINI_API_KEY, GOOGLE_API_KEY, GEMINI_ACCESS_TOKEN, or Google ADC credentials are required when CLAUDE_CODE_USE_GEMINI=1.'
    }
    return null
  }

  if (isEnvTruthy(env.CLAUDE_CODE_USE_BEDROCK)) {
    return validateBedrockConfig(env)
  }

  if (isEnvTruthy(env.CLAUDE_CODE_USE_VERTEX)) {
    return validateVertexConfig(env)
  }

  if (isEnvTruthy(env.CLAUDE_CODE_USE_FOUNDRY)) {
    return validateFoundryConfig(env)
  }

  if (useGithub && !useOpenAI) {
    const token = (env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim()) ?? ''
    if (!token) {
      return 'GITHUB_TOKEN or GH_TOKEN is required when CLAUDE_CODE_USE_GITHUB=1.'
    }
    return null
  }

  if (!useOpenAI) {
    return null
  }

  const request = resolveProviderRequest({
    model: env.OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL,
  })

  if (env.OPENAI_API_KEY === 'SUA_CHAVE') {
    return 'Invalid OPENAI_API_KEY: placeholder value SUA_CHAVE detected. Set a real key or unset for local providers.'
  }

  if (request.transport === 'codex_responses') {
    const credentials = resolveCodexApiCredentials(env)
    if (!credentials.apiKey) {
      const authHint = credentials.authPath
        ? ` or put auth.json at ${credentials.authPath}`
        : ''
      const safeModel =
        redactSecretValueForDisplay(request.requestedModel, env) ??
        'the requested model'
      return `Codex auth is required for ${safeModel}. Set CODEX_API_KEY${authHint}.`
    }
    if (!credentials.accountId) {
      return 'Codex auth is missing chatgpt_account_id. Re-login with Codex or set CHATGPT_ACCOUNT_ID/CODEX_ACCOUNT_ID.'
    }
    return null
  }

  if (!env.OPENAI_API_KEY && !isLocalProviderUrl(request.baseUrl)) {
    const hasGithubToken = !!(env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim())
    if (useGithub && hasGithubToken) {
      return null
    }
    return 'OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI=1 and OPENAI_BASE_URL is not local.'
  }

  return null
}

export async function validateProviderEnvOrExit(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const error = await getProviderValidationError(env)
  if (error) {
    console.error(error)
    process.exit(1)
  }
}

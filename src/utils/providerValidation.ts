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
  // Standard AWS SDK credential chain: access key + secret (both required)
  if (env.AWS_ACCESS_KEY_ID?.trim() && env.AWS_SECRET_ACCESS_KEY?.trim()) return null
  // Credential file / profile
  if (env.AWS_PROFILE?.trim() || env.AWS_SHARED_CREDENTIALS_FILE?.trim()) return null
  // ECS task role (container credentials)
  if (
    env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI?.trim() ||
    env.AWS_CONTAINER_CREDENTIALS_FULL_URI?.trim()
  ) return null
  // EKS / IRSA (web identity token)
  if (env.AWS_WEB_IDENTITY_TOKEN_FILE?.trim() && env.AWS_ROLE_ARN?.trim()) return null
  // EC2 instance roles and other metadata-service-based auth cannot be verified at
  // startup without making a network call. Use CLAUDE_CODE_SKIP_BEDROCK_AUTH=1 to
  // bypass this check when running on EC2 with an instance profile.
  return (
    'CLAUDE_CODE_USE_BEDROCK=1 is set but no AWS credentials were found.\n' +
    '  Set AWS_BEARER_TOKEN_BEDROCK, or set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY,\n' +
    '  or use AWS_PROFILE / AWS_SHARED_CREDENTIALS_FILE for credential-file auth,\n' +
    '  or set AWS_CONTAINER_CREDENTIALS_RELATIVE_URI / AWS_WEB_IDENTITY_TOKEN_FILE for ECS/EKS roles.\n' +
    '  If using an EC2 instance profile or another metadata-service auth source,\n' +
    '  set CLAUDE_CODE_SKIP_BEDROCK_AUTH=1 to bypass this startup check.\n' +
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
  // Validation follows the same priority order as getAPIProvider() in
  // src/utils/model/providers.ts so we validate only the provider that
  // will actually be selected at runtime.

  // 1. Gemini takes top priority
  if (isEnvTruthy(env.CLAUDE_CODE_USE_GEMINI)) {
    const geminiCredential = await (
      options?.resolveGeminiCredential ?? resolveGeminiCredential
    )(env)
    if (geminiCredential.kind === 'none') {
      return 'GEMINI_API_KEY, GOOGLE_API_KEY, GEMINI_ACCESS_TOKEN, or Google ADC credentials are required when CLAUDE_CODE_USE_GEMINI=1.'
    }
    return null
  }

  // 2. GitHub Models — takes priority over CLAUDE_CODE_USE_OPENAI when both are set
  if (isEnvTruthy(env.CLAUDE_CODE_USE_GITHUB)) {
    const token = (env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim()) ?? ''
    if (!token) {
      return 'GITHUB_TOKEN or GH_TOKEN is required when CLAUDE_CODE_USE_GITHUB=1.'
    }
    return null
  }

  // 3. OpenAI-compatible (including Codex model aliases)
  if (isEnvTruthy(env.CLAUDE_CODE_USE_OPENAI)) {
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
      return 'OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI=1 and OPENAI_BASE_URL is not local.'
    }

    return null
  }

  // 4. AWS Bedrock
  if (isEnvTruthy(env.CLAUDE_CODE_USE_BEDROCK)) {
    return validateBedrockConfig(env)
  }

  // 5. Google Vertex AI
  if (isEnvTruthy(env.CLAUDE_CODE_USE_VERTEX)) {
    return validateVertexConfig(env)
  }

  // 6. Anthropic Foundry (Azure)
  if (isEnvTruthy(env.CLAUDE_CODE_USE_FOUNDRY)) {
    return validateFoundryConfig(env)
  }

  // 7. First-party Anthropic — auth is validated at runtime by the SDK
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

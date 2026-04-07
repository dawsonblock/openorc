/**
 * Supported provider matrix — single source of truth.
 *
 * Every provider listed here maps directly to the `APIProvider` type in
 * src/utils/model/providers.ts.  The `status` field signals whether the
 * provider and its listed capabilities are verified by automated tests
 * ("stable") or are present in code but not fully covered ("experimental").
 *
 * Rules for editing this file:
 *   - Do not add a new provider entry without code that selects it.
 *   - Downgrade status to "experimental" rather than leaving unproven claims.
 *   - Add a capability only if there is a code path that exercises it.
 */

export type ProviderStatus = 'stable' | 'experimental'

export type ProviderCapabilities = {
  /** Streaming token responses */
  streaming: boolean
  /** Multi-step tool/function call loops */
  toolCalling: boolean
  /** Image / vision inputs */
  vision: boolean
  /** Token usage reporting */
  usageReporting: boolean
  /** Web search (built-in or shim) */
  webSearch: boolean
}

export type ProviderMatrixEntry = {
  /** Display name shown in docs and UI */
  displayName: string
  /**
   * "stable"       — verified by tests, expected to work on every release.
   * "experimental" — code path exists; behavior or auth may fail silently.
   */
  status: ProviderStatus
  /** How the provider is activated */
  activationEnvVar: string
  /** Which capabilities are exercised by automated tests */
  capabilities: ProviderCapabilities
  /** Free-text notes shown in docs */
  notes: string
}

/**
 * Canonical provider support matrix.
 *
 * Keys must match the `APIProvider` union in src/utils/model/providers.ts.
 */
export const PROVIDER_MATRIX: Record<string, ProviderMatrixEntry> = {
  firstParty: {
    displayName: 'Anthropic (first-party)',
    status: 'stable',
    activationEnvVar: '(default — no flag needed)',
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      usageReporting: true,
      webSearch: true,
    },
    notes: 'Requires ANTHROPIC_API_KEY or Claude.ai account login.',
  },

  openai: {
    displayName: 'OpenAI-compatible',
    status: 'stable',
    activationEnvVar: 'CLAUDE_CODE_USE_OPENAI=1',
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      usageReporting: true,
      webSearch: true,
    },
    notes:
      'Works with OpenAI, OpenRouter, DeepSeek, Groq, Mistral, LM Studio, ' +
      'Ollama, and any /v1-compatible server.  Set OPENAI_BASE_URL for non-OpenAI endpoints.',
  },

  gemini: {
    displayName: 'Google Gemini',
    status: 'stable',
    activationEnvVar: 'CLAUDE_CODE_USE_GEMINI=1',
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      usageReporting: true,
      webSearch: true,
    },
    notes:
      'Supports API key (GEMINI_API_KEY / GOOGLE_API_KEY), access token, or ADC.',
  },

  github: {
    displayName: 'GitHub Models',
    status: 'stable',
    activationEnvVar: 'CLAUDE_CODE_USE_GITHUB=1',
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: false,
      usageReporting: false,
      webSearch: true,
    },
    notes: 'Requires GITHUB_TOKEN or GH_TOKEN with models access.',
  },

  codex: {
    displayName: 'Codex (OpenAI responses backend)',
    status: 'stable',
    activationEnvVar: 'CLAUDE_CODE_USE_OPENAI=1 + Codex model alias',
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: false,
      usageReporting: true,
      webSearch: false,
    },
    notes:
      'Auto-selected when model is a Codex alias (codexplan, codexspark, gpt-5.x-codex). ' +
      'Requires CODEX_API_KEY or ~/.codex/auth.json.',
  },

  bedrock: {
    displayName: 'AWS Bedrock',
    status: 'experimental',
    activationEnvVar: 'CLAUDE_CODE_USE_BEDROCK=1',
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      usageReporting: false,
      webSearch: false,
    },
    notes:
      'EXPERIMENTAL. Requires AWS credentials (standard SDK env vars or IAM role). ' +
      'Set AWS_REGION or AWS_DEFAULT_REGION. ' +
      'Startup validates that a credential source is present, but credential validity is only confirmed at runtime.',
  },

  vertex: {
    displayName: 'Google Vertex AI',
    status: 'experimental',
    activationEnvVar: 'CLAUDE_CODE_USE_VERTEX=1',
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      usageReporting: false,
      webSearch: false,
    },
    notes:
      'EXPERIMENTAL. Requires ANTHROPIC_VERTEX_PROJECT_ID and GCP credentials. ' +
      'Startup validates that the project ID is present, but GCP credential validity is only confirmed at runtime.',
  },

  foundry: {
    displayName: 'Anthropic Foundry (Azure)',
    status: 'experimental',
    activationEnvVar: 'CLAUDE_CODE_USE_FOUNDRY=1',
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: false,
      usageReporting: false,
      webSearch: false,
    },
    notes:
      'EXPERIMENTAL. Requires ANTHROPIC_FOUNDRY_RESOURCE (or ANTHROPIC_FOUNDRY_BASE_URL) ' +
      'and ANTHROPIC_FOUNDRY_API_KEY or DefaultAzureCredential. ' +
      'Startup validates that the resource endpoint is present, but Azure credential validity is only confirmed at runtime.',
  },
} as const

/**
 * All provider keys known to this matrix.
 */
export const KNOWN_PROVIDER_KEYS = Object.keys(PROVIDER_MATRIX)

/**
 * Return the matrix entry for `provider`, or undefined if unrecognised.
 */
export function getProviderMatrixEntry(
  provider: string,
): ProviderMatrixEntry | undefined {
  return PROVIDER_MATRIX[provider]
}

/**
 * Return true if `provider` appears in the matrix (stable or experimental).
 */
export function isKnownProvider(provider: string): boolean {
  return Object.hasOwn(PROVIDER_MATRIX, provider)
}

/**
 * Return all providers with status === "stable".
 */
export function getStableProviders(): string[] {
  return KNOWN_PROVIDER_KEYS.filter(
    k => PROVIDER_MATRIX[k]?.status === 'stable',
  )
}

/**
 * Return all providers with status === "experimental".
 */
export function getExperimentalProviders(): string[] {
  return KNOWN_PROVIDER_KEYS.filter(
    k => PROVIDER_MATRIX[k]?.status === 'experimental',
  )
}

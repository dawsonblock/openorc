# Experimental Areas

This file lists features and providers that are present in the codebase but are
**not covered by automated tests** and may behave incorrectly or fail silently.
They are shipped as-is for users who need them, but they do not carry the same
reliability expectations as the stable surface.

---

## Experimental Providers

### AWS Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`)

**Why experimental:**
- Startup validates that at least one credential source _appears_ to be configured,
  but cannot verify that the credentials are valid before the first API call.
  Invalid credentials will produce a runtime error, not a startup error.
- `usageReporting` and `webSearch` are not wired for Bedrock responses.
- There are no automated tests for the Bedrock code path end-to-end.

**Required config:**
- One of: `AWS_BEARER_TOKEN_BEDROCK`, `AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY`,
  `AWS_PROFILE`, or an IAM role attached to the host.
- `AWS_REGION` or `AWS_DEFAULT_REGION` (defaults to `us-east-1`).

**Bypass startup check:**
```
CLAUDE_CODE_SKIP_BEDROCK_AUTH=1
```

---

### Google Vertex AI (`CLAUDE_CODE_USE_VERTEX=1`)

**Why experimental:**
- Startup validates that `ANTHROPIC_VERTEX_PROJECT_ID` (or equivalent) is present,
  but cannot verify that GCP credentials are valid before the first API call.
  Invalid credentials will produce a runtime error, not a startup error.
- The 12-second metadata server timeout applies when running outside GCP and no
  project env var is set.
- `usageReporting` and `webSearch` are not wired for Vertex responses.
- There are no automated tests for the Vertex code path end-to-end.

**Required config:**
- `ANTHROPIC_VERTEX_PROJECT_ID` (or `GCLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT`).
- GCP credentials via `GOOGLE_APPLICATION_CREDENTIALS`, `gcloud auth`, or
  service account attached to the host.

**Bypass startup check:**
```
CLAUDE_CODE_SKIP_VERTEX_AUTH=1
```

---

### Anthropic Foundry — Azure (`CLAUDE_CODE_USE_FOUNDRY=1`)

**Why experimental:**
- Startup validates that `ANTHROPIC_FOUNDRY_RESOURCE` or `ANTHROPIC_FOUNDRY_BASE_URL`
  is present, but cannot verify that Azure credentials are valid before the first
  API call.  Auth failures (wrong key, expired token) produce runtime errors.
- `vision`, `usageReporting`, and `webSearch` are not wired for Foundry responses.
- There are no automated tests for the Foundry code path end-to-end.

**Required config:**
- `ANTHROPIC_FOUNDRY_RESOURCE` (e.g. `my-resource`) **or**
  `ANTHROPIC_FOUNDRY_BASE_URL` (full Azure endpoint).
- `ANTHROPIC_FOUNDRY_API_KEY` **or** DefaultAzureCredential (env vars, managed
  identity, Azure CLI, etc.).

**Bypass startup check:**
```
CLAUDE_CODE_SKIP_FOUNDRY_AUTH=1
```

---

## Other Experimental Areas

### Atomic Chat (`OPENAI_BASE_URL` pointing to a local Atomic Chat server)

Atomic Chat is not a distinct provider type.  It uses the OpenAI-compatible
(`CLAUDE_CODE_USE_OPENAI=1`) code path with a local base URL.  It is listed in
some setup guides but has no dedicated tests.

### Agent routing (`agentModels` / `agentRouting` in settings.json)

Agent routing rewrites the Anthropic client per-agent with a third-party
endpoint.  The routing logic is tested, but the credential forwarding safety
(stripping auth headers before sending to non-Anthropic endpoints) is not
independently audited in E2E tests.

### Voice and image tools

Voice input/output and image capture features depend on platform APIs (macOS,
specific terminal emulators) and are not covered by automated tests.

### Session save/resume

Session persistence is implemented but not covered by automated E2E tests.
Data is written to `~/.claude/` in JSON format.

---

## Removing Experimental Status

A provider or feature moves from experimental to stable when:

1. Automated tests cover at least: startup validation, a successful API call
   (mocked), and an auth failure.
2. The capability flags in `src/providers/supportedMatrix.ts` are verified by
   those tests.
3. The README provider table is updated to reflect `stable` status.

# Phase 20: factual journey explanation

> AI explains PAMANA's computed journey; it does not determine PAMANA's transport truth.

`POST /api/pamana-ai/journey-explanation` is an authenticated, optional passenger action. Trip planning completes before this endpoint is called. A missing key, timeout, rate limit, provider error, or malformed response changes only the explanation status; it never changes or invalidates the deterministic journey.

## Trust boundary

The frontend sends a reduced selected-journey view without coordinates, geometry, internal IDs, account identity, or report content. The backend independently validates and reconstructs an allowlisted factual payload before any provider request.

The provider receives ordered walking, transit, and transfer legs; display labels; route and variant codes; verified signboard text; fare, service, availability and disruption states; and explicit unknown values. Place labels and every other string are treated as untrusted data. The fixed system prompt forbids following instructions embedded in those strings and forbids inventing transport facts.

## Provider switching

`AI_PROVIDER` is read only by the server. Supported values are `gemini` and `openai`; the passenger request cannot select or override it. There is no automatic fallback, so a failed Gemini request never consumes OpenAI quota and a failed OpenAI request never calls Gemini.

For testing with Gemini:

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.6-flash
```

For final OpenAI use:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
```

Only the selected provider's key is required. Both adapters receive the same sanitized facts and fixed factual constraints, use structured JSON output, and normalize success or failure to the same endpoint contract. OpenAI uses the Responses API with `store: false`. Provider API keys are never part of Nuxt public runtime configuration or the response.

Changing the provider changes only the natural-language explanation. It does not change PAMANA's deterministic journey, transport facts, fares, schedules, waits, ETAs, disruption effects, availability, or geometry.

The endpoint returns one provider-neutral state:

- `AVAILABLE`
- `PROVIDER_UNAVAILABLE`
- `INVALID_JOURNEY`
- `NOT_CONFIGURED`

The response contains the selected `provider`, `explanation`, `generatedAt`, and an optional user-safe `warning`. Raw provider responses and errors are never returned.

## Existing prototype AI code

The server-only SDK dependencies, environment variables, provider selector, and client construction are reused. Prediction-era wait-time and route-recommendation prompts, ML inputs, recommendation scoring, and fallback route assumptions are outside this endpoint and are not used by the Phase 20 flow.

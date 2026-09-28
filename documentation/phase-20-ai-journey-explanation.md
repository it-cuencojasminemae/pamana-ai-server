# Phase 20: factual journey explanation

> AI explains PAMANA's computed journey; it does not determine PAMANA's transport truth.

`POST /api/pamana-ai/journey-explanation` is an authenticated, optional passenger action. Trip planning completes before this endpoint is called. A missing key, timeout, rate limit, provider error, or malformed response changes only the explanation status; it never changes or invalidates the deterministic journey.

## Trust boundary

The frontend sends a reduced selected-journey view without coordinates, geometry, internal IDs, account identity, or report content. The backend independently validates and reconstructs an allowlisted factual payload before any OpenAI request.

The provider receives ordered walking, transit, and transfer legs; display labels; route and variant codes; verified signboard text; fare, service, availability and disruption states; and explicit unknown values. Place labels and every other string are treated as untrusted data. The fixed system prompt forbids following instructions embedded in those strings and forbids inventing transport facts.

## OpenAI request

The server uses `OPENAI_API_KEY` and the existing `OPENAI_MODEL` convention. It calls the Responses API with structured JSON Schema output and `store: false`. The API key is never part of Nuxt public runtime configuration or the response.

The endpoint returns one provider-neutral state:

- `AVAILABLE`
- `PROVIDER_UNAVAILABLE`
- `INVALID_JOURNEY`
- `NOT_CONFIGURED`

The response contains `explanation`, `generatedAt`, and an optional user-safe `warning`. Raw OpenAI responses and errors are never returned.

## Existing prototype AI code

The server-only SDK dependency, environment variables, and client construction are reused. Prediction-era wait-time and route-recommendation prompts, Gemini selection, ML inputs, recommendation scoring, and fallback route assumptions are outside this endpoint and are not used by the Phase 20 flow.

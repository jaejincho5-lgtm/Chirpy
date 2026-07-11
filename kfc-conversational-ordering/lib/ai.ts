// Central model config. AI SDK v5 accepts a plain "provider/model" string and
// routes it through the Vercel AI Gateway when AI_GATEWAY_API_KEY or Vercel OIDC
// is present. No provider SDK import is needed for the scaffold.
//
// Currently on OpenAI via the gateway. To spend the OpenAI credit (not Vercel's),
// the gateway must have your OpenAI key added as BYOK — see the dashboard. Flip
// AGENT_MODEL back to "anthropic/claude-opus-4-8" in .env.local to revert.
export const AGENT_MODEL = process.env.AGENT_MODEL ?? "openai/gpt-4o";
export const CHEAP_MODEL = process.env.CHEAP_MODEL ?? "openai/gpt-4o-mini";

import { createHash, randomBytes } from "node:crypto";

export type AgentCoreTraceContext = {
  enabled: boolean;
  serviceName: string;
  channel: string;
  operation: string;
  sessionKey: string;
  runtimeSessionId: string;
  traceId: string;
  spanId: string;
  traceparent: string;
  xrayTraceId: string;
  baggage: string;
  headers: Record<string, string>;
};

type TraceContextInput = {
  sessionKey: string;
  customerId?: string;
  channel: string;
  operation: string;
};

type ObservationEvent = {
  event: string;
  model?: string;
  caseId?: string;
  intent?: string;
  cacheId?: string;
  passed?: boolean;
  stage?: string;
  toolCalls?: string[];
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  error?: string;
  turns?: number;
};

function stableHex(input: string, bytes: number): string {
  return createHash("sha256").update(input).digest("hex").slice(0, bytes * 2);
}

function uuidFromHex(hex: string): string {
  const chars = hex.padEnd(32, "0").slice(0, 32).split("");
  chars[12] = "4";
  chars[16] = ((Number.parseInt(chars[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function agentCoreRuntimeSessionId(sessionKey: string): string {
  return uuidFromHex(stableHex(`agentcore-session:${sessionKey}`, 16));
}

function createXrayTraceId(traceId: string, spanId: string): string {
  const epochHex = Math.floor(Date.now() / 1000).toString(16).padStart(8, "0").slice(-8);
  return `Root=1-${epochHex}-${traceId.slice(0, 24)};Parent=${spanId};Sampled=1`;
}

function baggageValue(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

export function createAgentCoreTraceContext(input: TraceContextInput): AgentCoreTraceContext {
  const runtimeSessionId = agentCoreRuntimeSessionId(input.sessionKey);
  const traceId = randomBytes(16).toString("hex");
  const spanId = randomBytes(8).toString("hex");
  const traceparent = `00-${traceId}-${spanId}-01`;
  const xrayTraceId = createXrayTraceId(traceId, spanId);
  const serviceName = process.env.AGENTCORE_SERVICE_NAME ?? "kfc-conversational-ordering-agent";
  const baggage = [
    `session.id=${baggageValue(runtimeSessionId)}`,
    `conversation.key=${baggageValue(input.sessionKey.slice(0, 128))}`,
    input.customerId ? `customer.id=${baggageValue(input.customerId)}` : null,
  ]
    .filter(Boolean)
    .join(",");

  return {
    enabled: process.env.AGENTCORE_OBSERVABILITY_ENABLED === "1",
    serviceName,
    channel: input.channel,
    operation: input.operation,
    sessionKey: input.sessionKey,
    runtimeSessionId,
    traceId,
    spanId,
    traceparent,
    xrayTraceId,
    baggage,
    headers: {
      traceparent,
      "X-Amzn-Trace-Id": xrayTraceId,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": runtimeSessionId,
      baggage,
    },
  };
}

export function withAgentCoreResponseHeaders(response: Response, context: AgentCoreTraceContext): Response {
  if (!context.enabled) return response;
  response.headers.set("X-AgentCore-Service", context.serviceName);
  response.headers.set("X-AgentCore-Session-Id", context.runtimeSessionId);
  response.headers.set("X-AgentCore-Traceparent", context.traceparent);
  return response;
}

export function logAgentCoreObservation(context: AgentCoreTraceContext, event: ObservationEvent): void {
  if (!context.enabled) return;

  console.info(
    JSON.stringify({
      type: "agentcore.observation",
      serviceName: context.serviceName,
      channel: context.channel,
      operation: context.operation,
      sessionId: context.runtimeSessionId,
      traceId: context.traceId,
      spanId: context.spanId,
      traceparent: context.traceparent,
      xrayTraceId: context.xrayTraceId,
      ...event,
    }),
  );
}

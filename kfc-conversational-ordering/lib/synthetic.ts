// One shared definition of "not a real customer" so business numbers
// (/api/stats, /api/console KPIs) can never be inflated by eval runs, viz
// seeds, harness probes, or the flow tests. The console FEED still shows
// these rows — flagged as test traffic — but they are excluded from KPIs.

const SYNTHETIC_PATTERNS = [
  /^agent_/, // eval suite customers
  /^viz_/, // decision-matrix viz seeds
  /^lib_/, // lib unit-test customers
  /^guest_/, // anonymous web-stage sessions
  /^guest$/,
  /flow(fix|fin)/, // channel-eval flow tests
  /probe_test/, // webhook security probes
  /turnlog_test/, // turn-log verification probes
  /ghost_test/, // follow-up sweep verification probes
  /otpsmoke/, // OTP durability verification probes
];

export function isSyntheticCustomer(customerId: string | null | undefined): boolean {
  if (!customerId) return true;
  return SYNTHETIC_PATTERNS.some((pattern) => pattern.test(customerId));
}

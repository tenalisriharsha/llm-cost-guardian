/** USD price per 1,000 tokens, by model. Used to back-fill cost when an event omits costUsd. */
export const PRICING_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 0.015, output: 0.075 },
  "claude-sonnet-5-5": { input: 0.003, output: 0.015 },
  "claude-haiku-4-5": { input: 0.001, output: 0.005 },
  "gpt-4o": { input: 0.0025, output: 0.01 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
};

export class UnknownModelPricingError extends Error {
  constructor(model: string) {
    super(`No pricing entry for model "${model}" and no costUsd was provided`);
    this.name = "UnknownModelPricingError";
  }
}

export function calculateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = PRICING_PER_1K_TOKENS[model];
  if (!rate) {
    throw new UnknownModelPricingError(model);
  }
  const cost = (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

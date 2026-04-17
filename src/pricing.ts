/**
 * Model pricing table (per million tokens, USD).
 * Prices are best-effort estimates based on public pricing pages.
 * Unknown models fall back to a conservative default.
 */

export interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheWritePerM: number;
}

/**
 * Per-model token breakdown for cost calculation.
 */
export interface ModelTokenDetail {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ModelCost {
  model: string;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalCost: number;
  tokens: ModelTokenDetail;
}

export interface CostSummary {
  totalCost: number;
  modelCosts: ModelCost[];
}

// Pricing per 1M tokens (USD)
// Source: https://platform.claude.com/docs/en/about-claude/pricing
//         https://openai.com/api/pricing/
const PRICING: Record<string, ModelPricing> = {
  // === Claude Models (official pricing from platform.claude.com) ===

  // Opus 4.7 — $5 input, $25 output
  'claude-opus-4-7':                { inputPerM: 5, outputPerM: 25, cacheReadPerM: 0.50, cacheWritePerM: 6.25 },

  // Opus 4.6 — $5 input, $25 output
  'claude-opus-4-6':                { inputPerM: 5, outputPerM: 25, cacheReadPerM: 0.50, cacheWritePerM: 6.25 },

  // Opus 4.5 — $5 input, $25 output
  'claude-opus-4-5':                { inputPerM: 5, outputPerM: 25, cacheReadPerM: 0.50, cacheWritePerM: 6.25 },

  // Opus 4.1 — $15 input, $75 output
  'claude-opus-4-1':                { inputPerM: 15, outputPerM: 75, cacheReadPerM: 1.50, cacheWritePerM: 18.75 },

  // Opus 4 — $15 input, $75 output
  'claude-opus-4-20250514':         { inputPerM: 15, outputPerM: 75, cacheReadPerM: 1.50, cacheWritePerM: 18.75 },
  'claude-opus-4':                  { inputPerM: 15, outputPerM: 75, cacheReadPerM: 1.50, cacheWritePerM: 18.75 },

  // Sonnet 4.6 — $3 input, $15 output
  'claude-sonnet-4-6':              { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.30, cacheWritePerM: 3.75 },

  // Sonnet 4.5 — $3 input, $15 output
  'claude-sonnet-4-5':              { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.30, cacheWritePerM: 3.75 },

  // Sonnet 4 — $3 input, $15 output
  'claude-sonnet-4-20250514':       { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.30, cacheWritePerM: 3.75 },
  'claude-sonnet-4':                { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.30, cacheWritePerM: 3.75 },

  // Sonnet 3.7 (deprecated) — $3 input, $15 output
  'claude-3-7-sonnet':              { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.30, cacheWritePerM: 3.75 },

  // Haiku 4.5 — $1 input, $5 output
  'claude-haiku-4-5':               { inputPerM: 1, outputPerM: 5, cacheReadPerM: 0.10, cacheWritePerM: 1.25 },

  // Haiku 3.5 — $0.80 input, $4 output
  'claude-haiku-4-5-20251001':      { inputPerM: 0.80, outputPerM: 4, cacheReadPerM: 0.08, cacheWritePerM: 1.0 },
  'claude-3-5-haiku-20241022':      { inputPerM: 0.80, outputPerM: 4, cacheReadPerM: 0.08, cacheWritePerM: 1.0 },
  'claude-3-5-haiku':               { inputPerM: 0.80, outputPerM: 4, cacheReadPerM: 0.08, cacheWritePerM: 1.0 },

  // Sonnet 3.5 (deprecated) — $3 input, $15 output
  'claude-3-5-sonnet-20241022':     { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.30, cacheWritePerM: 3.75 },
  'claude-3-5-sonnet-20240620':     { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.30, cacheWritePerM: 3.75 },

  // Opus 3 (deprecated) — $15 input, $75 output
  'claude-3-opus-20240229':         { inputPerM: 15, outputPerM: 75, cacheReadPerM: 1.50, cacheWritePerM: 18.75 },

  // Haiku 3 — $0.25 input, $1.25 output
  'claude-3-haiku-20240307':        { inputPerM: 0.25, outputPerM: 1.25, cacheReadPerM: 0.03, cacheWritePerM: 0.30 },

  // === OpenAI Models ===
  'gpt-4o':                         { inputPerM: 2.5, outputPerM: 10, cacheReadPerM: 1.25, cacheWritePerM: 2.5 },
  'gpt-4o-2024-08-06':              { inputPerM: 2.5, outputPerM: 10, cacheReadPerM: 1.25, cacheWritePerM: 2.5 },
  'gpt-4o-mini':                    { inputPerM: 0.15, outputPerM: 0.60, cacheReadPerM: 0.075, cacheWritePerM: 0.15 },
  'gpt-4-turbo':                    { inputPerM: 10, outputPerM: 30, cacheReadPerM: 5, cacheWritePerM: 10 },
  'o1':                             { inputPerM: 15, outputPerM: 60, cacheReadPerM: 7.5, cacheWritePerM: 15 },
  'o1-mini':                        { inputPerM: 3, outputPerM: 12, cacheReadPerM: 1.5, cacheWritePerM: 3 },
  'o3':                             { inputPerM: 10, outputPerM: 40, cacheReadPerM: 2.5, cacheWritePerM: 10 },
  'o3-mini':                        { inputPerM: 1.10, outputPerM: 4.40, cacheReadPerM: 0.55, cacheWritePerM: 1.10 },
  'o4-mini':                        { inputPerM: 1.10, outputPerM: 4.40, cacheReadPerM: 0.55, cacheWritePerM: 1.10 },
  'codex-mini-latest':              { inputPerM: 1.50, outputPerM: 6, cacheReadPerM: 0.75, cacheWritePerM: 1.50 },
};

// Conservative default for unknown models
const DEFAULT_PRICING: ModelPricing = {
  inputPerM: 3,
  outputPerM: 15,
  cacheReadPerM: 0.30,
  cacheWritePerM: 3.75,
};

/**
 * Look up pricing for a model. Uses prefix matching for versioned model names.
 */
function getPricing(model: string): ModelPricing {
  // Exact match
  if (PRICING[model]) return PRICING[model];

  // Prefix match (e.g. "claude-opus-4-6-20260101" → "claude-opus-4-6")
  for (const key of Object.keys(PRICING)) {
    if (model.startsWith(key)) return PRICING[key];
  }

  // Substring match (e.g. "anthropic/claude-3-5-sonnet" → match "claude-3-5-sonnet-*")
  for (const key of Object.keys(PRICING)) {
    if (model.includes(key) || key.includes(model)) return PRICING[key];
  }

  return DEFAULT_PRICING;
}

/**
 * Calculate cost for specific token counts and a model.
 */
function calculateModelCost(model: string, tokens: ModelTokenDetail): ModelCost {
  const pricing = getPricing(model);

  const inputCost = (tokens.inputTokens / 1_000_000) * pricing.inputPerM;
  const outputCost = (tokens.outputTokens / 1_000_000) * pricing.outputPerM;
  const cacheReadCost = (tokens.cacheReadTokens / 1_000_000) * pricing.cacheReadPerM;
  const cacheWriteCost = (tokens.cacheWriteTokens / 1_000_000) * pricing.cacheWritePerM;

  return {
    model,
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWriteCost,
    totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost,
    tokens,
  };
}

/**
 * Compute cost summary from a detailed model usage map.
 */
export function computeCostSummary(
  detailedModelUsage: Record<string, ModelTokenDetail>,
): CostSummary {
  const modelCosts: ModelCost[] = [];

  for (const [model, tokens] of Object.entries(detailedModelUsage)) {
    const cost = calculateModelCost(model, tokens);
    if (cost.totalCost > 0) {
      modelCosts.push(cost);
    }
  }

  // Sort by cost descending
  modelCosts.sort((a, b) => b.totalCost - a.totalCost);

  const totalCost = modelCosts.reduce((sum, mc) => sum + mc.totalCost, 0);

  return { totalCost, modelCosts };
}

/**
 * Format a USD cost value for display.
 */
export function formatCost(cost: number): string {
  if (cost >= 1000) return `$${(cost / 1000).toFixed(1)}K`;
  if (cost >= 100) return `$${cost.toFixed(0)}`;
  if (cost >= 10) return `$${cost.toFixed(1)}`;
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  if (cost >= 0.001) return `$${cost.toFixed(3)}`;
  if (cost === 0) return '$0.00';
  return `$${cost.toFixed(4)}`;
}

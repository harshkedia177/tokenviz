export interface DayData {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  sessions: number;
  messages: number;
  toolCalls: number;
  models: Record<string, number>;
}

export interface AdapterResult {
  tool: string;
  days: DayData[];
  hourCounts: Record<string, number>;
  totalSessions: number;
  totalMessages: number;
  firstSessionDate: string | null;
  modelUsage: Record<string, number>;
  avgSessionSeconds: number;
}

export interface Adapter {
  detect: () => boolean;
  load: (yearFilter: number | null) => Promise<AdapterResult | null>;
}

export interface AggregatedData {
  days: DayData[];
  sources: string[];
  hourCounts: Record<string, number>;
  totalSessions: number;
  totalMessages: number;
  firstSessionDate: string | null;
  modelUsage: Record<string, number>;
  avgSessionSeconds: number;
}

export interface Stats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  mostUsedModel: { name: string; tokens: number } | null;
  recentModel: { name: string; tokens: number } | null;
  currentStreak: number;
  longestStreak: number;
  totalSessions: number;
  totalMessages: number;
  peakHour: { hour: string; count: number } | null;
  busiestDay: string | null;
  dowCounts: number[];
  avgSessionMinutes: number;
}

export interface ToolCapabilities {
  hasAvgSession: boolean;
  hasPeakHour: boolean;
}

export interface ToolPanel {
  tool: string;
  data: AggregatedData;
  stats: Stats;
  capabilities: ToolCapabilities;
}

export interface Theme {
  bg: string;
  text: string;
  label: string;
  empty: string;
  scale: string[];
}

export interface DisplayStats {
  inputTotal: string;
  outputTotal: string;
  grandTotal: string;
  topModel: string;
  topModelTokens: number;
  recentModelName: string;
  recentModelTokens: number;
  longestStreak: number;
  currentStreak: number;
  peakHour: string;
  busiestDay: string;
  avgSession: string;
}

export interface GridCell {
  date: string;
  tokens: number;
}

export interface GridResult {
  grid: GridCell[][];
  weekMonths: number[];
  maxTokens: number;
  numWeeks: number;
}

export interface RenderOptions {
  theme?: string;
  user?: string;
  year?: number;
}

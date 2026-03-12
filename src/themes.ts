import type { Theme } from './types.js';

export const themes: Record<string, Theme> = {
  // Light themes
  green:  { bg: '#ffffff', text: '#24292f', label: '#57606a', empty: '#ebedf0', scale: ['#9be9a8', '#40c463', '#30a14e', '#216e39'] },
  purple: { bg: '#ffffff', text: '#24292f', label: '#57606a', empty: '#ebedf0', scale: ['#c4b5fd', '#8b5cf6', '#6d28d9', '#4c1d95'] },
  blue:   { bg: '#ffffff', text: '#24292f', label: '#57606a', empty: '#ebedf0', scale: ['#93c5fd', '#3b82f6', '#1d4ed8', '#1e3a8a'] },
  amber:  { bg: '#ffffff', text: '#24292f', label: '#57606a', empty: '#ebedf0', scale: ['#facf4e', '#e89700', '#c56600', '#924413'] },
  mono:   { bg: '#ffffff', text: '#24292f', label: '#57606a', empty: '#ebedf0', scale: ['#c6c6c6', '#8e8e8e', '#555555', '#1a1a1a'] },
  // Dark themes
  'dark-ember':  { bg: '#1a1a2e', text: '#e0e0e0', label: '#8b8b9e', empty: '#2a2a3e', scale: ['#5f2905', '#9d4000', '#dd6222', '#ff9845'] },
  'dark-green':  { bg: '#0d1117', text: '#c9d1d9', label: '#8b949e', empty: '#161b22', scale: ['#0b4323', '#067132', '#00a23f', '#38d255'] },
  'dark-purple': { bg: '#13111c', text: '#e0d4fd', label: '#8b7fae', empty: '#1e1a2e', scale: ['#3c1d7d', '#6730cc', '#8e66f1', '#b69eff'] },
  'dark-blue':   { bg: '#0d1117', text: '#c9d1d9', label: '#8b949e', empty: '#161b22', scale: ['#102e6a', '#1548bc', '#3678e6', '#69a6fb'] },
  'dark-mono':   { bg: '#111111', text: '#d4d4d4', label: '#8b8b8b', empty: '#1a1a1a', scale: ['#333333', '#555555', '#8e8e8e', '#c6c6c6'] },
};

export function getTheme(name: string): Theme {
  return themes[name] || themes['green'];
}

export function isDark(name: string): boolean {
  return (name || 'green').startsWith('dark-');
}

export function getAllThemeNames(): string[] {
  return Object.keys(themes);
}

export function getBgColor(name: string): string {
  return (themes[name] || themes['green']).bg;
}

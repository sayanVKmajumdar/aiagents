/** Shared design tokens — one place to change the look of the whole app. */

export const colors = {
  background: '#09090b',
  surface: '#141417',
  surfaceRaised: '#1c1c21',
  border: '#26262c',
  text: '#fafafa',
  textMuted: '#a1a1aa',
  textFaint: '#71717a',
  accent: '#ff0033',
  accentSoft: 'rgba(255, 0, 51, 0.14)',
  success: '#22c55e',
  warning: '#f59e0b',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
};

export const typography = {
  display: { fontSize: 64, fontWeight: '200', letterSpacing: -2 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  heading: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 15, fontWeight: '500' },
  caption: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
};

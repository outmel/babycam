import { useColorScheme } from 'react-native';
import type { Severity } from '@lulu/core';

const light = {
  background: '#F6EFE7',
  surface: '#FFFBF6',
  surfaceAlt: '#EFE5DA',
  border: '#E2D6C9',
  text: '#2B2622',
  textMuted: '#6F655D',
  accent: '#C8553D',
  accentText: '#FFFFFF',
  ok: '#4F7A57',
  warning: '#B7832A',
  alert: '#C0392B',
  info: '#5B7083',
  overlay: 'rgba(20, 17, 15, 0.55)',
};

const dark: typeof light = {
  background: '#14110F',
  surface: '#1F1B18',
  surfaceAlt: '#2A2521',
  border: '#3A332D',
  text: '#F3ECE4',
  textMuted: '#B3A89D',
  accent: '#E07A5F',
  accentText: '#14110F',
  ok: '#86B38E',
  warning: '#E2B05A',
  alert: '#EF6B5B',
  info: '#93A9BC',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

export type Palette = typeof light;

export function useTheme(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export function severityColor(p: Palette, s: Severity | string): string {
  return s === 'alert' ? p.alert : s === 'warning' ? p.warning : p.info;
}

export const Space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const Radius = { sm: 8, md: 14, lg: 22, pill: 999 } as const;

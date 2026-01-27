/**
 * Theme system with light/dark variants for each theme.
 *
 * Each theme has both a light and dark variant.
 * The mode (light/dark) is controlled separately from theme selection.
 */

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeColors {
  bg: string;
  surface: string;
  elevated: string;
  text: string;
  muted: string;
  accent: string;
  accentFg: string;  // Foreground color for text/icons on accent backgrounds
  border: string;
  dim: string;
}

export interface ThemeVariants {
  light: ThemeColors;
  dark: ThemeColors;
}

export interface Theme {
  id: string;
  name: string;
  variants: ThemeVariants;
}

// Helper to determine if colors represent a light or dark theme
export function isLightMode(colors: ThemeColors): boolean {
  // Parse the background color and check luminance
  const hex = colors.bg.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5;
}

// ============================================================================
// THEME DEFINITIONS
// Each theme has a light and dark variant with consistent accent/personality
// ============================================================================

/**
 * Cocoon - Warm pastels (our brand theme)
 * Matches cocoon.surf design language with mint/coral accents
 */
export const cocoonTheme: Theme = {
  id: 'cocoon',
  name: 'Cocoon',
  variants: {
    light: {
      bg: '#FDFCFB',
      surface: '#FFFFFF',
      elevated: '#F8F7F6',
      text: '#2D3436',
      muted: '#636E72',
      accent: '#A8E6CF',  // mint
      accentFg: '#2D3436',
      border: '#E8E8E8',
      dim: '#FAF9F8',
    },
    dark: {
      bg: '#141718',
      surface: '#1C1F21',
      elevated: '#252A2C',
      text: '#F5F7F7',
      muted: '#8A9396',
      accent: '#A8E6CF',  // mint
      accentFg: '#141718',
      border: '#2E3436',
      dim: '#0F1112',
    },
  },
};

/**
 * Rose - Soft pink/mauve tones
 */
export const roseTheme: Theme = {
  id: 'rose',
  name: 'Rose',
  variants: {
    light: {
      bg: '#FDF2F4',
      surface: '#FFFFFF',
      elevated: '#FCE7EB',
      text: '#4A2932',
      muted: '#9B7981',
      accent: '#BE185D',
      accentFg: '#FFFFFF',
      border: '#F5D0D6',
      dim: '#F9E4E8',
    },
    dark: {
      bg: '#1F1318',
      surface: '#2A1C22',
      elevated: '#3A2830',
      text: '#F5E6EA',
      muted: '#B89AA4',
      accent: '#F472B6',
      accentFg: '#1F1F1F',
      border: '#4A3640',
      dim: '#170E12',
    },
  },
};

/**
 * Violet - Rich purple/violet tones (formerly Dusk)
 */
export const violetTheme: Theme = {
  id: 'violet',
  name: 'Violet',
  variants: {
    light: {
      bg: '#F5F3F9',
      surface: '#FFFFFF',
      elevated: '#EDE8F5',
      text: '#2D2640',
      muted: '#7B7290',
      accent: '#7C3AED',
      accentFg: '#FFFFFF',
      border: '#DDD6EB',
      dim: '#E8E3F2',
    },
    dark: {
      bg: '#13111C',
      surface: '#1C1827',
      elevated: '#2A2438',
      text: '#EDE9F6',
      muted: '#9B8FB8',
      accent: '#A78BFA',
      accentFg: '#1F1F1F',
      border: '#3D3456',
      dim: '#0E0C14',
    },
  },
};

/**
 * Ocean - Deep blue, oceanic
 */
export const oceanTheme: Theme = {
  id: 'ocean',
  name: 'Ocean',
  variants: {
    light: {
      bg: '#F0F7FC',
      surface: '#FFFFFF',
      elevated: '#E1EFF8',
      text: '#1A3A52',
      muted: '#5D7C91',
      accent: '#0369A1',
      accentFg: '#FFFFFF',
      border: '#C7DEF0',
      dim: '#E8F2FA',
    },
    dark: {
      bg: '#0A1628',
      surface: '#0F2137',
      elevated: '#163354',
      text: '#E0ECF4',
      muted: '#7BA3C4',
      accent: '#38BDF8',
      accentFg: '#1F1F1F',
      border: '#1E4976',
      dim: '#071020',
    },
  },
};

/**
 * Teal - Cyan/teal tones
 */
export const tealTheme: Theme = {
  id: 'teal',
  name: 'Teal',
  variants: {
    light: {
      bg: '#F0FDFA',
      surface: '#FFFFFF',
      elevated: '#CCFBF1',
      text: '#134E4A',
      muted: '#5F9A96',
      accent: '#0D9488',
      accentFg: '#FFFFFF',
      border: '#B2EDE6',
      dim: '#E6FAF6',
    },
    dark: {
      bg: '#0D1F1D',
      surface: '#142928',
      elevated: '#1E3836',
      text: '#D4F0ED',
      muted: '#7CB8B2',
      accent: '#2DD4BF',
      accentFg: '#1F1F1F',
      border: '#2A4A47',
      dim: '#091514',
    },
  },
};

/**
 * Forest - Deep green, natural
 */
export const forestTheme: Theme = {
  id: 'forest',
  name: 'Forest',
  variants: {
    light: {
      bg: '#F2F7F4',
      surface: '#FFFFFF',
      elevated: '#E3EFE8',
      text: '#1A3328',
      muted: '#5C7A6A',
      accent: '#15803D',
      accentFg: '#FFFFFF',
      border: '#C5DED0',
      dim: '#E8F2EC',
    },
    dark: {
      bg: '#0D1210',
      surface: '#151D19',
      elevated: '#1E2A24',
      text: '#D3E3DB',
      muted: '#8A9E92',
      accent: '#4ADE80',
      accentFg: '#1F1F1F',
      border: '#263D32',
      dim: '#0A0F0C',
    },
  },
};

/**
 * Ember - Warm rust/terracotta
 */
export const emberTheme: Theme = {
  id: 'ember',
  name: 'Ember',
  variants: {
    light: {
      bg: '#FBF5F3',
      surface: '#FFFFFF',
      elevated: '#F7E9E4',
      text: '#4A2C20',
      muted: '#9A7568',
      accent: '#C2410C',
      accentFg: '#FFFFFF',
      border: '#EBDAD3',
      dim: '#F5E2DB',
    },
    dark: {
      bg: '#1A1412',
      surface: '#251D19',
      elevated: '#332822',
      text: '#F5EDE6',
      muted: '#A89585',
      accent: '#FB923C',
      accentFg: '#1F1F1F',
      border: '#3D322A',
      dim: '#140F0D',
    },
  },
};

/**
 * Crimson - True red tones
 */
export const crimsonTheme: Theme = {
  id: 'crimson',
  name: 'Crimson',
  variants: {
    light: {
      bg: '#FDF5F5',
      surface: '#FFFFFF',
      elevated: '#FCE8E8',
      text: '#4A1D1D',
      muted: '#9A6868',
      accent: '#B91C1C',
      accentFg: '#FFFFFF',
      border: '#F5CDCD',
      dim: '#FAE0E0',
    },
    dark: {
      bg: '#1A1111',
      surface: '#261818',
      elevated: '#362222',
      text: '#F5E8E8',
      muted: '#B89090',
      accent: '#F87171',
      accentFg: '#1F1F1F',
      border: '#4A2E2E',
      dim: '#140D0D',
    },
  },
};

/**
 * Gold - Warm yellow/gold tones
 */
export const goldTheme: Theme = {
  id: 'gold',
  name: 'Gold',
  variants: {
    light: {
      bg: '#FEFCF3',
      surface: '#FFFFFF',
      elevated: '#FDF6E3',
      text: '#4A4020',
      muted: '#8A8058',
      accent: '#B45309',
      accentFg: '#FFFFFF',
      border: '#EDE4C8',
      dim: '#FAF4E4',
    },
    dark: {
      bg: '#1A1810',
      surface: '#262316',
      elevated: '#33301E',
      text: '#F5F2E6',
      muted: '#B0A888',
      accent: '#FBBF24',
      accentFg: '#1F1F1F',
      border: '#3D3A28',
      dim: '#14120C',
    },
  },
};

/**
 * Stone - Neutral gray, modern
 */
export const stoneTheme: Theme = {
  id: 'stone',
  name: 'Stone',
  variants: {
    light: {
      bg: '#F5F5F5',
      surface: '#FFFFFF',
      elevated: '#EBEBEB',
      text: '#262626',
      muted: '#737373',
      accent: '#525252',
      accentFg: '#FFFFFF',
      border: '#D4D4D4',
      dim: '#EDEDED',
    },
    dark: {
      bg: '#141414',
      surface: '#1C1C1C',
      elevated: '#262626',
      text: '#F5F5F5',
      muted: '#A3A3A3',
      accent: '#A3A3A3',
      accentFg: '#1F1F1F',
      border: '#3D3D3D',
      dim: '#0D0D0D',
    },
  },
};

// ============================================================================
// PLATFORM THEMES (for auto-match mode)
// ============================================================================

export const twitterThemes = {
  'lights-out': {
    bg: '#000000',
    surface: '#16181C',
    elevated: '#202327',
    text: '#E7E9EA',
    muted: '#71767B',
    accent: '#1D9BF0',
    accentFg: '#FFFFFF',
    border: '#2F3336',
    dim: '#0F1114',
  } as ThemeColors,
  'dim': {
    bg: '#15202B',
    surface: '#192734',
    elevated: '#22303C',
    text: '#FFFFFF',
    muted: '#8B98A5',
    accent: '#1D9BF0',
    accentFg: '#FFFFFF',
    border: '#38444D',
    dim: '#141D26',
  } as ThemeColors,
  'default': {
    bg: '#FFFFFF',
    surface: '#F7F9F9',
    elevated: '#EFF3F4',
    text: '#0F1419',
    muted: '#536471',
    accent: '#1D9BF0',
    accentFg: '#FFFFFF',
    border: '#EFF3F4',
    dim: '#F7F9F9',
  } as ThemeColors,
};

// ============================================================================
// EXPORTS
// ============================================================================

export const themes: Theme[] = [
  cocoonTheme,
  roseTheme,
  violetTheme,
  oceanTheme,
  tealTheme,
  forestTheme,
  emberTheme,
  crimsonTheme,
  goldTheme,
  stoneTheme,
];

export const themesById: Record<string, Theme> = Object.fromEntries(
  themes.map(t => [t.id, t])
);

export function getTheme(id: string): Theme {
  return themesById[id] || cocoonTheme;
}

export function getThemeColors(themeId: string, mode: 'light' | 'dark'): ThemeColors {
  const theme = getTheme(themeId);
  return theme.variants[mode];
}

export function getTwitterTheme(variant: 'lights-out' | 'dim' | 'default'): ThemeColors {
  return twitterThemes[variant];
}

export type ChangeType = 'added' | 'improved' | 'fixed';

export type ChangelogEntry = {
  version: string;
  date: string;
  changes: {
    type: ChangeType;
    text: string;
  }[];
};

export const changelog: ChangelogEntry[] = [
  {
    version: '1.0.1',
    date: '2025-01-25',
    changes: [
      { type: 'added', text: 'Switch between For You and Following tabs' },
      { type: 'added', text: 'Fullscreen video playback' },
      { type: 'added', text: 'Compose button in sidebar' },
      { type: 'added', text: 'Setting to auto-unmute videos after you interact with one' },
      { type: 'improved', text: 'Reorganized settings into tabbed layout' },
      { type: 'improved', text: 'Choose where Cocoon replaces the feed (home, profile, search, tweet details)' },
      { type: 'improved', text: 'Control which engagement metrics show (likes, retweets, views)' },
      { type: 'improved', text: 'Better error messages with retry options' },
      { type: 'improved', text: 'Your own profile shows native Twitter' },
      { type: 'fixed', text: 'Video controls no longer trigger accidental navigation' },
    ],
  },
  {
    version: '1.0.0',
    date: '2025-01-16',
    changes: [
      { type: 'added', text: 'Export and import your settings for backup or device transfer' },
      { type: 'improved', text: 'Smoother update notifications in the popup' },
      { type: 'fixed', text: 'Various bug fixes and polish' },
    ],
  },
  {
    version: '0.1.0',
    date: '2025-01-08',
    changes: [
      { type: 'added', text: 'Initial release with Twitter/X feed filtering' },
      { type: 'added', text: 'LLM-powered content curation based on your interests' },
      { type: 'added', text: 'Customizable interest profiles and hard blocks' },
    ],
  },
];

/**
 * Get changelog entries newer than the given version.
 * Returns all entries if previousVersion is null/undefined.
 */
export function getChangesSince(previousVersion: string | null | undefined): ChangelogEntry[] {
  if (!previousVersion) return changelog;

  const prevParts = parseVersion(previousVersion);
  return changelog.filter(entry => {
    const entryParts = parseVersion(entry.version);
    return compareVersions(entryParts, prevParts) > 0;
  });
}

function parseVersion(v: string): number[] {
  return v.split('.').map(n => parseInt(n, 10) || 0);
}

function compareVersions(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

/**
 * Preset data for onboarding flow.
 * Users select from these during setup, with full customization available in Settings.
 *
 * Format: { label: "UI display text", prompt: "LLM-friendly description" }
 * - label: Short text shown in the onboarding UI
 * - prompt: Descriptive text saved to storage and used in LLM prompts
 */

export type PresetItem = { label: string; prompt: string };

export const PRESET_INTERESTS: PresetItem[] = [
  { label: 'AI & machine learning', prompt: 'AI research, machine learning, and technical discussions about artificial intelligence' },
  { label: 'Design', prompt: 'design systems, UI/UX, visual design, and creative design work' },
  { label: 'Productivity', prompt: 'productivity tips, tools, and personal effectiveness' },
  { label: 'Music production', prompt: 'music production, audio engineering, and music creation' },
  { label: 'Creative tools', prompt: 'creative software, tools for makers, and creative workflows' },
  { label: 'Indie makers', prompt: 'indie hackers, solo founders, and people building products' },
  { label: 'Startups', prompt: 'startup news, founder stories, and entrepreneurship' },
  { label: 'Writing', prompt: 'writing craft, storytelling, and content creation' },
  { label: 'Tech news', prompt: 'technology news and industry developments' },
  { label: 'Photography', prompt: 'photography techniques, gear, and visual storytelling' },
  { label: 'Fitness', prompt: 'fitness, exercise, health, and physical wellbeing' },
  { label: 'Gaming', prompt: 'video games, game development, and gaming culture' },
  { label: 'Cooking', prompt: 'cooking, recipes, and food culture' },
  { label: 'Travel', prompt: 'travel experiences, destinations, and adventure' },
  { label: 'Finance', prompt: 'personal finance, investing, and financial literacy' },
  { label: 'Science', prompt: 'scientific discoveries, research, and science communication' },
  { label: 'Art', prompt: 'art, artists, and creative expression' },
  { label: 'Books', prompt: 'books, reading recommendations, and literature' },
];

export const PRESET_BLOCKS: PresetItem[] = [
  { label: 'Porn', prompt: 'pornographic or sexually explicit content' },
  { label: 'Political outrage', prompt: 'political rage bait and inflammatory political content designed to trigger outrage' },
  { label: 'Celebrity gossip', prompt: 'celebrity drama, gossip, and parasocial influencer content' },
  { label: 'Clickbait', prompt: 'clickbait headlines and sensationalized content' },
  { label: 'Ads & promotions', prompt: 'advertisements, sponsored content, and promotional posts' },
  { label: 'Rage bait', prompt: 'content designed to make you angry or outraged' },
  { label: 'Viral drama', prompt: 'viral drama, cancel culture, and public shaming' },
  { label: 'Influencer content', prompt: 'influencer lifestyle content and parasocial engagement' },
  { label: 'Crypto hype', prompt: 'cryptocurrency hype, meme coins, and get-rich-quick schemes' },
  { label: 'Sensationalist news', prompt: 'sensationalized news and fear-mongering headlines' },
  { label: 'Culture wars', prompt: 'culture war content and divisive identity debates' },
  { label: 'Engagement farming', prompt: 'engagement farming posts designed to boost metrics' },
  { label: 'Doomer posts', prompt: 'doomer content and nihilistic despair posting' },
  { label: 'Outrage porn', prompt: 'content designed to trigger moral outrage and indignation' },
  { label: 'Memes & shitposts', prompt: 'low-effort memes, shitposts, and mindless content' },
  { label: 'Conspiracy theories', prompt: 'conspiracy theories and misinformation' },
];

// Default blocks to pre-select during onboarding (all except memes and conspiracy theories)
export const DEFAULT_BLOCK_LABELS = [
  'Porn',
  'Political outrage',
  'Celebrity gossip',
  'Clickbait',
  'Ads & promotions',
  'Rage bait',
  'Viral drama',
  'Influencer content',
  'Crypto hype',
  'Sensationalist news',
  'Culture wars',
  'Engagement farming',
  'Doomer posts',
  'Outrage porn',
];

/**
 * Builds LLM prompts for content filtering decisions.
 */

import type { BlockMetadata } from './segmenter';

export type UserProfile = {
  interests: string[];
  hardBlocks: string[];
  blockedKeywords?: string[];
};

/**
 * Build dynamic system prompt for feed curation.
 * User interests/blocks are injected instead of being hardcoded.
 * When searchQuery is provided, the prompt shifts to be more permissive about the search topic.
 */
function buildFeedSystemPrompt(userProfile: UserProfile, searchQuery?: string | null): string {
  const interestsList = userProfile.interests.length > 0
    ? userProfile.interests.map(i => `- ${i}`).join('\n')
    : '- (No specific interests configured)';

  const blocksList = userProfile.hardBlocks.length > 0
    ? userProfile.hardBlocks.map(b => `- ${b}`).join('\n')
    : '';

  if (searchQuery) {
    return `You curate search results. The user searched for: "${searchQuery}"

This is deliberate—treat "${searchQuery}" as a temporary interest. Allow content related to it even if outside their usual profile.

## Still HIDE
${blocksList}
- Spam, low-quality, or engagement-bait posts
- Content completely unrelated to "${searchQuery}"
- Ads, sponsored content, promotions

## User's Usual Interests (for context, not strict filtering)
${interestsList}

## Ambiguity Rule
Be permissive on topic (they asked for it), strict on quality.

## Response
Return comma-separated IDs to HIDE, or NONE.
Example: A,C,E`;
  }

  return `You curate social feeds. Keep posts matching user interests. Hide the rest.

## Ambiguity Rule
If unsure, HIDE it.

## User Interests (KEEP posts about these)
${interestsList}

## User Blocks (ALWAYS hide these)
${blocksList}
- Ads, sponsored content, promotions
- Empty or minimal content posts

## Response
Return comma-separated IDs to HIDE, or NONE.
Example: A,C,E`;
}

export function buildFeedPrompt(
  blocks: BlockMetadata[],
  url: string,
  userProfile: UserProfile,
  searchQuery?: string | null
): { system: string; user: string } {
  const feedBlocks = blocks.filter(b => b.isFeedItem);
  const otherBlocks = blocks.filter(b => !b.isFeedItem);

  const parts: string[] = [];
  parts.push("## FEED POSTS");
  parts.push(formatBlocks(feedBlocks));

  if (otherBlocks.length > 0) {
    parts.push("");
    parts.push("## OTHER CHROME (usually hide)");
    parts.push(formatBlocks(otherBlocks));
  }

  parts.push("");
  parts.push("---");
  parts.push("IDs to HIDE:");

  return {
    system: buildFeedSystemPrompt(userProfile, searchQuery),
    user: parts.join("\n"),
  };
}

function formatBlocks(blocks: BlockMetadata[], indent = ""): string {
  let result = "";

  for (const block of blocks) {
    // Mark feed items
    const feedMarker = block.isFeedItem ? "[FEED] " : "";

    let line = `${indent}${feedMarker}[${block.id}] ${block.tag}`;
    if (block.elementId) line += `#${block.elementId}`;
    if (block.classes.length > 0) line += `.${block.classes.join(".")}`;
    if (block.role) line += ` role="${block.role}"`;

    const metrics: string[] = [];
    if (block.linkCount > 0) metrics.push(`${block.linkCount}links`);
    if (block.linkDensity > 0.5) metrics.push("nav-like");
    if (block.images.length > 0) metrics.push(`${block.images.length}imgs`);
    if (metrics.length > 0) line += ` (${metrics.join(",")})`;

    result += line + "\n";

    if (block.title) {
      const title = block.title.substring(0, 140).replace(/\s+/g, " ");
      const more = block.title.length > 140 ? "..." : "";
      result += `${indent}  title: "${title}${more}"\n`;
    }

    const text = block.primaryText || block.text;
    if (text) {
      const limit = block.isFeedItem ? 400 : 200;
      const preview = text.substring(0, limit).replace(/\s+/g, " ");
      const more = text.length > limit ? "..." : "";
      result += `${indent}  text: "${preview}${more}"\n`;
    }

    if (block.children.length > 0) {
      result += formatBlocks(block.children, indent + "  ");
    }
  }

  return result;
}

export function parseFilterResponse(response: string): string[] {
  if (!response) return [];

  const cleaned = response.trim().toUpperCase();
  if (cleaned === "NONE" || cleaned === "NONE.") return [];

  let idString = response;

  const filterMatch = response.match(/(?:FILTER|REMOVE|HIDE):\s*(.+)/i);
  if (filterMatch) idString = filterMatch[1];

  const ids = idString
    .split(",")
    .map(part => part.trim())
    .filter(id => /^[A-Za-z0-9]+$/.test(id));

  return ids;
}

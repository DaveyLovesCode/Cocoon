/**
 * Centralized defaults for user profile.
 * Wellness-focused fallbacks when user hasn't configured preferences.
 */

import type { UserProfile } from './prompt';

export const WELLNESS_DEFAULTS: UserProfile = {
  interests: [
    'learning and personal growth',
    'creative projects and making things',
    'meaningful conversations and connections',
    'health and wellbeing',
  ],
  hardBlocks: [
    'rage bait and outrage content',
    'content designed to make you feel inadequate',
    'endless scrolling triggers and engagement traps',
    'fear-mongering and catastrophizing',
    'parasocial celebrity/influencer drama',
    'ads and sponsored content',
    'pornographic content',
  ],
};

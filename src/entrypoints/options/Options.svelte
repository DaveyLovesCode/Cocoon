<script lang="ts">
  import { Palette, Rss, Settings, Database, HelpCircle } from '@lucide/svelte';
  import {
    getThemeSetting,
    getThemeMode,
    getAutoMatchFeedTheme,
    getResolvedColors,
    applyTheme,
    type ThemeMode,
  } from '../../lib/theme';
  import type { EnabledFeedContexts, ShowMetrics, QuotaSettings } from '../../lib/settings';
  import Logo from '../../lib/components/Logo.svelte';
  import { decryptApiKey, maskApiKey } from '../../lib/crypto';

  import GeneralSection from './sections/GeneralSection.svelte';
  import AppearanceSection from './sections/AppearanceSection.svelte';
  import FeedsSection from './sections/FeedsSection.svelte';
  import DataSection from './sections/DataSection.svelte';
  import SupportSection from './sections/SupportSection.svelte';

  type SettingsSection = 'general' | 'appearance' | 'feeds' | 'data' | 'support';

  const sections: { id: SettingsSection; label: string; icon: typeof Palette }[] = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'feeds', label: 'Feeds', icon: Rss },
    { id: 'data', label: 'Data', icon: Database },
    { id: 'support', label: 'Support', icon: HelpCircle },
  ];

  let activeSection = $state<SettingsSection>('general');
  let statusVisible = $state(false);
  let ready = $state(false);

  // Settings state
  let currentTheme = $state('cocoon');
  let currentMode = $state<ThemeMode>('system');
  let autoMatchFeed = $state(true);
  let interests = $state('');
  let hardBlocks = $state('');
  let blockedKeywords = $state<string[]>([]);
  let apiKeySet = $state(false);
  let apiKeyEncrypted = $state(false);
  let maskedKey = $state('');

  // Feed settings (v2)
  let enabledFeedContexts = $state<EnabledFeedContexts>({ home: true, profile: true, search: true, status: true });
  let showMetrics = $state<ShowMetrics>({ likes: true, retweets: true, views: false });
  let alwaysExpandTweets = $state(false);
  let autoUnmuteAfterInteraction = $state(false);
  // Feed settings (v3 - quota)
  let quotaSettings = $state<QuotaSettings>({ enabled: false, limit: 50, period: 'day' });

  let systemPrefersDark = $state(window.matchMedia('(prefers-color-scheme: dark)').matches);

  let effectiveMode = $derived<'light' | 'dark'>(
    currentMode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : currentMode
  );

  $effect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => { systemPrefersDark = e.matches; };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  });

  $effect(() => {
    loadSettings();
  });

  $effect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    const section = params.get('section');
    const highlight = params.get('highlight');

    if (section && sections.some(s => s.id === section)) {
      activeSection = section as SettingsSection;
    } else if (highlight === 'api') {
      activeSection = 'general';
    }
  });

  function showSaved() {
    statusVisible = true;
    setTimeout(() => statusVisible = false, 2000);
  }

  async function loadSettings() {
    const settings = await browser.storage.sync.get([
      'apiKey',
      'userProfile',
      'enabledFeedContexts',
      'showMetrics',
      'alwaysExpandTweets',
      'autoUnmuteAfterInteraction',
      'quotaSettings',
      'disableProfileFeed', // Legacy key for migration
    ]) as {
      apiKey?: string;
      userProfile?: { interests?: string[]; hardBlocks?: string[]; blockedKeywords?: string[] };
      enabledFeedContexts?: EnabledFeedContexts;
      showMetrics?: ShowMetrics;
      alwaysExpandTweets?: boolean;
      autoUnmuteAfterInteraction?: boolean;
      quotaSettings?: QuotaSettings;
      disableProfileFeed?: boolean;
    };
    const userProfile = settings.userProfile || { interests: [], hardBlocks: [] };

    const encryptedKey = settings.apiKey || '';
    const decryptedKey = encryptedKey ? await decryptApiKey(encryptedKey) : '';
    apiKeySet = !!encryptedKey;
    apiKeyEncrypted = !!encryptedKey && !!decryptedKey;
    maskedKey = maskApiKey(decryptedKey);

    interests = (Array.isArray(userProfile.interests) ? userProfile.interests : []).join('\n');
    hardBlocks = (Array.isArray(userProfile.hardBlocks) ? userProfile.hardBlocks : []).join('\n');
    blockedKeywords = Array.isArray(userProfile.blockedKeywords) ? userProfile.blockedKeywords : [];

    currentTheme = await getThemeSetting();
    currentMode = await getThemeMode();
    autoMatchFeed = await getAutoMatchFeedTheme();

    // Load feed settings with migration from legacy disableProfileFeed
    if (settings.enabledFeedContexts) {
      enabledFeedContexts = settings.enabledFeedContexts;
    } else if (settings.disableProfileFeed) {
      enabledFeedContexts = { home: true, profile: false, search: true, status: true };
    }

    showMetrics = settings.showMetrics || { likes: true, retweets: true, views: false };
    alwaysExpandTweets = settings.alwaysExpandTweets || false;
    autoUnmuteAfterInteraction = settings.autoUnmuteAfterInteraction || false;
    quotaSettings = settings.quotaSettings || { enabled: false, limit: 50, period: 'day' };

    applyCurrentTheme();
    ready = true;
  }

  function applyCurrentTheme() {
    const colors = getResolvedColors(currentTheme, currentMode);
    applyTheme(colors);
  }
</script>

<div class="min-h-screen bg-cocoon-bg text-cocoon-text font-sans flex">
  {#if !ready}
    <div class="flex-1 flex items-center justify-center py-20">
      <div class="text-cocoon-muted text-sm">Loading...</div>
    </div>
  {:else}
  <!-- Sidebar -->
  <aside class="w-56 min-h-screen border-r border-cocoon-border bg-cocoon-surface flex flex-col">
    <div class="p-4 border-b border-cocoon-border">
      <div class="flex items-center gap-2.5">
        <Logo size={24} mouthProgress={1} color="#A8E6CF" />
        <h1 class="text-base font-semibold">Settings</h1>
      </div>
    </div>
    <nav class="flex-1 p-2">
      {#each sections as section}
        <button
          type="button"
          onclick={() => activeSection = section.id}
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors {activeSection === section.id ? 'bg-cocoon-elevated text-cocoon-text' : 'text-cocoon-muted hover:text-cocoon-text hover:bg-cocoon-dim'}"
        >
          <section.icon size={18} />
          <span>{section.label}</span>
        </button>
      {/each}
    </nav>
    {#if statusVisible}
      <div class="p-4 border-t border-cocoon-border">
        <span class="text-sm text-green-500">Saved</span>
      </div>
    {/if}
  </aside>

  <!-- Main content -->
  <main class="flex-1 p-8 overflow-y-auto flex justify-center">
    <div class="w-full max-w-xl">
      {#if activeSection === 'general'}
        <GeneralSection
          bind:interests
          bind:hardBlocks
          bind:blockedKeywords
          bind:apiKeySet
          bind:apiKeyEncrypted
          {maskedKey}
          onsaved={showSaved}
        />
      {/if}

      {#if activeSection === 'appearance'}
        <AppearanceSection
          bind:currentTheme
          bind:currentMode
          bind:autoMatchFeed
          {effectiveMode}
          onsaved={showSaved}
        />
      {/if}

      {#if activeSection === 'feeds'}
        <FeedsSection
          bind:enabledFeedContexts
          bind:showMetrics
          bind:alwaysExpandTweets
          bind:autoUnmuteAfterInteraction
          bind:quotaSettings
          onsaved={showSaved}
        />
      {/if}

      {#if activeSection === 'data'}
        <DataSection
          onsaved={showSaved}
          onreload={loadSettings}
        />
      {/if}

      {#if activeSection === 'support'}
        <SupportSection />
      {/if}
    </div>
  </main>
  {/if}
</div>

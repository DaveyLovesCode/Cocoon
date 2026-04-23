<script lang="ts">
  import { onMount } from 'svelte';
  import { Power, Settings, Copy, Check, Download } from '@lucide/svelte';
  import { initializeTheme } from '../../lib/theme';
  import { formatNumber } from '../../lib/utils/text';
  import { createLogger } from '../../lib/logger';
  import Logo from '../../lib/components/Logo.svelte';
  import { isProfileUrl } from '../../lib/sites';

  const log = createLogger('Popup');

  type StatsData = {
    allTime: { pagesProcessed: number; elementsHidden: number; postsKept: number; postsHidden: number };
    byDomain: Record<string, { pagesProcessed: number; elementsHidden: number; postsKept: number; postsHidden: number }>;
  };

  // Supported feed site hosts (Twitter-only launch)
  const SUPPORTED_HOSTS = ['twitter.com', 'x.com'];

  // Tooltip action: positions above or below based on available space
  function smartTooltip(node: HTMLElement) {
    const tooltip = node.querySelector('[data-tooltip]') as HTMLElement;
    if (!tooltip) return;

    tooltip.classList.remove('bottom-full', 'mb-1.5', 'top-full', 'mt-1.5');

    function updatePosition() {
      const rect = node.getBoundingClientRect();
      const originalOpacity = tooltip.style.opacity;
      tooltip.style.opacity = '0';
      tooltip.style.display = 'block';
      const tooltipHeight = tooltip.offsetHeight + 8;
      tooltip.style.display = '';
      tooltip.style.opacity = originalOpacity;

      if (rect.top < tooltipHeight) {
        tooltip.classList.remove('bottom-full', 'mb-1.5');
        tooltip.classList.add('top-full', 'mt-1.5');
      } else {
        tooltip.classList.remove('top-full', 'mt-1.5');
        tooltip.classList.add('bottom-full', 'mb-1.5');
      }
    }

    updatePosition();
    node.addEventListener('mouseenter', updatePosition);
    return {
      destroy() {
        node.removeEventListener('mouseenter', updatePosition);
      }
    };
  }

  let whitelist = $state<string[]>([]);
  let currentDomain = $state('');
  let currentUrl = $state('');
  let disableProfileFeed = $state(false);
  let statsScope = $state<'site' | 'all'>('all'); // Add toggle UI when supporting multiple sites
  let stats = $state<StatsData | null>(null);
  let debugCopied = $state(false);
  let updateNotice = $state<{ version: string; from: string } | null>(null);

  // Tweet collector state (dev only)
  let collectedTweetCount = $state(0);

  // Check if current site is supported
  let isSupported = $derived(() => {
    if (!currentDomain) return false;
    const host = currentDomain.replace(/^www\./, '');
    return SUPPORTED_HOSTS.some(h => host === h || host.endsWith('.' + h));
  });

  // Check if current site is whitelisted (filtering disabled)
  let isWhitelisted = $derived(
    whitelist.some(d => currentDomain === d || currentDomain.endsWith('.' + d))
  );

  // Check if on a profile page with profiles disabled
  let isProfileDisabled = $derived(
    isSupported() && disableProfileFeed && isProfileUrl(currentUrl)
  );

  // Filtering is active if site is supported and not whitelisted (and not profile-disabled)
  let isFiltering = $derived(isSupported() && !isWhitelisted && !isProfileDisabled);

  // Logo animation state - smooth transitions
  let logoMouthProgress = $state(1);
  let logoColor = $state('#A8E6CF');
  let animationFrame: number | null = null;

  // Target values based on filtering state
  let targetMouth = $derived(!isSupported() || isFiltering ? 1 : 0);
  let targetColor = $derived(!isSupported() || isFiltering
    ? { r: 168, g: 230, b: 207 }  // mint
    : { r: 255, g: 159, b: 142 }  // coral
  );

  // Smooth animation loop for logo
  function animateLogo() {
    // Smooth interpolation for mouth
    const mouthDiff = targetMouth - logoMouthProgress;
    if (Math.abs(mouthDiff) > 0.001) {
      logoMouthProgress += mouthDiff * 0.15;
    } else {
      logoMouthProgress = targetMouth;
    }

    // Smooth color transition
    const currentRGB = {
      r: parseInt(logoColor.slice(1, 3), 16),
      g: parseInt(logoColor.slice(3, 5), 16),
      b: parseInt(logoColor.slice(5, 7), 16)
    };

    const r = Math.round(currentRGB.r + (targetColor.r - currentRGB.r) * 0.15);
    const g = Math.round(currentRGB.g + (targetColor.g - currentRGB.g) * 0.15);
    const b = Math.round(currentRGB.b + (targetColor.b - currentRGB.b) * 0.15);

    logoColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

    animationFrame = requestAnimationFrame(animateLogo);
  }

  onMount(() => {
    animateLogo();

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
    };
  });

  let currentStats = $derived(() => {
    const empty = { pagesProcessed: 0, elementsHidden: 0, postsKept: 0, postsHidden: 0 };
    if (!stats) return empty;
    if (statsScope === 'all') {
      // Handle migration from old stats without postsKept/postsHidden
      return {
        ...empty,
        ...stats.allTime,
      };
    }
    return {
      ...empty,
      ...(stats.byDomain?.[currentDomain] || {}),
    };
  });

  // Calculate keep rate as percentage
  let keepRate = $derived(() => {
    const s = currentStats();
    const total = s.postsKept + s.postsHidden;
    if (total === 0) return 0;
    return Math.round((s.postsKept / total) * 100);
  });

  // Estimate time saved (~4 seconds per hidden post)
  const SECONDS_PER_POST = 4;
  let timeSaved = $derived(() => {
    const seconds = currentStats().postsHidden * SECONDS_PER_POST;
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    const hours = seconds / 3600;
    return hours < 10 ? `${hours.toFixed(1)}h` : `${Math.round(hours)}h`;
  });

  $effect(() => {
    loadState();
  });

  async function loadState() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      try {
        currentUrl = tab.url;
        currentDomain = new URL(tab.url).hostname;
      } catch {
        currentUrl = '';
        currentDomain = '';
      }
    }

    const settings = await browser.storage.sync.get(['whitelist', 'disableProfileFeed']) as { whitelist?: string[]; disableProfileFeed?: boolean };
    whitelist = Array.isArray(settings.whitelist) ? settings.whitelist : [];
    disableProfileFeed = !!settings.disableProfileFeed;

    const stored = await browser.storage.local.get(['stats', 'pendingUpdateNotice']) as { stats?: StatsData; pendingUpdateNotice?: { version: string; from: string } };
    stats = stored.stats || null;

    // Check for pending update notice
    if (stored.pendingUpdateNotice?.version) {
      updateNotice = stored.pendingUpdateNotice;
    }

    // Load collected tweet count (dev only)
    if (import.meta.env.MODE === 'development') {
      const tweetData = await browser.storage.local.get(['collectedTweets']) as { collectedTweets?: unknown[] };
      collectedTweetCount = Array.isArray(tweetData.collectedTweets) ? tweetData.collectedTweets.length : 0;
    }

    await initializeTheme();
  }

  async function toggleSiteFiltering() {
    if (!isSupported()) return;

    if (isWhitelisted) {
      const current = $state.snapshot(whitelist);
      const updated = current.filter(d => d !== currentDomain);
      await browser.storage.sync.set({ whitelist: updated });
      whitelist = updated;
    } else {
      const current = $state.snapshot(whitelist);
      const updated = [...current, currentDomain];
      await browser.storage.sync.set({ whitelist: updated });
      whitelist = updated;
    }

    // Refresh the page to apply the change
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      browser.tabs.reload(tab.id);
    }
  }

  function openSettings() {
    browser.tabs.create({ url: browser.runtime.getURL('/options.html') });
  }

  async function copyDebugData() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      const response = await browser.tabs.sendMessage(tab.id, { type: 'DEBUG_CAPTURE' }) as { data?: string } | undefined;
      if (response?.data) {
        await navigator.clipboard.writeText(response.data);
        debugCopied = true;
        setTimeout(() => debugCopied = false, 2000);
      }
    } catch (e) {
      log.error('Debug capture failed', e);
    }
  }

  async function pickElement() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      await browser.tabs.sendMessage(tab.id, { type: 'DEBUG_PICK_ELEMENT' });
      window.close();
    } catch (e) {
      log.error('Pick element failed', e);
    }
  }

  async function startCollector() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      await browser.tabs.sendMessage(tab.id, { type: 'COLLECT_TWEET_START' });
      window.close();
    } catch (e) {
      log.error('Start collector failed', e);
    }
  }

  async function downloadCollectedTweets() {
    try {
      const stored = await browser.storage.local.get(['collectedTweets']) as { collectedTweets?: unknown[] };
      const tweets = stored.collectedTweets || [];

      const json = JSON.stringify(tweets, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `collected-tweets-${Date.now()}.json`;
      a.click();

      URL.revokeObjectURL(url);

      // Clear after download
      await browser.storage.local.remove('collectedTweets');
      collectedTweetCount = 0;
    } catch (e) {
      log.error('Download failed', e);
    }
  }

  async function clearCollectedTweets() {
    await browser.storage.local.remove('collectedTweets');
    collectedTweetCount = 0;
  }

  async function dismissUpdate() {
    updateNotice = null;
    await browser.storage.local.remove('pendingUpdateNotice');
  }

  function openChangelog() {
    if (updateNotice) {
      browser.tabs.create({ url: browser.runtime.getURL(`/whatsnew.html?from=${updateNotice.from}`) });
      dismissUpdate();
    }
  }
</script>

<div class="w-80 bg-cocoon-bg text-cocoon-text p-4 font-sans relative">
  <!-- Header -->
  <div class="flex items-center justify-between mb-4">
    <div class="flex items-center gap-2">
      <Logo size={20} mouthProgress={logoMouthProgress} color={logoColor} />
      <span class="text-[15px] font-semibold">Cocoon</span>
    </div>
    <button onclick={openSettings} class="p-1.5 rounded-lg text-cocoon-muted hover:text-cocoon-text hover:bg-cocoon-surface transition-colors" aria-label="Settings">
      <Settings size={18} />
    </button>
  </div>

  <!-- Site Control -->
  <div class="mb-4">
    <div class="w-full bg-cocoon-surface rounded-xl p-3 border border-cocoon-border">
      <div class="flex items-center justify-between">
        <!-- Power button -->
        <button
          onclick={toggleSiteFiltering}
          disabled={!isSupported() || isProfileDisabled}
          class="p-1.5 rounded-lg transition-colors {isFiltering ? 'bg-cocoon-accent text-cocoon-accent-fg' : 'bg-cocoon-elevated text-cocoon-muted'} {isSupported() && !isProfileDisabled ? 'hover:opacity-80' : 'opacity-40 cursor-default'}"
          aria-label="Toggle filtering"
        >
          <Power size={18} strokeWidth={2.5} />
        </button>

        <!-- Domain and status (centered) -->
        <div class="text-center">
          <div class="text-sm font-medium truncate {isSupported() ? 'text-cocoon-text' : 'text-cocoon-muted'}">
            {currentDomain || 'No site detected'}
          </div>
          <div class="text-xs {isFiltering ? 'text-cocoon-accent' : 'text-cocoon-muted'}">
            {#if !currentDomain}
              —
            {:else if !isSupported()}
              Not supported
            {:else if isProfileDisabled}
              Profile filtering off
            {:else if isFiltering}
              Filtering
            {:else}
              Paused
            {/if}
          </div>
        </div>

        <!-- Help icon -->
        <div class="group relative" use:smartTooltip>
          <span class="flex items-center justify-center w-6 h-6 rounded-full text-cocoon-muted text-xs cursor-help {isSupported() ? 'hover:bg-cocoon-elevated' : 'opacity-40'}">?</span>
          <div data-tooltip class="absolute bottom-full right-0 mb-1.5 px-2.5 py-1.5 bg-cocoon-surface border border-cocoon-border rounded-lg text-[11px] text-cocoon-muted w-48 shadow-[0_4px_16px_rgba(0,0,0,0.5)] opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity duration-150 z-10">
            {#if !isSupported()}
              Cocoon doesn't support this site yet. Currently only Twitter/X is supported.
            {:else if isProfileDisabled}
              Profile filtering is disabled in settings. The original profile is shown.
            {:else if isFiltering}
              Click the power button to pause filtering on this site. Your feed will show unfiltered content.
            {:else}
              Filtering is paused. Click the power button to resume filtering your feed.
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Stats -->
  <div>
    <div class="flex items-center justify-between mb-2">
      <span class="text-[11px] font-medium text-cocoon-muted uppercase tracking-wide">Stats</span>
      <div class="group relative" use:smartTooltip>
        <span class="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-cocoon-surface text-cocoon-muted text-[10px] cursor-help border border-cocoon-border">?</span>
        <div data-tooltip class="absolute bottom-full right-0 mb-1.5 px-2.5 py-1.5 bg-cocoon-surface border border-cocoon-border rounded-lg text-[11px] text-cocoon-muted w-48 shadow-[0_4px_16px_rgba(0,0,0,0.5)] opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity duration-150 z-10">
          Posts curated based on your interests. Time saved assumes ~4 seconds per filtered post.
        </div>
      </div>
    </div>

    <!-- Shown vs Hidden contrast -->
    <div class="grid grid-cols-2 gap-2 mb-3">
      <div class="bg-cocoon-surface rounded-xl p-3 text-center border border-cocoon-border">
        <div class="text-xl font-semibold text-cocoon-text">{formatNumber(currentStats().postsKept)}</div>
        <div class="text-[10px] text-cocoon-muted uppercase tracking-wide">Shown</div>
      </div>
      <div class="bg-cocoon-surface rounded-xl p-3 text-center border border-cocoon-border">
        <div class="text-xl font-semibold text-cocoon-text">{formatNumber(currentStats().postsHidden)}</div>
        <div class="text-[10px] text-cocoon-muted uppercase tracking-wide">Hidden</div>
      </div>
    </div>

    <!-- Visual ratio bar -->
    {#if currentStats().postsKept + currentStats().postsHidden > 0}
      <div class="h-1.5 rounded-full overflow-hidden flex mb-3 bg-cocoon-elevated">
        <div
          class="bg-cocoon-accent transition-all duration-300"
          style="width: {keepRate()}%"
        ></div>
        <div
          class="bg-cocoon-muted/40 transition-all duration-300"
          style="width: {100 - keepRate()}%"
        ></div>
      </div>
    {/if}

    <!-- Keep rate and time saved -->
    <div class="flex items-center justify-center gap-4 text-[11px]">
      <div class="flex items-center gap-1.5">
        <span class="text-cocoon-muted">Keep rate</span>
        <span class="font-medium text-cocoon-text">{keepRate()}%</span>
      </div>
      <span class="text-cocoon-border">|</span>
      <div class="flex items-center gap-1.5">
        <span class="text-cocoon-muted">Time saved</span>
        <span class="font-medium text-cocoon-text">~{timeSaved()}</span>
      </div>
    </div>
  </div>

  <!-- Debug (dev only) -->
  {#if import.meta.env.MODE === 'development'}
  <div class="mt-4 bg-cocoon-surface rounded-xl p-3 border border-cocoon-border border-dashed">
    <div class="text-[10px] font-medium text-cocoon-muted uppercase tracking-wide mb-3">Debug</div>

    <div class="space-y-2">
      <!-- Inspect tools -->
      <div class="flex gap-2">
        <button
          onclick={copyDebugData}
          class="flex-1 flex items-center justify-center gap-1.5 h-8 bg-cocoon-elevated text-cocoon-muted rounded-lg text-[11px] hover:text-cocoon-text transition-colors"
        >
          {#if debugCopied}
            <Check size={14} />
            <span>Copied</span>
          {:else}
            <Copy size={14} />
            <span>Copy DOM</span>
          {/if}
        </button>
        <button
          onclick={pickElement}
          class="flex-1 flex items-center justify-center gap-1.5 h-8 bg-cocoon-elevated text-cocoon-muted rounded-lg text-[11px] hover:text-cocoon-text transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="6"/>
            <line x1="12" y1="2" x2="12" y2="6"/>
            <line x1="12" y1="18" x2="12" y2="22"/>
            <line x1="2" y1="12" x2="6" y2="12"/>
            <line x1="18" y1="12" x2="22" y2="12"/>
          </svg>
          <span>Pick</span>
        </button>
      </div>

      <!-- Tweet collector -->
      <div class="flex gap-2">
        <button
          onclick={startCollector}
          class="flex-1 flex items-center justify-center gap-1.5 h-8 bg-cocoon-elevated text-cocoon-muted rounded-lg text-[11px] hover:text-cocoon-text transition-colors"
        >
          <span>Collect Tweets</span>
        </button>
        <button
          onclick={downloadCollectedTweets}
          disabled={collectedTweetCount === 0}
          class="flex-1 flex items-center justify-center gap-1.5 h-8 bg-cocoon-elevated text-cocoon-muted rounded-lg text-[11px] hover:text-cocoon-text transition-colors disabled:opacity-50"
        >
          <Download size={14} />
          <span>Download ({collectedTweetCount})</span>
        </button>
      </div>

      <!-- Clear button -->
      {#if collectedTweetCount > 0}
        <div class="flex items-center justify-end text-[10px] text-cocoon-muted">
          <button onclick={clearCollectedTweets} class="hover:text-cocoon-text">Clear</button>
        </div>
      {/if}
    </div>
  </div>
  {/if}

  <!-- Floating update toast -->
  {#if updateNotice}
    <div class="absolute bottom-3 left-3 right-3 px-3 py-2.5 bg-cocoon-surface rounded-xl text-xs flex items-center justify-between shadow-lg">
      <div class="flex items-center gap-2">
        <span class="text-cocoon-text">Updated to <span class="font-medium text-cocoon-accent">v{updateNotice.version}</span></span>
        <button onclick={openChangelog} class="text-cocoon-accent hover:underline">
          See what's new
        </button>
      </div>
      <button onclick={dismissUpdate} class="p-1 text-cocoon-muted hover:text-cocoon-text" aria-label="Dismiss">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  {/if}
</div>

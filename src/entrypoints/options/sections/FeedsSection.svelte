<script lang="ts">
  import { Rss } from '@lucide/svelte';
  import XLogo from '../../../lib/icons/XLogo.svelte';
  import type { EnabledFeedContexts, ShowMetrics, QuotaSettings } from '../../../lib/settings';
  import { getTodayViewCount, formatTimeRemaining, getPeriodLabel } from '../../../lib/quota';

  interface Props {
    enabledFeedContexts: EnabledFeedContexts;
    showMetrics: ShowMetrics;
    alwaysExpandTweets: boolean;
    autoUnmuteAfterInteraction: boolean;
    quotaSettings: QuotaSettings;
    onsaved: () => void;
  }

  let {
    enabledFeedContexts = $bindable(),
    showMetrics = $bindable(),
    alwaysExpandTweets = $bindable(),
    autoUnmuteAfterInteraction = $bindable(),
    quotaSettings = $bindable(),
    onsaved,
  }: Props = $props();

  let todayViewCount = $state(0);

  // Load today's view count on mount and listen for changes
  $effect(() => {
    getTodayViewCount().then(count => {
      todayViewCount = count;
    });

    // Listen for storage changes to update reactively
    const listener = (changes: { [key: string]: browser.Storage.StorageChange }) => {
      if (changes.quotaUsage) {
        getTodayViewCount().then(count => {
          todayViewCount = count;
        });
      }
    };

    browser.storage.local.onChanged.addListener(listener);
    return () => browser.storage.local.onChanged.removeListener(listener);
  });

  // Calculate reset time
  let resetsAt = $derived(() => {
    const now = new Date();
    if (quotaSettings.period === 'day') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    }
    if (quotaSettings.period === 'week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1) + 7;
      return new Date(now.getFullYear(), now.getMonth(), diff);
    }
    return new Date(now.getFullYear(), now.getMonth() + 1, 1);
  });

  let timeRemaining = $derived(formatTimeRemaining(resetsAt()));
  let periodLabel = $derived(getPeriodLabel(quotaSettings.period));

  // Current period view count (recalculated based on period setting)
  let currentPeriodCount = $derived(() => {
    // For simplicity, we show today's count in the UI
    // The actual quota system handles period-specific counting
    return todayViewCount;
  });

  async function updateFeedContext(key: keyof EnabledFeedContexts) {
    enabledFeedContexts = { ...enabledFeedContexts, [key]: !enabledFeedContexts[key] };
    await browser.storage.sync.set({ enabledFeedContexts });
    onsaved();
  }

  async function updateShowMetric(key: keyof ShowMetrics) {
    showMetrics = { ...showMetrics, [key]: !showMetrics[key] };
    await browser.storage.sync.set({ showMetrics });
    onsaved();
  }

  async function toggleAlwaysExpand() {
    alwaysExpandTweets = !alwaysExpandTweets;
    await browser.storage.sync.set({ alwaysExpandTweets });
    onsaved();
  }

  async function toggleAutoUnmute() {
    autoUnmuteAfterInteraction = !autoUnmuteAfterInteraction;
    await browser.storage.sync.set({ autoUnmuteAfterInteraction });
    onsaved();
  }

  async function toggleQuotaEnabled() {
    quotaSettings = { ...quotaSettings, enabled: !quotaSettings.enabled };
    await browser.storage.sync.set({ quotaSettings });
    onsaved();
  }

  async function updateQuotaLimit(e: Event) {
    const value = parseInt((e.target as HTMLInputElement).value, 10);
    if (!isNaN(value) && value > 0) {
      quotaSettings = { ...quotaSettings, limit: value };
      await browser.storage.sync.set({ quotaSettings });
      onsaved();
    }
  }

  async function updateQuotaPeriod(e: Event) {
    const value = (e.target as HTMLSelectElement).value as 'day' | 'week' | 'month';
    quotaSettings = { ...quotaSettings, period: value };
    await browser.storage.sync.set({ quotaSettings });
    onsaved();
  }

  const feedContextOptions: { key: keyof EnabledFeedContexts; label: string; icon: string }[] = [
    { key: 'home', label: 'Home feed', icon: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z' },
    { key: 'profile', label: 'Profiles', icon: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z' },
    { key: 'search', label: 'Search', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
    { key: 'status', label: 'Tweet details', icon: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z' },
  ];

  const metricOptions: { key: keyof ShowMetrics; label: string; icon: string }[] = [
    { key: 'likes', label: 'Likes', icon: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z' },
    { key: 'retweets', label: 'Retweets', icon: 'M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3' },
    { key: 'views', label: 'Views', icon: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 100 6 3 3 0 000-6z' },
  ];
</script>

<style>
  /* Custom checkbox with animated checkmark */
  .cocoon-check {
    appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 6px;
    border: 2px solid var(--cocoon-border);
    background: var(--cocoon-bg);
    cursor: pointer;
    position: relative;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    flex-shrink: 0;
    outline: none;
  }

  .cocoon-check:hover {
    border-color: var(--cocoon-muted);
    background: var(--cocoon-dim);
  }

  .cocoon-check:focus-visible {
    border-color: var(--cocoon-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--cocoon-accent) 20%, transparent);
  }

  .cocoon-check:checked {
    background: var(--cocoon-accent);
    border-color: var(--cocoon-accent);
  }

  .cocoon-check:checked::after {
    content: '';
    position: absolute;
    left: 5px;
    top: 2px;
    width: 5px;
    height: 9px;
    border: solid var(--cocoon-accent-fg);
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
    animation: check-pop 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  @keyframes check-pop {
    0% { transform: rotate(45deg) scale(0); }
    50% { transform: rotate(45deg) scale(1.2); }
    100% { transform: rotate(45deg) scale(1); }
  }

  /* Context card - grid item with icon */
  .context-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 12px;
    background: var(--cocoon-bg);
    border: 1px solid var(--cocoon-border);
    border-radius: 11px;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
  }

  .context-card:hover {
    border-color: var(--cocoon-muted);
    background: var(--cocoon-dim);
  }

  .context-card.active {
    border-color: var(--cocoon-accent);
    background: color-mix(in srgb, var(--cocoon-accent) 6%, var(--cocoon-bg));
  }

  .context-card .icon-box {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cocoon-elevated);
    transition: all 0.15s ease;
  }

  .context-card.active .icon-box {
    background: color-mix(in srgb, var(--cocoon-accent) 15%, transparent);
  }

  .context-card .icon-box svg {
    width: 15px;
    height: 15px;
    color: var(--cocoon-muted);
    transition: color 0.15s ease;
  }

  .context-card.active .icon-box svg {
    color: var(--cocoon-accent);
  }

  /* Metric chip - matches context-card style */
  .metric-chip {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 12px;
    background: var(--cocoon-bg);
    border: 1px solid var(--cocoon-border);
    border-radius: 11px;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
  }

  .metric-chip:hover {
    border-color: var(--cocoon-muted);
    background: var(--cocoon-dim);
  }

  .metric-chip.active {
    border-color: var(--cocoon-accent);
    background: color-mix(in srgb, var(--cocoon-accent) 6%, var(--cocoon-bg));
  }

  .metric-chip .icon-box {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cocoon-elevated);
    transition: all 0.15s ease;
  }

  .metric-chip.active .icon-box {
    background: color-mix(in srgb, var(--cocoon-accent) 15%, transparent);
  }

  .metric-chip .icon-box svg {
    width: 15px;
    height: 15px;
    color: var(--cocoon-muted);
    transition: color 0.15s ease;
  }

  .metric-chip.active .icon-box svg {
    color: var(--cocoon-accent);
  }

  /* Contained section box */
  .settings-box {
    background: var(--cocoon-bg);
    border: 1px solid var(--cocoon-border);
    border-radius: 12px;
    padding: 14px;
  }

  /* Quota input */
  .quota-input {
    width: 72px;
    padding: 8px 10px;
    background: var(--cocoon-bg);
    border: 1px solid var(--cocoon-border);
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    color: var(--cocoon-text);
    text-align: center;
    outline: none;
    transition: border-color 0.15s ease;
    -moz-appearance: textfield;
  }

  .quota-input::-webkit-outer-spin-button,
  .quota-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .quota-input:hover:not(:disabled) {
    border-color: var(--cocoon-muted);
  }

  .quota-input:focus {
    border-color: var(--cocoon-accent);
  }

  .quota-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Quota select */
  .quota-select {
    padding: 8px 28px 8px 12px;
    background: var(--cocoon-bg);
    border: 1px solid var(--cocoon-border);
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    color: var(--cocoon-text);
    outline: none;
    cursor: pointer;
    transition: border-color 0.15s ease;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371767B' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
  }

  .quota-select:hover:not(:disabled) {
    border-color: var(--cocoon-muted);
  }

  .quota-select:focus {
    border-color: var(--cocoon-accent);
  }

  .quota-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .quota-select option {
    background: var(--cocoon-surface);
    color: var(--cocoon-text);
  }

  /* Quota usage box */
  .quota-usage-box {
    background: var(--cocoon-elevated);
  }

  /* Progress bar */
  .quota-progress-track {
    height: 6px;
    background: var(--cocoon-border);
    border-radius: 3px;
    overflow: hidden;
  }

  .quota-progress-fill {
    height: 100%;
    background: var(--cocoon-accent);
    border-radius: 3px;
    transition: width 0.3s ease, background-color 0.3s ease;
  }

  .quota-progress-fill.approaching {
    background: #F5A623;
  }

  .quota-progress-fill.at-limit {
    background: #F4212E;
  }
</style>

<div class="space-y-6">
  <div>
    <h2 class="text-lg font-semibold mb-1">Feeds</h2>
    <p class="text-sm text-cocoon-muted">Configure how Cocoon handles different feed types.</p>
  </div>

  <section class="bg-cocoon-surface rounded-xl p-6 border border-cocoon-border">
    <div class="flex items-center gap-3 mb-6">
      <div class="w-10 h-10 rounded-xl bg-cocoon-elevated flex items-center justify-center">
        <XLogo size={20} class="text-cocoon-text" />
      </div>
      <div>
        <h3 class="text-sm font-semibold">X / Twitter</h3>
        <p class="text-xs text-cocoon-muted">Configure overlay behavior</p>
      </div>
    </div>

    <!-- Feed context grid in contained box -->
    <div class="settings-box mb-5">
      <div class="text-xs font-semibold text-cocoon-muted uppercase tracking-wider mb-3">Enable overlay on</div>
      <div class="grid grid-cols-2 gap-2.5">
        {#each feedContextOptions as option}
          <label class="context-card {enabledFeedContexts[option.key] ? 'active' : ''}">
            <input
              type="checkbox"
              class="cocoon-check"
              checked={enabledFeedContexts[option.key]}
              onchange={() => updateFeedContext(option.key)}
            />
            <div class="icon-box">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d={option.icon} />
              </svg>
            </div>
            <span class="text-[13px] font-medium">{option.label}</span>
          </label>
        {/each}
      </div>
    </div>

    <!-- Engagement metrics in contained box -->
    <div class="settings-box mb-5">
      <div class="text-xs font-semibold text-cocoon-muted uppercase tracking-wider mb-3">Show engagement</div>
      <div class="flex flex-wrap gap-2">
        {#each metricOptions as option}
          <label class="metric-chip {showMetrics[option.key] ? 'active' : ''}">
            <input
              type="checkbox"
              class="cocoon-check"
              checked={showMetrics[option.key]}
              onchange={() => updateShowMetric(option.key)}
            />
            <div class="icon-box">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d={option.icon} />
              </svg>
            </div>
            <span class="text-[13px] font-medium">{option.label}</span>
          </label>
        {/each}
      </div>
    </div>

    <!-- Toggle options using the same switch style as AppearanceSection -->
    <div class="border-t border-cocoon-border pt-5 space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-medium">Always expand tweets</div>
          <div class="text-xs text-cocoon-muted">Show full text without truncation</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={alwaysExpandTweets}
          onclick={toggleAlwaysExpand}
          class="relative w-11 h-6 rounded-full transition-colors {alwaysExpandTweets ? 'bg-cocoon-accent' : 'bg-cocoon-border'}"
        >
          <span class="absolute top-1 left-1 w-4 h-4 rounded-full shadow transition-transform {alwaysExpandTweets ? 'translate-x-5 bg-cocoon-accent-fg' : 'translate-x-0 bg-cocoon-surface'}"></span>
        </button>
      </div>

      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-medium">Auto-unmute after interaction</div>
          <div class="text-xs text-cocoon-muted">New videos unmute after you've interacted with one</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoUnmuteAfterInteraction}
          onclick={toggleAutoUnmute}
          class="relative w-11 h-6 rounded-full transition-colors {autoUnmuteAfterInteraction ? 'bg-cocoon-accent' : 'bg-cocoon-border'}"
        >
          <span class="absolute top-1 left-1 w-4 h-4 rounded-full shadow transition-transform {autoUnmuteAfterInteraction ? 'translate-x-5 bg-cocoon-accent-fg' : 'translate-x-0 bg-cocoon-surface'}"></span>
        </button>
      </div>
    </div>
  </section>

  <!-- Dopamine Budget Section -->
  <section class="bg-cocoon-surface rounded-xl p-6 border border-cocoon-border">
    <div class="flex items-center gap-3 mb-6">
      <div class="w-10 h-10 rounded-xl bg-cocoon-elevated flex items-center justify-center">
        <svg class="w-5 h-5 text-cocoon-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
      </div>
      <div>
        <h3 class="text-sm font-semibold">Dopamine Budget</h3>
        <p class="text-xs text-cocoon-muted">Set limits on your daily feed consumption</p>
      </div>
    </div>

    <!-- Enable toggle -->
    <div class="settings-box mb-5">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-medium">Limit feed intake</div>
          <div class="text-xs text-cocoon-muted">Set a cap on how many posts you see</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={quotaSettings.enabled}
          onclick={toggleQuotaEnabled}
          class="relative w-11 h-6 rounded-full transition-colors {quotaSettings.enabled ? 'bg-cocoon-accent' : 'bg-cocoon-border'}"
        >
          <span class="absolute top-1 left-1 w-4 h-4 rounded-full shadow transition-transform {quotaSettings.enabled ? 'translate-x-5 bg-cocoon-accent-fg' : 'translate-x-0 bg-cocoon-surface'}"></span>
        </button>
      </div>
    </div>

    <!-- Quota controls -->
    <div class="settings-box mb-5 {quotaSettings.enabled ? '' : 'opacity-50'}">
      <div class="text-xs font-semibold text-cocoon-muted uppercase tracking-wider mb-3">Budget</div>
      <div class="flex items-center gap-3 flex-wrap">
        <span class="text-sm text-cocoon-text">Allow myself</span>
        <input
          type="number"
          min="1"
          max="1000"
          value={quotaSettings.limit}
          onchange={updateQuotaLimit}
          disabled={!quotaSettings.enabled}
          class="quota-input"
        />
        <span class="text-sm text-cocoon-text">posts per</span>
        <select
          value={quotaSettings.period}
          onchange={updateQuotaPeriod}
          disabled={!quotaSettings.enabled}
          class="quota-select"
        >
          <option value="day">day</option>
          <option value="week">week</option>
          <option value="month">month</option>
        </select>
      </div>
    </div>

    <!-- Current usage display -->
    <div class="settings-box quota-usage-box">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs text-cocoon-muted">
          {todayViewCount} posts viewed today
        </span>
        {#if quotaSettings.enabled}
          <span class="text-xs text-cocoon-muted">
            Resets in {timeRemaining}
          </span>
        {/if}
      </div>
      {#if quotaSettings.enabled}
        {@const progress = Math.min(100, (todayViewCount / quotaSettings.limit) * 100)}
        <div class="quota-progress-track">
          <div
            class="quota-progress-fill {progress >= 100 ? 'at-limit' : progress >= 80 ? 'approaching' : ''}"
            style="width: {progress}%"
          ></div>
        </div>
        <div class="text-xs text-cocoon-muted mt-2">
          {Math.max(0, quotaSettings.limit - todayViewCount)} remaining {periodLabel}
        </div>
      {/if}
    </div>
  </section>

  <section class="bg-cocoon-surface rounded-xl p-6 border border-cocoon-border">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl bg-cocoon-elevated flex items-center justify-center">
        <Rss size={20} class="text-cocoon-muted" />
      </div>
      <div>
        <h3 class="text-sm font-semibold">More feeds coming soon</h3>
        <p class="text-xs text-cocoon-muted">Threads, Reddit, YouTube, and more.</p>
      </div>
    </div>
  </section>
</div>

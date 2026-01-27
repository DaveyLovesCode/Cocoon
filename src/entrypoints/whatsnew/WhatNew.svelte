<script lang="ts">
  import { changelog, getChangesSince, type ChangelogEntry, type ChangeType } from '@/lib/changelog';
  import { initializeTheme } from '@/lib/theme';

  let newEntries = $state<ChangelogEntry[]>([]);
  let olderEntries = $state<ChangelogEntry[]>([]);
  let previousVersion = $state<string | null>(null);
  let currentVersion = $state('');

  $effect(() => {
    loadChangelog();
    initializeTheme();
  });

  async function loadChangelog() {
    // Get the current extension version
    const manifest = browser.runtime.getManifest();
    currentVersion = manifest.version;

    // Get the previous version from URL params (set by background.ts)
    const params = new URLSearchParams(window.location.search);
    previousVersion = params.get('from');

    // Split into new changes and older history
    const recent = getChangesSince(previousVersion);
    const recentVersions = new Set(recent.map(e => e.version));

    newEntries = recent;
    olderEntries = changelog.filter(e => !recentVersions.has(e.version));
  }

  function getTypeLabel(type: ChangeType): string {
    switch (type) {
      case 'added': return 'New';
      case 'improved': return 'Improved';
      case 'fixed': return 'Fixed';
    }
  }

  function getTypeClasses(type: ChangeType): string {
    switch (type) {
      case 'added': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'improved': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'fixed': return 'bg-sky-500/20 text-sky-400 border-sky-500/30';
    }
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function openOptions() {
    browser.runtime.openOptionsPage();
  }
</script>

<div class="min-h-screen bg-cocoon-bg text-cocoon-text">
  <!-- Header -->
  <header class="border-b border-cocoon-border bg-cocoon-surface/50">
    <div class="max-w-2xl mx-auto px-6 py-8">
      <div class="flex items-start gap-4">
        <div class="w-14 h-14 rounded-2xl bg-cocoon-surface border border-cocoon-border flex items-center justify-center flex-shrink-0">
          <img src="/icon/icon128.png" alt="Cocoon" class="w-10 h-10" />
        </div>
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">What's New in Cocoon</h1>
          <p class="text-cocoon-muted mt-1">
            {#if previousVersion}
              Updated from v{previousVersion} to v{currentVersion}
            {:else}
              Version {currentVersion}
            {/if}
          </p>
        </div>
      </div>
    </div>
  </header>

  <!-- Content -->
  <main class="max-w-2xl mx-auto px-6 py-10">
    {#if newEntries.length === 0 && olderEntries.length === 0}
      <div class="text-center py-16 text-cocoon-muted">
        <p>No changes to show.</p>
      </div>
    {:else}
      <!-- New changes -->
      {#if newEntries.length > 0}
        <div class="space-y-12">
          {#each newEntries as entry}
            <article>
              <div class="flex items-center gap-3 mb-5">
                <span class="text-lg font-semibold">v{entry.version}</span>
                <span class="text-sm text-cocoon-muted">{formatDate(entry.date)}</span>
              </div>
              <ul class="space-y-3">
                {#each entry.changes as change}
                  <li class="flex items-start gap-3 p-4 rounded-xl bg-cocoon-surface border border-cocoon-border">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium border {getTypeClasses(change.type)}">
                      {getTypeLabel(change.type)}
                    </span>
                    <span class="text-sm leading-relaxed flex-1 text-cocoon-text">{change.text}</span>
                  </li>
                {/each}
              </ul>
            </article>
          {/each}
        </div>
      {/if}

      <!-- Previous versions -->
      {#if olderEntries.length > 0}
        <div class="mt-12 pt-8 border-t border-cocoon-border">
          <h2 class="text-sm font-medium text-cocoon-muted uppercase tracking-wide mb-6">Previous versions</h2>
          <div class="space-y-8">
            {#each olderEntries as entry}
              <article>
                <div class="flex items-center gap-3 mb-3">
                  <span class="text-base font-medium text-cocoon-muted">v{entry.version}</span>
                  <span class="text-xs text-cocoon-muted">{formatDate(entry.date)}</span>
                </div>
                <ul class="space-y-2">
                  {#each entry.changes as change}
                    <li class="flex items-start gap-2 text-sm text-cocoon-muted">
                      <span class="text-xs opacity-60">{getTypeLabel(change.type)}</span>
                      <span>{change.text}</span>
                    </li>
                  {/each}
                </ul>
              </article>
            {/each}
          </div>
        </div>
      {/if}
    {/if}

    <!-- Footer actions -->
    <div class="mt-12 pt-8 border-t border-cocoon-border">
      <div class="flex items-center justify-between">
        <p class="text-sm text-cocoon-muted">
          Thanks for using Cocoon.
        </p>
        <button
          onclick={openOptions}
          class="px-5 py-2 bg-cocoon-accent text-cocoon-accent-fg rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Open Settings
        </button>
      </div>
    </div>
  </main>
</div>

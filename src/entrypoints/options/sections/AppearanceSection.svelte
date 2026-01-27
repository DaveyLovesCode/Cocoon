<script lang="ts">
  import {
    themes,
    setThemeSetting,
    setThemeMode,
    setAutoMatchFeedTheme,
    getResolvedColors,
    applyTheme,
    type ThemeMode,
  } from '../../../lib/theme';

  interface Props {
    currentTheme: string;
    currentMode: ThemeMode;
    autoMatchFeed: boolean;
    effectiveMode: 'light' | 'dark';
    onsaved: () => void;
  }

  let { currentTheme = $bindable(), currentMode = $bindable(), autoMatchFeed = $bindable(), effectiveMode, onsaved }: Props = $props();

  let themeDropdownOpen = $state(false);

  function applyCurrentTheme() {
    const colors = getResolvedColors(currentTheme, currentMode);
    applyTheme(colors);
  }

  async function selectTheme(themeId: string) {
    currentTheme = themeId;
    themeDropdownOpen = false;
    await setThemeSetting(themeId);
    applyCurrentTheme();
    onsaved();
  }

  async function selectMode(mode: ThemeMode) {
    currentMode = mode;
    await setThemeMode(mode);
    applyCurrentTheme();
    onsaved();
  }

  async function toggleAutoMatch() {
    autoMatchFeed = !autoMatchFeed;
    await setAutoMatchFeedTheme(autoMatchFeed);
    onsaved();
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.theme-dropdown')) {
      themeDropdownOpen = false;
    }
  }
</script>

<svelte:window onclick={handleClickOutside} />

<div class="space-y-6">
  <div>
    <h2 class="text-lg font-semibold mb-1">Appearance</h2>
    <p class="text-sm text-cocoon-muted">Choose how Cocoon looks across all pages.</p>
  </div>

  <section class="bg-cocoon-surface rounded-xl p-6 border border-cocoon-border">
    <div class="mb-4">
      <h3 class="text-sm font-medium mb-1">Theme</h3>
    </div>

    <!-- Theme dropdown -->
    <div class="theme-dropdown relative mb-4">
      <button
        type="button"
        onclick={() => themeDropdownOpen = !themeDropdownOpen}
        class="w-full flex items-center justify-between px-4 py-3 bg-cocoon-bg border border-cocoon-border rounded-lg hover:border-cocoon-muted transition-colors"
      >
        <div class="flex items-center gap-3">
          {#each themes as t}
            {#if t.id === currentTheme}
              <div class="w-7 h-7 rounded-md overflow-hidden flex flex-col shadow-sm border border-cocoon-border">
                <div class="flex-1" style="background: {t.variants[effectiveMode].bg}"></div>
                <div class="h-3" style="background: {t.variants[effectiveMode].accent}"></div>
              </div>
            {/if}
          {/each}
          <span class="font-medium">
            {themes.find(t => t.id === currentTheme)?.name || 'Cocoon'}
          </span>
        </div>
        <svg class="w-5 h-5 text-cocoon-muted transition-transform {themeDropdownOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {#if themeDropdownOpen}
        <div class="absolute top-full left-0 right-0 mt-2 bg-cocoon-surface border border-cocoon-border rounded-xl shadow-lg overflow-hidden z-50 max-h-80 overflow-y-auto">
          {#each themes as theme}
            <button
              type="button"
              onclick={() => selectTheme(theme.id)}
              class="w-full flex items-center gap-3 px-4 py-3 hover:bg-cocoon-elevated transition-colors {currentTheme === theme.id ? 'bg-cocoon-dim' : ''}"
            >
              <div class="w-7 h-7 rounded-md overflow-hidden flex flex-col shadow-sm border border-cocoon-border">
                <div class="flex-1" style="background: {theme.variants[effectiveMode].bg}"></div>
                <div class="h-3" style="background: {theme.variants[effectiveMode].accent}"></div>
              </div>
              <div class="flex-1 text-left">
                <div class="font-medium">{theme.name}</div>
              </div>
              {#if currentTheme === theme.id}
                <svg class="w-5 h-5 text-cocoon-accent" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Light/Dark/System mode selector -->
    <div class="flex items-center justify-between py-3 border-t border-cocoon-border">
      <div>
        <div class="text-sm font-medium">Mode</div>
        <div class="text-xs text-cocoon-muted">Light, dark, or match your system</div>
      </div>
      <div class="flex rounded-lg bg-cocoon-bg border border-cocoon-border overflow-hidden">
        <button
          type="button"
          onclick={() => selectMode('light')}
          class="px-3 py-1.5 text-sm transition-colors {currentMode === 'light' ? 'bg-cocoon-elevated text-cocoon-text' : 'text-cocoon-muted hover:text-cocoon-text'}"
        >
          Light
        </button>
        <button
          type="button"
          onclick={() => selectMode('system')}
          class="px-3 py-1.5 text-sm border-x border-cocoon-border transition-colors {currentMode === 'system' ? 'bg-cocoon-elevated text-cocoon-text' : 'text-cocoon-muted hover:text-cocoon-text'}"
        >
          System
        </button>
        <button
          type="button"
          onclick={() => selectMode('dark')}
          class="px-3 py-1.5 text-sm transition-colors {currentMode === 'dark' ? 'bg-cocoon-elevated text-cocoon-text' : 'text-cocoon-muted hover:text-cocoon-text'}"
        >
          Dark
        </button>
      </div>
    </div>

    <!-- Auto-match feed theme toggle -->
    <div class="flex items-center justify-between py-3 border-t border-cocoon-border">
      <div>
        <div class="text-sm font-medium">Match feed to website</div>
        <div class="text-xs text-cocoon-muted">Use the website's theme for feed overlay</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={autoMatchFeed}
        aria-label="Toggle auto-match feed theme"
        onclick={toggleAutoMatch}
        class="relative w-11 h-6 rounded-full transition-colors {autoMatchFeed ? 'bg-cocoon-accent' : 'bg-cocoon-border'}"
      >
        <span class="absolute top-1 left-1 w-4 h-4 rounded-full shadow transition-transform {autoMatchFeed ? 'translate-x-5 bg-cocoon-accent-fg' : 'translate-x-0 bg-cocoon-surface'}"></span>
      </button>
    </div>
  </section>
</div>

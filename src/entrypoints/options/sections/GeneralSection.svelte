<script lang="ts">
  import { encryptApiKey } from '../../../lib/crypto';

  interface Props {
    interests: string;
    hardBlocks: string;
    blockedKeywords: string[];
    apiKeySet: boolean;
    apiKeyEncrypted: boolean;
    maskedKey: string;
    onsaved: () => void;
  }

  let { interests = $bindable(), hardBlocks = $bindable(), blockedKeywords = $bindable(), apiKeySet = $bindable(), apiKeyEncrypted = $bindable(), maskedKey, onsaved }: Props = $props();

  // Filtering state
  let debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  let loadedInterests = $state(interests);
  let loadedHardBlocks = $state(hardBlocks);
  let keywordInput = $state('');

  // API state
  let apiKeyInput = $state('');
  let isEncrypting = $state(false);
  let isReplacing = $state(false);

  function debounce(key: string, fn: () => void, delay = 500) {
    clearTimeout(debounceTimers[key]);
    debounceTimers[key] = setTimeout(fn, delay);
  }

  async function saveUserProfile() {
    const interestsArray = interests.split('\n').map(s => s.trim()).filter(Boolean);
    const hardBlocksArray = hardBlocks.split('\n').map(s => s.trim()).filter(Boolean);
    await browser.storage.sync.set({
      userProfile: { interests: interestsArray, hardBlocks: hardBlocksArray, blockedKeywords },
    });
  }

  function addKeyword() {
    const kw = keywordInput.trim().toLowerCase();
    if (!kw || blockedKeywords.includes(kw)) {
      keywordInput = '';
      return;
    }
    blockedKeywords = [...blockedKeywords, kw];
    keywordInput = '';
    saveUserProfile();
    onsaved();
  }

  function removeKeyword(kw: string) {
    blockedKeywords = blockedKeywords.filter(k => k !== kw);
    saveUserProfile();
    onsaved();
  }

  $effect(() => {
    if (interests === loadedInterests) return;
    debounce('interests', () => {
      saveUserProfile();
      loadedInterests = interests;
      onsaved();
    });
  });

  $effect(() => {
    if (hardBlocks === loadedHardBlocks) return;
    debounce('hardBlocks', () => {
      saveUserProfile();
      loadedHardBlocks = hardBlocks;
      onsaved();
    });
  });

  async function saveApiKey() {
    if (!apiKeyInput.trim()) return;

    isEncrypting = true;
    await new Promise(r => setTimeout(r, 800));

    const encrypted = await encryptApiKey(apiKeyInput.trim());
    await browser.storage.sync.set({ apiKey: encrypted });

    apiKeySet = true;
    apiKeyEncrypted = true;
    apiKeyInput = '';
    isEncrypting = false;
    isReplacing = false;
    onsaved();
  }

  function replaceApiKey() {
    isReplacing = true;
    apiKeyInput = '';
  }

  function cancelReplace() {
    apiKeyInput = '';
    isReplacing = false;
  }
</script>

<div class="space-y-6">
  <div>
    <h2 class="text-lg font-semibold mb-1">General</h2>
    <p class="text-sm text-cocoon-muted">Configure your filtering preferences and API connection.</p>
  </div>

  <!-- API Section -->
  <section id="api-section" class="relative bg-cocoon-surface rounded-xl p-6 border border-cocoon-border">
    <a
      href="https://openrouter.ai/keys"
      target="_blank"
      class="absolute top-6 right-6 inline-flex items-center gap-1 text-sm text-cocoon-text hover:text-cocoon-accent transition-colors"
    >
      <span>Get a key</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 17L17 7"/>
        <path d="M7 7h10v10"/>
      </svg>
    </a>

    <div class="mb-4">
      <h3 class="text-sm font-medium mb-1">OpenRouter Key</h3>
      <p class="text-xs text-cocoon-muted">Required for AI-powered filtering.</p>
    </div>

    {#if isEncrypting}
      <div class="flex items-center gap-3 px-3 py-2.5 bg-cocoon-bg border border-cocoon-accent rounded-lg">
        <div class="flex items-center gap-2 flex-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-cocoon-accent animate-pulse">
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span class="text-sm text-cocoon-accent font-medium">Encrypting...</span>
        </div>
        <div class="w-4 h-4 border-2 border-cocoon-accent border-t-transparent rounded-full animate-spin"></div>
      </div>
    {:else if apiKeySet && !isReplacing}
      <div class="space-y-2">
        <div class="flex items-center gap-3">
          <div class="flex-1 px-3 py-2.5 bg-cocoon-bg border border-cocoon-border rounded-lg text-sm text-cocoon-muted font-mono">
            {maskedKey}
          </div>
          <button
            onclick={replaceApiKey}
            class="px-4 py-2.5 bg-cocoon-bg border border-cocoon-border rounded-lg text-sm font-medium hover:border-cocoon-accent hover:bg-cocoon-elevated transition-colors"
          >
            Replace
          </button>
        </div>
        {#if apiKeyEncrypted}
          <div class="flex items-center gap-1.5 text-xs text-cocoon-muted">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span>Encrypted and stored securely</span>
          </div>
        {/if}
      </div>
    {:else}
      <div class="space-y-3">
        <input
          type="password"
          id="apiKey"
          bind:value={apiKeyInput}
          placeholder="sk-or-..."
          onkeydown={(e) => e.key === 'Enter' && saveApiKey()}
          class="w-full px-3 py-2.5 bg-cocoon-bg border border-cocoon-border rounded-lg text-sm focus:outline-none focus:border-cocoon-accent text-cocoon-text"
        />
        <div class="flex items-center gap-2">
          <button
            onclick={saveApiKey}
            disabled={!apiKeyInput.trim()}
            class="flex-1 px-4 py-2.5 bg-cocoon-accent text-cocoon-accent-fg rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span>Save & Encrypt</span>
          </button>
          {#if isReplacing}
            <button
              onclick={cancelReplace}
              class="px-4 py-2.5 bg-cocoon-bg border border-cocoon-border rounded-lg text-sm font-medium hover:border-cocoon-accent hover:bg-cocoon-elevated transition-colors"
            >
              Cancel
            </button>
          {/if}
        </div>
      </div>
    {/if}
  </section>

  <!-- Interests Section -->
  <section class="bg-cocoon-surface rounded-xl p-6 border border-cocoon-border">
    <div class="mb-4">
      <h3 class="text-sm font-medium mb-1">What matters to you</h3>
      <p class="text-xs text-cocoon-muted">Content matching these interests will be kept.</p>
    </div>
    <textarea
      id="interests"
      bind:value={interests}
      placeholder="learning&#10;building&#10;creativity&#10;design"
      class="w-full px-4 py-3 bg-cocoon-bg border border-cocoon-border rounded-lg text-sm min-h-[140px] resize-y focus:outline-none focus:border-cocoon-accent placeholder:text-cocoon-muted/50 text-cocoon-text"
    ></textarea>
  </section>

  <!-- Hard Blocks Section -->
  <section class="bg-cocoon-surface rounded-xl p-6 border border-cocoon-border">
    <div class="mb-4">
      <h3 class="text-sm font-medium mb-1">What to filter out</h3>
      <p class="text-xs text-cocoon-muted">Content matching these will always be hidden.</p>
    </div>
    <textarea
      id="hardBlocks"
      bind:value={hardBlocks}
      placeholder="clickbait&#10;outrage bait&#10;engagement farming"
      class="w-full px-4 py-3 bg-cocoon-bg border border-cocoon-border rounded-lg text-sm min-h-[120px] resize-y focus:outline-none focus:border-cocoon-accent placeholder:text-cocoon-muted/50 text-cocoon-text"
    ></textarea>
  </section>

  <!-- Blocked Keywords Section -->
  <section class="bg-cocoon-surface rounded-xl p-6 border border-cocoon-border">
    <div class="mb-4">
      <h3 class="text-sm font-medium mb-1">Blocked keywords</h3>
      <p class="text-xs text-cocoon-muted">Posts containing these exact words are filtered before AI sees them.</p>
    </div>
    <input
      type="text"
      bind:value={keywordInput}
      onkeydown={(e) => e.key === 'Enter' && addKeyword()}
      placeholder="Type keyword and press Enter"
      class="w-full px-4 py-3 bg-cocoon-bg border border-cocoon-border rounded-lg text-sm focus:outline-none focus:border-cocoon-accent placeholder:text-cocoon-muted/50 text-cocoon-text"
    />
    {#if blockedKeywords.length > 0}
      <div class="flex flex-wrap gap-2 mt-3">
        {#each blockedKeywords as kw}
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-cocoon-bg border border-cocoon-border rounded-md text-sm text-cocoon-text">
            {kw}
            <button
              type="button"
              onclick={() => removeKeyword(kw)}
              class="text-cocoon-muted hover:text-cocoon-text transition-colors"
              aria-label="Remove {kw}"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6L6 18"/>
                <path d="M6 6l12 12"/>
              </svg>
            </button>
          </span>
        {/each}
      </div>
    {/if}
  </section>
</div>

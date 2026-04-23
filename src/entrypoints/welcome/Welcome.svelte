<script lang="ts">
  import { ArrowLeft, ArrowRight, Loader2 } from '@lucide/svelte';
  import { createLogger } from '@/lib/logger';
  import { initializeTheme } from '@/lib/theme';
  import { encryptApiKey } from '@/lib/crypto';
  import { PRESET_INTERESTS, PRESET_BLOCKS, DEFAULT_BLOCK_LABELS } from '@/lib/onboarding-data';
  import Logo from '@/lib/components/Logo.svelte';

  const log = createLogger('Welcome');

  // Apply theme on load
  $effect(() => {
    initializeTheme();
  });

  let currentStep = $state(0);

  // Step 1: API Key
  let apiKey = $state('');
  let isValidatingKey = $state(false);
  let keyError = $state('');
  let keyErrorRetryable = $state(false); // true for network errors, false for invalid key

  // Step 2: Interests (store labels for UI selection)
  let selectedInterestLabels = $state<string[]>([]);

  // Step 3: Blocks (store labels for UI selection)
  let selectedBlockLabels = $state<string[]>([...DEFAULT_BLOCK_LABELS]);

  // Helper maps for label -> prompt lookup
  const interestPromptMap = new Map(PRESET_INTERESTS.map(i => [i.label, i.prompt]));
  const blockPromptMap = new Map(PRESET_BLOCKS.map(b => [b.label, b.prompt]));
  const allBlockLabels = PRESET_BLOCKS.map(b => b.label);

  async function validateAndSaveKey() {
    if (!apiKey.trim()) {
      keyError = 'Please enter your API key';
      keyErrorRetryable = false;
      return;
    }

    isValidatingKey = true;
    keyError = '';
    keyErrorRetryable = false;
    log.info('Validating API key...');

    try {
      const trimmedKey = apiKey.trim();
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${trimmedKey}` },
      });

      if (!response.ok) {
        log.warn('API key validation failed', response.status);
        keyError = 'That key doesn\'t look right. Double-check and try again.';
        keyErrorRetryable = false;
        return;
      }

      const encrypted = await encryptApiKey(trimmedKey);
      await browser.storage.sync.set({ apiKey: encrypted });
      log.info('API key encrypted and saved');
      currentStep = 2;
    } catch (e) {
      log.error('API key validation error', e);
      keyError = 'Couldn\'t connect to OpenRouter. Check your internet and try again.';
      keyErrorRetryable = true;
    } finally {
      isValidatingKey = false;
    }
  }

  function toggleInterest(label: string) {
    if (selectedInterestLabels.includes(label)) {
      selectedInterestLabels = selectedInterestLabels.filter(i => i !== label);
    } else {
      selectedInterestLabels = [...selectedInterestLabels, label];
    }
  }

  function toggleBlock(label: string) {
    if (selectedBlockLabels.includes(label)) {
      selectedBlockLabels = selectedBlockLabels.filter(b => b !== label);
    } else {
      selectedBlockLabels = [...selectedBlockLabels, label];
    }
  }

  function proceedToBlocks() {
    if (selectedInterestLabels.length === 0) return;
    log.info('Interests selected', { count: selectedInterestLabels.length });
    currentStep = 3;
  }

  async function saveAndFinish() {
    const interestPrompts = selectedInterestLabels.map(label => interestPromptMap.get(label) || label);
    const blockPrompts = selectedBlockLabels.map(label => blockPromptMap.get(label) || label);

    await browser.storage.sync.set({
      userProfile: {
        interests: interestPrompts,
        hardBlocks: blockPrompts
      }
    });

    log.info('Preferences saved', { interests: interestPrompts.length, blocks: blockPrompts.length });
    currentStep = 4;
  }

  function goToX() {
    window.open('https://x.com', '_blank');
  }

  function openSettings() {
    browser.tabs.create({ url: browser.runtime.getURL('/options.html') });
  }

  function goBack() {
    if (currentStep > 1) currentStep--;
  }

  function goToStep(step: number) {
    // Only allow navigating to completed steps or current step
    if (step <= currentStep && step >= 1) {
      currentStep = step;
    }
  }
</script>

<div class="min-h-screen bg-cocoon-bg text-cocoon-text flex flex-col items-center justify-center p-6">
  <!-- Progress dots (clickable) -->
  {#if currentStep > 0 && currentStep < 4}
    <div class="fixed top-8 left-1/2 -translate-x-1/2 flex gap-3">
      {#each [1, 2, 3] as step}
        <button
          onclick={() => goToStep(step)}
          disabled={step > currentStep}
          class="w-2.5 h-2.5 rounded-full transition-all duration-300 {currentStep >= step ? 'bg-cocoon-coral' : 'bg-cocoon-border'} {step <= currentStep ? 'cursor-pointer hover:scale-125' : 'cursor-default'}"
          aria-label="Go to step {step}"
        ></button>
      {/each}
    </div>
  {/if}

  <div class="w-full max-w-lg">
    <!-- Step 0: Welcome Splash -->
    {#if currentStep === 0}
      <div class="text-center animate-fade-in-up">
        <div class="flex justify-center mb-6">
          <Logo size={64} mouthProgress={1} color="#A8E6CF" />
        </div>
        <h1 class="font-heading text-5xl md:text-6xl font-bold text-cocoon-text leading-none tracking-tight mb-4">
          COCOON
        </h1>
        <p class="text-xl text-cocoon-muted mb-12">
          Filter the internet.<br/>See only what matters.
        </p>

        <button
          onclick={() => currentStep = 1}
          class="inline-flex items-center gap-2 px-8 py-4 bg-cocoon-coral text-[#2D3436] rounded-full text-lg font-semibold hover:scale-105 transition-transform shadow-lg"
        >
          Get Started
          <ArrowRight size={20} />
        </button>
      </div>
    {/if}

    <!-- Step 1: API Key -->
    {#if currentStep === 1}
      <div class="text-center animate-fade-in-up">
        <h1 class="font-heading text-3xl md:text-4xl font-bold tracking-tight mb-3">
          Connect to OpenRouter
        </h1>
        <p class="text-lg text-cocoon-muted mb-8">
          Your key is stored locally and encrypted.
        </p>

        <div class="space-y-4">
          <input
            type="password"
            bind:value={apiKey}
            placeholder="sk-or-..."
            disabled={isValidatingKey}
            onkeydown={(e) => e.key === 'Enter' && validateAndSaveKey()}
            class="w-full px-5 py-4 bg-cocoon-surface border-2 border-cocoon-border rounded-2xl text-base text-cocoon-text focus:outline-none focus:border-cocoon-coral disabled:opacity-50 text-center"
          />
          {#if keyError}
            <div class="text-sm text-red-400">
              <p>{keyError}</p>
              {#if keyErrorRetryable}
                <button
                  onclick={validateAndSaveKey}
                  disabled={isValidatingKey}
                  class="mt-2 underline hover:no-underline text-cocoon-text"
                >
                  Try again
                </button>
              {/if}
            </div>
          {/if}
          <button
            onclick={validateAndSaveKey}
            disabled={isValidatingKey}
            class="w-full py-4 bg-cocoon-coral text-[#2D3436] rounded-2xl text-lg font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {#if isValidatingKey}
              <span class="inline-flex items-center gap-2">
                <Loader2 size={20} class="animate-spin" />
                Validating...
              </span>
            {:else}
              Continue
            {/if}
          </button>
        </div>

        <div class="mt-8 text-sm text-cocoon-muted">
          <p>
            Don't have a key?
            <a href="https://openrouter.ai/keys" target="_blank" class="text-cocoon-text underline hover:no-underline">
              Get one free at openrouter.ai
            </a>
          </p>
        </div>
      </div>
    {/if}

    <!-- Step 2: Interests -->
    {#if currentStep === 2}
      <div class="text-center animate-fade-in-up">
        <h1 class="font-heading text-3xl md:text-4xl font-bold tracking-tight mb-2">
          What matters to you?
        </h1>
        <p class="text-lg text-cocoon-muted mb-8">
          Select your interests. You can always change these later.
        </p>

        <div class="flex flex-wrap gap-2 justify-center mb-8">
          {#each PRESET_INTERESTS as interest}
            <button
              onclick={() => toggleInterest(interest.label)}
              class="pill px-4 py-2 border rounded-full text-sm font-medium transition-all hover:scale-105 active:scale-95"
              class:enabled={selectedInterestLabels.includes(interest.label)}
              class:disabled={!selectedInterestLabels.includes(interest.label)}
            >
              {interest.label}
            </button>
          {/each}
        </div>

        <div class="flex gap-3">
          <button
            onclick={goBack}
            class="p-4 bg-cocoon-elevated text-cocoon-muted hover:text-cocoon-text rounded-2xl transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
          <button
            onclick={proceedToBlocks}
            disabled={selectedInterestLabels.length === 0}
            class="flex-1 py-4 bg-cocoon-coral text-[#2D3436] rounded-2xl text-lg font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continue{selectedInterestLabels.length > 0 ? ` (${selectedInterestLabels.length} selected)` : ''}
          </button>
        </div>
      </div>
    {/if}

    <!-- Step 3: Blocks -->
    {#if currentStep === 3}
      <div class="text-center animate-fade-in-up">
        <h1 class="font-heading text-3xl md:text-4xl font-bold tracking-tight mb-2">
          What wastes your time?
        </h1>
        <p class="text-lg text-cocoon-muted mb-2">
          Select content to always hide.
        </p>
        <button
          onclick={() => selectedBlockLabels = selectedBlockLabels.length === PRESET_BLOCKS.length ? [] : [...allBlockLabels]}
          class="text-sm text-cocoon-muted hover:text-cocoon-text underline mb-6"
        >
          {selectedBlockLabels.length === PRESET_BLOCKS.length ? 'Deselect all' : 'Select all'}
        </button>

        <!-- Block pills -->
        <div class="flex flex-wrap gap-2 justify-center mb-8">
          {#each PRESET_BLOCKS as block}
            <button
              onclick={() => toggleBlock(block.label)}
              class="pill px-4 py-2 border rounded-full text-sm font-medium transition-all hover:scale-105 active:scale-95"
              class:block-enabled={selectedBlockLabels.includes(block.label)}
              class:block-disabled={!selectedBlockLabels.includes(block.label)}
            >
              {block.label}
            </button>
          {/each}
        </div>

        <div class="flex gap-3">
          <button
            onclick={goBack}
            class="p-4 bg-cocoon-elevated text-cocoon-muted hover:text-cocoon-text rounded-2xl transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
          <button
            onclick={saveAndFinish}
            class="flex-1 py-4 bg-cocoon-coral text-[#2D3436] rounded-2xl text-lg font-semibold hover:opacity-90 transition-opacity"
          >
            Finish Setup{selectedBlockLabels.length > 0 ? ` (${selectedBlockLabels.length} blocked)` : ''}
          </button>
        </div>
      </div>
    {/if}

    <!-- Step 4: Done -->
    {#if currentStep === 4}
      <div class="text-center animate-fade-in-up">
        <div class="flex justify-center mb-6">
          <Logo size={48} mouthProgress={1} color="#A8E6CF" />
        </div>
        <h1 class="font-heading text-3xl md:text-4xl font-bold tracking-tight mb-3">
          You're all set
        </h1>
        <p class="text-lg text-cocoon-muted mb-10">
          Cocoon is ready to filter your feed.
        </p>

        <div class="space-y-3">
          <button
            onclick={goToX}
            class="w-full py-4 bg-cocoon-coral text-[#2D3436] rounded-2xl text-lg font-semibold hover:opacity-90 transition-opacity"
          >
            Try it on X
          </button>
          <button
            onclick={openSettings}
            class="w-full py-3 text-cocoon-muted hover:text-cocoon-text text-sm transition-colors"
          >
            Customize settings
          </button>
        </div>
      </div>
    {/if}
  </div>

</div>

<style>
  /* Interest pills */
  .pill.enabled {
    border-color: #A8E6CF;
    background-color: rgba(168, 230, 207, 0.15);
    color: var(--cocoon-text);
    box-shadow: 0 0 0 1px rgba(168, 230, 207, 0.2);
  }

  .pill.disabled {
    border-color: var(--cocoon-border);
    background-color: transparent;
    color: var(--cocoon-muted);
    border-style: dashed;
    opacity: 0.7;
  }

  /* Block pills - use coral for enabled state */
  .pill.block-enabled {
    border-color: #FF9F8E;
    background-color: rgba(255, 159, 142, 0.15);
    color: var(--cocoon-text);
    box-shadow: 0 0 0 1px rgba(255, 159, 142, 0.2);
  }

  .pill.block-disabled {
    border-color: var(--cocoon-border);
    background-color: transparent;
    color: var(--cocoon-muted);
    border-style: dashed;
    opacity: 0.7;
  }
</style>

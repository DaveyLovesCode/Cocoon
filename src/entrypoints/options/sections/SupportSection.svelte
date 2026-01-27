<script lang="ts">
  import { Mail, Check } from '@lucide/svelte';

  let emailCopied = $state(false);

  async function copyEmail() {
    await navigator.clipboard.writeText('hey@davey.design');
    emailCopied = true;
    setTimeout(() => emailCopied = false, 2000);
  }
</script>

<div class="space-y-6">
  <div>
    <h2 class="text-lg font-semibold mb-1">Support</h2>
    <p class="text-sm text-cocoon-muted">Get help with Cocoon.</p>
  </div>

  <section class="bg-cocoon-surface rounded-xl p-6 border border-cocoon-border">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-sm font-medium">Need help?</h3>
        <p class="text-xs text-cocoon-muted mt-1">hey@davey.design</p>
      </div>
      <button
        onclick={copyEmail}
        class="flex items-center gap-2 px-4 py-2.5 bg-cocoon-bg border border-cocoon-border rounded-lg text-sm font-medium hover:border-cocoon-accent hover:bg-cocoon-elevated transition-colors"
      >
        {#if emailCopied}
          <Check size={16} />
          <span>Copied</span>
        {:else}
          <Mail size={16} />
          <span>Copy Email</span>
        {/if}
      </button>
    </div>
  </section>
</div>

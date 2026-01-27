<script lang="ts">
  import { Download, Upload, Trash2, Copy, Check, ChevronDown } from '@lucide/svelte';
  import { exportSettings, importSettings } from '../../../lib/settings';
  import { getEncryptedLogs, clearLogs, getLogs } from '../../../lib/logger';

  interface Props {
    onsaved: () => void;
    onreload: () => void;
  }

  let { onsaved, onreload }: Props = $props();

  let importError = $state('');
  let importSuccess = $state(false);
  let logsExpanded = $state(false);
  let logsCopied = $state(false);
  let logsCleared = $state(false);
  let logCount = $state(0);

  $effect(() => {
    loadLogCount();
  });

  async function loadLogCount() {
    const logs = await getLogs();
    logCount = logs.length;
  }

  async function handleExport() {
    const data = await exportSettings();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cocoon-settings-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    importError = '';
    importSuccess = false;

    const text = await file.text();
    const result = await importSettings(text);

    if (result.success) {
      importSuccess = true;
      setTimeout(() => importSuccess = false, 3000);
      onreload();
    } else {
      importError = result.error || 'Import failed';
      setTimeout(() => importError = '', 5000);
    }

    input.value = '';
  }

  async function copyLogs() {
    const encrypted = await getEncryptedLogs();
    if (!encrypted) return;
    await navigator.clipboard.writeText(encrypted);
    logsCopied = true;
    setTimeout(() => logsCopied = false, 2000);
  }

  async function handleClearLogs() {
    await clearLogs();
    logsCleared = true;
    logCount = 0;
    setTimeout(() => logsCleared = false, 2500);
  }

  function openLogs() {
    browser.tabs.create({ url: browser.runtime.getURL('/logs.html') });
  }
</script>

<div class="space-y-6">
  <div>
    <h2 class="text-lg font-semibold mb-1">Data</h2>
    <p class="text-sm text-cocoon-muted">Manage your settings and diagnostic data.</p>
  </div>

  <section class="bg-cocoon-surface rounded-xl p-6 border border-cocoon-border">
    <div class="mb-4">
      <h3 class="text-sm font-medium mb-1">Backup & Restore</h3>
      <p class="text-xs text-cocoon-muted">Export your settings to back them up or transfer to another device.</p>
    </div>
    <div class="flex gap-3">
      <button
        onclick={handleExport}
        class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-cocoon-bg border border-cocoon-border rounded-lg text-sm font-medium hover:border-cocoon-accent hover:bg-cocoon-elevated transition-colors"
      >
        <Download size={16} />
        <span>Export</span>
      </button>
      <label class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-cocoon-bg border border-cocoon-border rounded-lg text-sm font-medium hover:border-cocoon-accent hover:bg-cocoon-elevated transition-colors cursor-pointer">
        <Upload size={16} />
        <span>Import</span>
        <input type="file" accept=".json" onchange={handleImport} class="hidden" />
      </label>
    </div>
    {#if importError}
      <p class="mt-3 text-sm text-red-500">{importError}</p>
    {/if}
    {#if importSuccess}
      <p class="mt-3 text-sm text-green-500">Settings imported</p>
    {/if}
    <p class="text-xs text-cocoon-muted mt-3">API key is not included in exports for security.</p>
  </section>

  <section class="bg-cocoon-surface rounded-xl p-6 border border-cocoon-border">
    <div class="mb-4">
      <h3 class="text-sm font-medium mb-1">Diagnostic Logs</h3>
      <p class="text-xs text-cocoon-muted">
        Encrypted and stored on your device. Never sent unless you share them.
      </p>
    </div>

    <button
      type="button"
      onclick={() => logsExpanded = !logsExpanded}
      class="w-full text-left bg-cocoon-bg border border-cocoon-border rounded-lg transition-colors hover:border-cocoon-muted"
    >
      <div class="flex items-center justify-between px-4 py-3">
        <span class="text-sm font-medium text-cocoon-text">Data included when you share</span>
        <ChevronDown
          size={16}
          class="text-cocoon-muted transition-transform duration-200 {logsExpanded ? 'rotate-180' : ''}"
        />
      </div>
      {#if logsExpanded}
        <div class="px-4 pb-4 pt-1 border-t border-cocoon-border">
          <ul class="list-disc list-inside space-y-1 text-sm text-cocoon-muted">
            <li>URLs of pages you visited</li>
            <li>Text of posts that were analyzed</li>
            <li>Filter decisions (kept/hidden)</li>
            <li>Your interests and hard blocks</li>
            <li>Errors and timing data</li>
          </ul>
          <p class="mt-3 text-[13px] text-cocoon-text">
            For minimal data: clear first, reproduce the issue, then copy.
          </p>
        </div>
      {/if}
    </button>

    <div class="flex items-center justify-between py-3 mt-4 border-t border-cocoon-border">
      <div class="text-sm">
        {#if logsCleared}
          <span class="text-green-500 font-medium">Cleared</span>
        {:else}
          <span class="text-cocoon-muted">{logCount} {logCount === 1 ? 'entry' : 'entries'}</span>
        {/if}
      </div>
      <button
        onclick={handleClearLogs}
        disabled={logsCleared || logCount === 0}
        class="flex items-center gap-1.5 px-3 py-1.5 text-sm text-cocoon-muted hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {#if logsCleared}
          <Check size={14} class="text-green-500" />
        {:else}
          <Trash2 size={14} />
        {/if}
        <span>Clear</span>
      </button>
    </div>

    <button
      onclick={copyLogs}
      disabled={logCount === 0}
      class="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-cocoon-bg border border-cocoon-border rounded-lg text-sm font-medium hover:border-cocoon-accent hover:bg-cocoon-elevated transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {#if logsCopied}
        <Check size={16} />
        <span>Copied to clipboard</span>
      {:else}
        <Copy size={16} />
        <span>Copy Logs</span>
      {/if}
    </button>
  </section>

  {#if import.meta.env.MODE === 'development'}
  <div class="flex justify-center">
    <button
      onclick={openLogs}
      class="text-sm text-cocoon-muted hover:text-cocoon-text transition-colors"
    >
      View Logs
    </button>
  </div>
  {/if}
</div>

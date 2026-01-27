<script lang="ts">
  import { getLogs, clearLogs as clearStoredLogs, type LogEntry, type LogLevel } from '@/lib/logger';
  import { downloadLogsDb } from '@/lib/log-export';
  import { escapeHtml } from '@/lib/utils/escape';

  const levelColors: Record<LogLevel, string> = {
    debug: '#71717a',
    info: '#3b82f6',
    warn: '#f59e0b',
    error: '#ef4444',
  };

  let allLogs = $state<LogEntry[]>([]);
  let selectedIds = $state(new Set<string>());
  let lastClickedId = $state<string | null>(null);
  let searchQuery = $state('');
  let activeLevels = $state(new Set<LogLevel>(['debug', 'info', 'warn', 'error']));

  // Derived filtered logs
  let filteredLogs = $derived(() => {
    return allLogs.filter(log => {
      if (!activeLevels.has(log.level)) return false;
      if (searchQuery) {
        const searchable = `${log.message} ${log.source} ${JSON.stringify(log.data || '')}`.toLowerCase();
        if (!searchable.includes(searchQuery.toLowerCase())) return false;
      }
      return true;
    });
  });

  let selectedCount = $derived(selectedIds.size);

  // Load logs on mount
  $effect(() => {
    loadLogs();
    // Poll for new logs
    const interval = setInterval(loadLogs, 2000);
    return () => clearInterval(interval);
  });

  async function loadLogs() {
    allLogs = await getLogs();
  }

  function toggleLevel(level: LogLevel) {
    const newSet = new Set(activeLevels);
    if (newSet.has(level)) {
      newSet.delete(level);
    } else {
      newSet.add(level);
    }
    activeLevels = newSet;
  }

  async function clearLogs() {
    await clearStoredLogs();
    allLogs = [];
    selectedIds = new Set();
    lastClickedId = null;
  }

  function exportLogs() {
    const logs = filteredLogs();
    const text = logs.map(log => {
      const time = new Date(log.timestamp).toISOString();
      const data = log.data ? `\n    ${typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)}` : '';
      return `[${time}] [${log.level.toUpperCase()}] [${log.source}] ${log.message}${data}`;
    }).join('\n\n');

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cocoon-logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copySelected() {
    const logs = filteredLogs().filter(log => selectedIds.has(log.id));
    if (logs.length === 0) return;

    const text = logs.map(log => {
      const time = new Date(log.timestamp).toISOString();
      const data = log.data ? `\n    ${typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)}` : '';
      return `[${time}] [${log.level.toUpperCase()}] [${log.source}] ${log.message}${data}`;
    }).join('\n\n');

    await navigator.clipboard.writeText(text);
  }

  function handleLogClick(e: MouseEvent, logId: string) {
    const logs = filteredLogs();
    const filteredIds = logs.map(l => l.id);
    const clickedIndex = filteredIds.indexOf(logId);

    if (e.shiftKey && lastClickedId) {
      // Shift+click: range select
      const lastIndex = filteredIds.indexOf(lastClickedId);
      if (lastIndex !== -1 && clickedIndex !== -1) {
        const start = Math.min(lastIndex, clickedIndex);
        const end = Math.max(lastIndex, clickedIndex);
        const newSet = new Set(selectedIds);
        for (let i = start; i <= end; i++) {
          newSet.add(filteredIds[i]);
        }
        selectedIds = newSet;
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+click: toggle single item
      const newSet = new Set(selectedIds);
      if (newSet.has(logId)) {
        newSet.delete(logId);
      } else {
        newSet.add(logId);
      }
      selectedIds = newSet;
      lastClickedId = logId;
    } else {
      // Regular click: toggle selection
      if (selectedIds.has(logId) && selectedIds.size === 1) {
        selectedIds = new Set();
        lastClickedId = null;
      } else {
        selectedIds = new Set([logId]);
        lastClickedId = logId;
      }
    }
  }

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  async function exportDb() {
    await downloadLogsDb();
  }
</script>

{#if import.meta.env.DEV}
<div class="min-h-screen bg-zinc-900 text-zinc-100 font-mono text-sm">
  <!-- Header -->
  <div class="sticky top-0 bg-zinc-800 border-b border-zinc-700 p-3 flex items-center gap-4 flex-wrap">
    <h1 class="font-bold text-base">Cocoon Logs</h1>

    <!-- Level filters -->
    <div class="flex gap-1">
      {#each ['debug', 'info', 'warn', 'error'] as level}
        <button
          onclick={() => toggleLevel(level as LogLevel)}
          class="px-2 py-1 rounded text-xs uppercase font-medium transition-colors
            {activeLevels.has(level as LogLevel) ? 'bg-zinc-600' : 'bg-zinc-700 opacity-50'}"
          style="color: {levelColors[level as LogLevel]}"
        >
          {level}
        </button>
      {/each}
    </div>

    <!-- Search -->
    <input
      type="text"
      bind:value={searchQuery}
      placeholder="Search..."
      class="px-3 py-1.5 bg-zinc-700 border border-zinc-600 rounded text-sm w-48 focus:outline-none focus:border-zinc-500"
    />

    <!-- Stats -->
    <span class="text-zinc-400 text-xs">{filteredLogs().length} of {allLogs.length} logs</span>

    <!-- Actions -->
    <div class="ml-auto flex gap-2">
      {#if selectedCount > 0}
        <button
          onclick={copySelected}
          class="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700"
        >
          Copy ({selectedCount})
        </button>
      {/if}
      <button
        onclick={() => loadLogs()}
        class="px-3 py-1.5 bg-zinc-600 text-white rounded text-xs font-medium hover:bg-zinc-500"
      >
        Refresh
      </button>
      <button
        onclick={exportLogs}
        class="px-3 py-1.5 bg-zinc-600 text-white rounded text-xs font-medium hover:bg-zinc-500"
      >
        Export
      </button>
      <button
        onclick={exportDb}
        class="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700"
      >
        Export DB
      </button>
      <button
        onclick={clearLogs}
        class="px-3 py-1.5 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700"
      >
        Clear
      </button>
    </div>
  </div>

  <!-- Logs -->
  <div class="p-2">
    {#if filteredLogs().length === 0}
      <div class="text-center text-zinc-500 py-12">No logs yet</div>
    {:else}
      {#each filteredLogs() as log}
        <div
          onclick={(e) => handleLogClick(e, log.id)}
          class="p-3 border-b border-zinc-800/60 cursor-pointer transition-colors select-none
            {selectedIds.has(log.id)
              ? 'bg-blue-950/40'
              : 'hover:bg-zinc-800/30'}"
        >
          <div class="flex items-start gap-2">
            <span class="text-zinc-500 shrink-0">{formatTime(log.timestamp)}</span>
            <span class="font-bold shrink-0 uppercase text-xs" style="color: {levelColors[log.level]}">{log.level}</span>
            <span class="text-zinc-400 shrink-0">{log.source}</span>
            <span class="text-zinc-100">{log.message}</span>
          </div>
          {#if log.data !== undefined}
            {@const dataStr = typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)}
            {@const isLong = dataStr.length >= 80 || dataStr.includes('\n')}
            {#if isLong}
              <pre class="mt-2 ml-4 p-2 text-xs text-zinc-400 bg-zinc-950 border border-zinc-800/40 rounded max-h-48 overflow-y-auto overflow-x-auto whitespace-pre-wrap">{dataStr}</pre>
            {:else}
              <span class="ml-2 text-xs text-zinc-400">{dataStr}</span>
            {/if}
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>
{/if}

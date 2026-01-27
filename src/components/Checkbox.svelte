<script lang="ts">
  type Props = {
    checked: boolean;
    onchange?: (checked: boolean) => void;
    label?: string;
    description?: string;
  };

  let { checked = $bindable(), onchange, label, description }: Props = $props();

  function toggle() {
    checked = !checked;
    onchange?.(checked);
  }
</script>

<button
  type="button"
  role="checkbox"
  aria-checked={checked}
  onclick={toggle}
  class="group flex items-start gap-3 cursor-pointer text-left w-full"
>
  <span
    class="
      relative flex-shrink-0 w-5 h-5 mt-0.5
      rounded border-2 transition-colors
      {checked
        ? 'bg-cocoon-accent border-cocoon-accent'
        : 'bg-transparent border-cocoon-border group-hover:border-cocoon-accent'}
    "
  >
    {#if checked}
      <svg
        class="absolute inset-0 w-full h-full text-cocoon-accent-fg p-0.5"
        viewBox="0 0 16 16"
        fill="none"
      >
        <path
          d="M3.5 8.5L6.5 11.5L12.5 4.5"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    {/if}
  </span>
  {#if label || description}
    <span class="flex flex-col">
      {#if label}
        <span class="text-sm font-medium text-cocoon-text">{label}</span>
      {/if}
      {#if description}
        <span class="text-xs text-cocoon-muted">{description}</span>
      {/if}
    </span>
  {/if}
</button>

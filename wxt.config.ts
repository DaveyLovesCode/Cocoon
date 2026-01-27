import { defineConfig } from 'wxt';
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: ({ browser }) => {
    const base = {
      name: "Cocoon",
      description: "Filter X/Twitter with AI. Set your interests once, hide the noise automatically. Free to get started.",
      homepage_url: "https://cocoon.surf",
      permissions: ["storage", "activeTab"],
      host_permissions: ["<all_urls>"],
      action: {
        default_icon: {
          16: "icon/icon16.png",
          48: "icon/icon48.png",
          128: "icon/icon128.png",
        },
      },
      options_ui: {
        open_in_tab: true,
      },
    };

    if (browser === 'firefox') {
      // Firefox: Use webRequest for full blocking power
      return {
        ...base,
        permissions: [...(base.permissions || []), "webRequest", "webRequestBlocking"],
      };
    } else {
      // Chrome: Use declarativeNetRequest (MV3 requirement)
      return {
        ...base,
        permissions: [...(base.permissions || []), "declarativeNetRequest"],
      };
    }
  },
  hooks: {
    'build:manifestGenerated': (wxt, manifest) => {
      // Inject hide.css at document_start - must be in manifest for early injection
      // The JS is handled by WXT from hide-immediate.content.ts
      const hideImmediateEntry = manifest.content_scripts?.find(
        (cs: { js?: string[] }) => cs.js?.some((j: string) => j.includes('hide-immediate'))
      );
      if (hideImmediateEntry) {
        hideImmediateEntry.css = ['content-scripts/hide.css'];
      }

      // Remove dev-only content scripts from production builds
      if (wxt.config.mode === 'production') {
        manifest.content_scripts = manifest.content_scripts?.filter(
          (cs: { js?: string[] }) => !cs.js?.some((j: string) =>
            j.includes('picker') || j.includes('tweet-collector')
          )
        );
      }
    },
  },
  vite: () => ({
    plugins: [
      wasm(),
      topLevelAwait(),
    ],
    define: {
      __LOG_HUB_PORT__: JSON.stringify(process.env.LOG_HUB_PORT || null),
    },
  }),
  runner: {
    disabled: true
  }
});

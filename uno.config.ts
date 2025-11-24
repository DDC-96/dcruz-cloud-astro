// uno.config.ts
import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetTypography,
  presetUno,
  presetWebFonts,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss'

export default defineConfig({
  shortcuts: [
    {
      'new-indicator': 'inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-red-500/50 bg-red-500/10',
      'new-dot': 'w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse',
      'new-text': 'text-red-500 dark:text-red-400 text-xs font-bold uppercase tracking-wide',
      // Compact version
      'new-indicator-compact': 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-red-500 bg-red-500/10 flex-shrink-0',
    },
  ],
  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons({
      scale: 1.2,
      prefix: 'i-',
      extraProperties: {
        display: 'inline-block',
      },
    }),
    presetTypography(),
    presetWebFonts({
      fonts: {
        sans: 'Inter:400,600,800',
        mono: 'DM Mono:400,600',
      },
    }),
  ],
  transformers: [transformerDirectives(), transformerVariantGroup()],
  safelist: [
    'i-ri-file-list-2-line',
    'i-carbon-campsite',
    'i-simple-icons-github',
    'i-simple-icons-x',
    'i-simple-icons-linkedin',
    'i-simple-icons-instagram',
    'i-simple-icons-youtube',
    'i-simple-icons-bilibili',
    'i-simple-icons-zhihu',
    'i-simple-icons-sinaweibo',
    'i-ri-github-line',
    'i-ri-twitter-x-line',
    'animate-fade-in',
    // Add line-clamp utilities to safelist
    'line-clamp-2',
    'line-clamp-3',
    'text-truncate',
    'post-title',
  ],
  theme: {
    lineClamp: {
      2: '2',
      3: '3',
    },
  },
})

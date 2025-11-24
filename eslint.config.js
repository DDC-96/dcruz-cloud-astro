// eslint.config.js
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    vue: true,
    typescript: true,
    astro: true,
    formatters: {
      astro: true,
      css: true,
    },
  },
  // extra flat config block: override rules for Markdown files
  {
    files: ['**/*.md'],
    rules: {
      'style/no-tabs': 'off',
      // depending on the base config, this may also be present:
      'no-tabs': 'off',
    },
  },
)

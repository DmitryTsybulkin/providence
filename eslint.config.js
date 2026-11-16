import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Hard rule: only apps/web/src/chart/ may import the chart library (architecture §4).
    files: ['**/*.{ts,tsx}'],
    ignores: ['apps/web/src/chart/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'klinecharts', message: 'Use the ChartEngine interface from apps/web/src/chart instead.' }],
          patterns: [{ group: ['klinecharts/*'], message: 'Use the ChartEngine interface from apps/web/src/chart instead.' }],
        },
      ],
    },
  },
)

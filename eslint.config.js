import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.venv/**',
      '**/dist/**',
      '**/.output/**',
      '**/.output-e2e/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/.wxt/**',
      '**/coverage/**',
      '**/.superpowers/**',
    ],
  },
  {
    files: ['tests/browser/native-continuation.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        chrome: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
      },
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);

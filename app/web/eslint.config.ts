import css from '@eslint/css';
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    ignores: ['dist'],
  },
  {
    files: ['**/*.{js,ts,tsx}'],
    extends: [eslint.configs.recommended, tseslint.configs.recommended, prettier],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
        },
      ],
    },
  },
  // CSS is only checked against Prettier's format.
  {
    files: ['**/*.css'],
    plugins: { css },
    language: 'css/css',
    extends: [prettier],
  },
]);

import eslintJs from '@eslint/js';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import eslintConfigPrettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/.next/',
      '**/out/',
      '**/*.wasm',
      '**/wasm_exec.js',
      '**/src/generated/',
    ],
  },
  eslintJs.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        globalThis: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        React: 'readonly',
        JSX: 'readonly',
        WebAssembly: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        window: 'readonly',
        document: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLElement: 'readonly',
        MouseEvent: 'readonly',
        Event: 'readonly',
        Node: 'readonly',
        MessageEvent: 'readonly',
        addEventListener: 'readonly',
        removeEventListener: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescriptEslint,
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    rules: {
      'no-unused-vars': 'off',
      'no-console': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },
  {
    files: ['web/src/server/**/*.{ts,tsx,js}'],
    ignores: ['web/src/server/**/*.test.{ts,tsx,js}'],
    rules: {
      'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['extension/src/**/*.{ts,tsx,js}'],
    ignores: ['extension/src/**/*.test.{ts,tsx,js}'],
    rules: {
      'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['confession-cli/bin/**/*.{ts,tsx,js}'],
    ignores: ['confession-cli/bin/**/*.test.{ts,tsx,js}'],
    rules: {
      'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
    },
  },
  // 暫時例外：既有巨檔仍在拆分中，觸及時必須同步縮減行數。
  {
    files: [
      'extension/src/webview.ts',
      'confession-cli/bin/confession.js',
    ],
    rules: {
      'max-lines': 'off',
    },
  },
  eslintConfigPrettier,
];

export default eslintConfig;

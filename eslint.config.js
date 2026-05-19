import globals from 'globals';
import prettier from 'eslint-config-prettier';

// Config conservadora: regras essenciais sem reformatar o código existente.
// Para o código novo em `src/`, podemos endurecer aos poucos.
export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'data/**',
      'previews/**',
      'icons/**',
      'sw.js',
      '.claude/**',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2023,
        L: 'readonly', // Leaflet (global via CDN)
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-var': 'warn',
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart'],
      'no-console': 'off',
    },
  },
  // Para código novo em src/, mantém as mesmas regras; podemos endurecer depois.
  {
    files: ['src/**/*.js'],
    rules: {
      'no-unused-vars': 'error',
    },
  },
  prettier,
];

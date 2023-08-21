module.exports = {
  env: {
    node: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020, // Adjust this based on your project's ECMAScript version
    sourceType: 'module',
    project: 'tsconfig.json'
  },
  ignorePatterns: [
    ".eslintrc.js"
  ],
  plugins: ['@typescript-eslint', 'functional', 'sonarjs'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    "plugin:functional/lite",
    "plugin:sonarjs/recommended",
    // Add more extensions or plugins as needed
  ],
  rules: {
    // Your custom linting rules go here
    '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: false, allowTernary: false }],
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',

    'functional/no-return-void': 'off',
    'functional/prefer-immutable-types': 'off',
    'functional/prefer-readonly-type': 'error',

    'sonarjs/no-ignored-return': 'error',
  },
};

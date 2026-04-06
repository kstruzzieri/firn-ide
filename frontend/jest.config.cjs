/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.svg$': '<rootDir>/src/__mocks__/svgMock.js',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^\\.\\./\\.\\./\\.\\./wailsjs/runtime$': '<rootDir>/src/__mocks__/wailsRuntime.js',
    '^\\.\\./\\.\\./wailsjs/runtime$': '<rootDir>/src/__mocks__/wailsRuntime.js',
    '^\\.\\./\\.\\./wailsjs/runtime/runtime$': '<rootDir>/src/__mocks__/wailsRuntime.js',
    '^\\.\\./\\.\\./\\.\\./wailsjs/runtime/runtime$': '<rootDir>/src/__mocks__/wailsRuntime.js',
    '^\\.\\./\\.\\./\\.\\./\\.\\./wailsjs/runtime/runtime$': '<rootDir>/src/__mocks__/wailsRuntime.js',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  testMatch: ['**/__tests__/**/*.test.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/main.tsx',
    '!src/vite-env.d.ts',
    '!src/wailsjs/**',
  ],
  coverageThreshold: {
    global: {
      branches: 20,
      functions: 40,
      lines: 40,
      statements: 40,
    },
  },
};

import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 20000,
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/tests/jest.setup.js', '<rootDir>/src/tests/closeCache.ts'],
  moduleFileExtensions: ['ts', 'js', 'cjs', 'json', 'node'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          module: 'esnext',
          moduleResolution: 'bundler',
        },
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
  moduleNameMapper: {
    // Correct pattern - strips .js so Jest finds the .ts source file
    '^(./|../)(.*)\\.js$': '$1$2',
  },
};

export default config;

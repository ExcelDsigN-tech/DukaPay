import type { Config } from 'jest';

const baseConfig = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/src/tests/jest.setup.js', '<rootDir>/src/tests/closeCache.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
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
  moduleNameMapper: {
    // Correct pattern - strips .js so Jest finds the .ts source file
    '^(./|../)(.*)\\.js$': '$1$2',
  },
};

const config: Config = {
  projects: [
    {
      ...baseConfig,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.spec.ts'],
      testPathIgnorePatterns: [
        'database\\.test\\.ts$',
        'score\\.integration\\.test\\.ts$',
        'loanDisputesSchema\\.test\\.ts$',
        'migration\\.test\\.ts$',
        'scoresService\\.test\\.ts$',
      ],
    },
    {
      ...baseConfig,
      displayName: 'db',
      runner: '<rootDir>/src/tests/serialRunner.cjs',
      testMatch: [
        '<rootDir>/src/__tests__/database.test.ts',
        '<rootDir>/src/__tests__/integration/score.integration.test.ts',
        '<rootDir>/src/__tests__/loanDisputesSchema.test.ts',
        '<rootDir>/src/__tests__/migration.test.ts',
        '<rootDir>/src/__tests__/scoresService.test.ts',
      ],
    },
  ],
};

export default config;

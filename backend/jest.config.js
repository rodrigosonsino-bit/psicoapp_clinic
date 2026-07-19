module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/server.ts',
    '!src/runMigrations.ts',
    '!src/infrastructure/repositories/**',
    '!src/scripts/**',
    '!src/**/__tests__/**',
  ],
  coverageThreshold: {
    global: {
      branches: 40,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/__tests__/.*/helpers/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@whiskeysockets/baileys$': '<rootDir>/src/mocks/baileysMock.ts',
    '^otplib$': '<rootDir>/src/mocks/otplibMock.ts',
  },
  clearMocks: true,
};

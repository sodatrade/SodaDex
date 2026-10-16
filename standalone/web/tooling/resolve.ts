import { fileURLToPath, URL } from 'node:url'

export const local = (path: string): string => fileURLToPath(new URL(path, new URL('../', import.meta.url)))

// Shared upstream source resolves against this application's isolated dependencies.
export const resolveOptions = {
  alias: [
    { find: '@universe/mycelium/styled', replacement: local('../../packages/mycelium/src/styled/index.ts') },
    { find: '@universe/tailwind/types', replacement: local('../../packages/tailwind/src/types.ts') },
    { find: '@universe/tailwind', replacement: local('../../packages/tailwind/src/index.ts') },
    { find: /^react$/, replacement: local('./node_modules/react/index.js') },
    { find: 'react/jsx-runtime', replacement: local('./node_modules/react/jsx-runtime.js') },
    { find: 'react/jsx-dev-runtime', replacement: local('./node_modules/react/jsx-dev-runtime.js') },
    {
      find: /^class-variance-authority$/,
      replacement: local('./node_modules/class-variance-authority/dist/index.mjs'),
    },
    { find: /^clsx$/, replacement: local('./node_modules/clsx/dist/clsx.mjs') },
    { find: /^tailwind-merge$/, replacement: local('./node_modules/tailwind-merge/dist/bundle-mjs.mjs') },
  ],
  dedupe: ['react', 'react-dom'],
}

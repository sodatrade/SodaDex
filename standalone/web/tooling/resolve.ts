import { fileURLToPath, URL } from 'node:url'

export const local = (path: string): string => fileURLToPath(new URL(path, new URL('../', import.meta.url)))

export const resolveOptions = {
  alias: [{ find: /^\$lib/, replacement: local('./src/lib') }],
}

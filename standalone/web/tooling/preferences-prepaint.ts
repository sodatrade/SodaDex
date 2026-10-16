import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'
import { DEFAULT_PREFERENCES, LOCALES, PREFERENCES_KEY, THEMES } from '../src/preferences/model'

/** Only validated enum values reach DOM attributes. Storage contents never become executable code. */
export function preferencesPrepaint(): Plugin {
  const defaults = JSON.stringify(DEFAULT_PREFERENCES)
  const script = `(()=>{const d=${defaults},r=document.documentElement;r.dataset.theme=d.theme;r.lang=d.locale;try{const p=JSON.parse(localStorage.getItem(${JSON.stringify(PREFERENCES_KEY)})||'null');if(p&&typeof p==='object'&&!Array.isArray(p)){if(${JSON.stringify(THEMES)}.includes(p.theme))r.dataset.theme=p.theme;if(${JSON.stringify(LOCALES)}.includes(p.locale))r.lang=p.locale}}catch{}})();`
  const hash = `sha256-${createHash('sha256').update(script).digest('base64')}`
  return {
    name: 'sodadex-preferences-prepaint',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        {
          tag: 'style',
          injectTo: 'head-prepend',
          children:
            'html{background:#f2f4e9;color-scheme:light}html[data-theme="dark"]{background:#101310;color-scheme:dark}',
        },
        { tag: 'script', injectTo: 'head-prepend', children: script },
      ],
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'preferences-script.json', source: `${JSON.stringify({ hash })}\n` })
    },
  }
}

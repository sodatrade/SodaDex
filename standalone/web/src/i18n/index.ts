import type { Locale } from '../preferences/model'
import { en } from './en'
import type { MessageKey, Messages, Translate, TranslateArgs } from './types'
import { yueHK } from './yue-HK'
import { zhCN } from './zh-CN'
const messages: Record<Locale, Messages> = { 'zh-CN': zhCN, en, 'yue-HK': yueHK }
export function translator(locale: Locale): Translate {
  return <Key extends MessageKey>(key: Key, ...args: TranslateArgs<Key>): string => {
    let value = messages[locale][key]
    for (const [name, replacement] of Object.entries(args[0] ?? {})) {
      value = value.replaceAll(`{${name}}`, String(replacement))
    }
    return value
  }
}

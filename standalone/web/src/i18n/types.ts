import type { zhCN } from './zh-CN'
export type MessageKey = keyof typeof zhCN
export type Messages = Record<MessageKey, string>
type Slots<Text extends string> = Text extends `${string}{${infer Slot}}${infer Rest}` ? Slot | Slots<Rest> : never
export type TranslateArgs<Key extends MessageKey> = [Slots<(typeof zhCN)[Key]>] extends [never]
  ? [params?: never]
  : [params: Record<Slots<(typeof zhCN)[Key]>, string | number>]
export type Translate = <Key extends MessageKey>(key: Key, ...args: TranslateArgs<Key>) => string

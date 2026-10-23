/** Display only: 0.0000000001 → 0.0₉1. Inputs and transaction amounts remain exact decimals. */
export function compactTinyDecimal(decimal: string, significantDigits = 6): string | undefined {
  const match = /^(-?)0\.(0{5,})([1-9]\d*)$/.exec(decimal)
  if (!match) return undefined
  const subscript = String(match[2].length).replace(/\d/g, digit => '₀₁₂₃₄₅₆₇₈₉'[Number(digit)])
  return `${match[1]}0.0${subscript}${match[3].slice(0, significantDigits).replace(/0+$/, '')}`
}

/** Chart values are approximate numbers; balances must use compactTinyDecimal with exact strings. */
export function compactMarketNumber(value: number, locale?: string, significantDigits = 6): string {
  const decimal = value.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: significantDigits })
  return compactTinyDecimal(decimal, significantDigits) ?? value.toLocaleString(locale, { maximumSignificantDigits: significantDigits })
}

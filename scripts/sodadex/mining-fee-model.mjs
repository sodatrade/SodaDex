// OP system ABI: fee parameters live in L1Block, not GasPriceOracle.
// Both local acceptance and public execution use this same read-only check.
const ORACLE = '0x420000000000000000000000000000000000000f'
const L1_BLOCK = '0x4200000000000000000000000000000000000015'

export async function assertMiningFeeParameters(plan, bytes, gas) {
  if (await plan.call(ORACLE, 'function isFjord() view returns(bool)') !== true ||
    await plan.call(ORACLE, 'function isIsthmus() view returns(bool)') !== true ||
    BigInt(await plan.call(L1_BLOCK, 'function operatorFeeScalar() view returns(uint32)')) !== 0n ||
    await plan.call(L1_BLOCK, 'function operatorFeeConstant() view returns(uint64)') !== 0n ||
    await plan.call(ORACLE, 'function getL1FeeUpperBound(uint256) view returns(uint256)', [bytes]) !== 0n ||
    await plan.call(ORACLE, 'function getOperatorFee(uint256) view returns(uint256)', [gas]) !== 0n)
    throw new Error('Fee model or price changed: stop and refresh the full budget')
}

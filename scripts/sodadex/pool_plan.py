"""Approved tiny X Layer pool phase: integer math and exact protocol encodings.

No RPC, wallet, signing or filesystem state is owned by this module.
"""
from math import isqrt
from datetime import datetime
import re
import subprocess

CHAIN = 196
RPC_URL = 'https://rpc.ignix.bot/rpc/196'
ZERO = '0x' + '00' * 20
STABLE = '0x779Ded0c9e1022225f8E0630b35a9b54bE713736'
BUY = 10**14
LP_NATIVE = 49 * 10**12
FORWARD = 10**12
REVERSE = 100
PRINCIPAL_CAP = 2 * 10**14
GAS_CAP = 5 * 10**14
SLIPPAGE_BPS = 50
# apps/web/src/constants/misc.ts DEFAULT_DEADLINE_FROM_NOW.
DEADLINE_SECONDS = 600
MIN_SQRT = 4295128739
MAX_SQRT = 1461446703485210103287273052203988822378723970342
Q96 = 1 << 96
LOWER, UPPER = -887272, 887272
STEPS = ('seed', 'approveV3', 'approvePermit2', 'permitV4LP', 'permitRouter',
         'mintV3', 'mintV4', 'v3Forward', 'v3Reverse', 'v4Forward', 'v4Reverse')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def number(value):
    return int(value, 0) if isinstance(value, str) else int(value)


def ceil_div(numerator, denominator):
    require(numerator >= 0 and denominator > 0, 'Invalid unsigned division')
    return (numerator + denominator - 1) // denominator


def min_output(quote):
    require(quote > 0, 'Zero quote cannot be traded')
    result = ceil_div(quote * (10000 - SLIPPAGE_BPS), 10000)
    require(result > 0, 'Zero minimum output')
    return result


def sqrt_price(numerator, denominator):
    require(numerator > 0 and denominator > 0, 'Invalid market ratio')
    result = isqrt((numerator << 192) // denominator)
    require(MIN_SQRT <= result < MAX_SQRT, 'Market price outside protocol bounds')
    return result


def full_range(sqrt, amount0, amount1):
    """LiquidityAmounts.getLiquidityForAmounts, plus pool mint round-up amounts."""
    require(MIN_SQRT < sqrt < MAX_SQRT, 'Price must be inside full range')
    l0 = amount0 * ((sqrt * MAX_SQRT) // Q96) // (MAX_SQRT - sqrt)
    l1 = amount1 * Q96 // (sqrt - MIN_SQRT)
    liquidity = min(l0, l1)
    actual0 = ceil_div(liquidity * Q96 * (MAX_SQRT - sqrt), MAX_SQRT * sqrt)
    actual1 = ceil_div(liquidity * (sqrt - MIN_SQRT), Q96)
    require(0 < liquidity < 1 << 128 and 0 < actual0 <= amount0 and 0 < actual1 <= amount1,
            'Rounded LP allocation invalid')
    return {'liquidity': liquidity, 'amount0': actual0, 'amount1': actual1}


def cast(*args):
    result = subprocess.run(['cast', *map(str, args)], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'cast {args[0]} failed; arguments omitted')
    return result.stdout.strip()


def abi(types, *args):
    return cast('abi-encode', 'f(' + types + ')', *args)


def calldata(signature, *args):
    return cast('calldata', signature, *args)


def array(items):
    return '[' + ','.join(map(str, items)) + ']'


def key(config):
    return f'({ZERO},{STABLE},0,1,{ZERO})'


def pool_id(config):
    return cast('keccak', abi('(address,address,uint24,int24,address)', key(config)))


def validate_config(config):
    require(config['phase'] == 'test' and config['chainId'] == CHAIN and config['rpcUrl'] == RPC_URL,
            'Only the authorized X Layer test deployment is supported')
    require(config['status'] == 'deployed-and-verified' and len(config['contracts']) == 12,
            'Verified deployed contracts required')
    require(int(STABLE, 16) < int(config['wrappedNative'], 16), 'Unexpected V3 token order')
    require(config['requestedFees']['v3PoolFee'] == 100 and config['requestedFees']['v3TickSpacing'] == 1
            and config['requestedFees']['v4PoolFee'] == 0 and config['requestedFees']['v4Hooks'] == ZERO,
            'Fee configuration changed')
    require(BUY + 2 * LP_NATIVE + 2 * FORWARD == PRINCIPAL_CAP, 'Gross principal allocation invalid')


def validate_seed(seed, config, timestamp, block):
    require(seed['chainId'] == CHAIN and seed['owner'].lower() == config['owner'].lower(), 'Seed target mismatch')
    require(number(seed['fromAmount']) == BUY and number(seed['tx']['value']) == BUY, 'Seed principal changed')
    created = datetime.fromisoformat(seed['createdAt']).timestamp() if isinstance(seed['createdAt'], str) and 'T' in seed['createdAt'] else number(seed['createdAt'])
    require(0 <= timestamp - created <= DEADLINE_SECONDS, 'Seed route is stale')
    require(number(seed['quoteBlock']) <= block, 'Seed quote block is in the future')
    require(number(seed['minReceiveAmount']) >= min_output(number(seed['toAmount'])), 'Seed slippage exceeds 0.5%')
    require(number(seed['minReceiveAmount']) > 2 * REVERSE, 'Seed output too small for both pools')
    require(re.fullmatch(r'0x[0-9a-fA-F]{40}', seed['tx']['to']) is not None
            and seed['tx']['to'].lower() != ZERO and re.fullmatch(r'0x[0-9a-fA-F]+', seed['tx']['data']) is not None,
            'Invalid seed transaction')
    require(re.fullmatch(r'[0-9a-f]{64}', seed['routerCodeSha256']) is not None, 'Missing seed router runtime pin')
    # Official okxlabs/Web3-DEX-Router-EVM-V1 @ 1fc1508df3caeb18a8179dfc0ea4e956099ab481:
    # dagSwapByOrderId(uint256,BaseRequest,RouterPath[]) sets receiver=msg.sender.
    require(seed['tx']['to'].lower() == '0x7c5bee2a8091c3ef39072f64f18fac913060aeaf'
            and seed['routerCodeSha256'] == '4e884ab2966a335f3462791c91acc1819a2209ec2ace1716e3498463ccb0a1ce',
            'Seed router is not the verified current OKX router')
    data = seed['tx']['data'][2:]
    require(data[:8].lower() == 'f2c42696' and len(data) >= 8 + 7 * 64, 'Unknown seed function')
    words = [int(data[8+i*64:8+(i+1)*64], 16) for i in range(7)]
    require(words[1] == int('ee' * 20, 16) and words[2] == int(STABLE, 16)
            and words[3] == BUY and words[4] == number(seed['minReceiveAmount'])
            and timestamp < words[5] and words[6] == 7 * 32, 'Seed calldata assets/amount/minimum/deadline mismatch')
    require(not seed['tx'].get('from') or seed['tx']['from'].lower() == config['owner'].lower(), 'Seed sender mismatch')


def context(seed):
    # Reserve both reverse inputs even if the seed fills at its minimum output.
    stable_cap = (number(seed['minReceiveAmount']) - 2 * REVERSE) // 2
    sqrt3 = sqrt_price(BUY, number(seed['toAmount']))
    sqrt4 = sqrt_price(number(seed['toAmount']), BUY)
    return {'stableCap': stable_cap, 'sqrt3': sqrt3, 'sqrt4': sqrt4,
            'lp3': full_range(sqrt3, stable_cap, LP_NATIVE),
            'lp4': full_range(sqrt4, LP_NATIVE, stable_cap)}


def build(name, config, seed, ctx, deadline, quote=None):
    """Return a complete deterministic semantic intent; deadlines are explicit."""
    require(name in STEPS, 'Unknown pool phase step')
    c, owner, permit = config['contracts'], config['owner'], config['permit2']
    native, wrapped, stable_cap = ZERO, config['wrappedNative'], ctx['stableCap']
    intent = {'name': name, 'value': 0, 'deadline': deadline}
    if name == 'seed':
        return {**intent, 'to': seed['tx']['to'], 'data': seed['tx']['data'], 'value': BUY,
                'minOutput': number(seed['minReceiveAmount'])}
    if name in ('approveV3', 'approvePermit2'):
        spender = c['v3PositionManager'] if name == 'approveV3' else permit
        amount = stable_cap if name == 'approveV3' else stable_cap + 2 * REVERSE
        return {**intent, 'to': STABLE, 'data': calldata('approve(address,uint256)', spender, amount), 'approvalAmount': amount}
    if name in ('permitV4LP', 'permitRouter'):
        spender = c['v4PositionManager'] if name == 'permitV4LP' else c['universalRouter']
        amount = stable_cap if name == 'permitV4LP' else 2 * REVERSE
        return {**intent, 'to': permit, 'data': calldata('approve(address,address,uint160,uint48)', STABLE, spender, amount, deadline),
                'approvalAmount': amount}
    if name == 'mintV3':
        lp = ctx['lp3']
        init = calldata('createAndInitializePoolIfNecessary(address,address,uint24,uint160)', STABLE, wrapped, 100, ctx['sqrt3'])
        params = f'({STABLE},{wrapped},100,{LOWER},{UPPER},{stable_cap},{LP_NATIVE},{min_output(lp["amount0"])},{min_output(lp["amount1"])},{owner},{deadline})'
        mint = calldata('mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))', params)
        return {**intent, 'to': c['v3PositionManager'], 'value': LP_NATIVE,
                'data': calldata('multicall(bytes[])', array([init, mint, calldata('refundETH()')]))}
    if name == 'mintV4':
        mint = abi('(address,address,uint24,int24,address),int24,int24,uint256,uint128,uint128,address,bytes',
                   key(config), LOWER, UPPER, ctx['lp4']['liquidity'], LP_NATIVE, stable_cap, owner, '0x')
        settle = abi('address,address', native, STABLE)
        sweep = abi('address,address', native, owner)
        unlock = abi('bytes,bytes[]', '0x020d14', array([mint, settle, sweep]))
        modify = calldata('modifyLiquidities(bytes,uint256)', unlock, deadline)
        init = calldata('initializePool((address,address,uint24,int24,address),uint160)', key(config), ctx['sqrt4'])
        return {**intent, 'to': c['v4PositionManager'], 'value': LP_NATIVE,
                'data': calldata('multicall(bytes[])', array([init, modify]))}
    require(quote is not None and quote > 0, 'Fresh exact-input quote required')
    forward = name.endswith('Forward')
    amount, minimum = (FORWARD if forward else REVERSE), min_output(quote)
    if name.startswith('v3'):
        first, last = (wrapped, STABLE) if forward else (STABLE, wrapped)
        path = first + '000064' + last[2:]
        swap = abi('address,uint256,uint256,bytes,bool,uint256[]',
                   owner if forward else '0x' + '00' * 19 + '02', amount, minimum, path,
                   'false' if forward else 'true', '[]')
        unwrap = abi('address,uint256', owner, 0 if forward else minimum)
        sweep = abi('address,address,uint256', native, owner, 0)
        inputs = [swap, unwrap, sweep]
        commands = '0x000c04'
        if forward:
            inputs.insert(0, abi('address,uint256', '0x' + '00' * 19 + '02', amount))
            commands = '0x0b000c04'
    else:
        currency_in, currency_out = (native, STABLE) if forward else (STABLE, native)
        single = abi('((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)',
                     f'({key(config)},{str(forward).lower()},{amount},{minimum},0,0x)')
        swap_params = [single, abi('address,uint256', currency_in, amount), abi('address,uint256', currency_out, minimum)]
        inputs = [abi('bytes,bytes[]', '0x060c0f', array(swap_params)), abi('address,address,uint256', native, owner, 0)]
        commands = '0x1004'
    return {**intent, 'to': c['universalRouter'], 'data': calldata('execute(bytes,bytes[],uint256)', commands, array(inputs), deadline),
            'value': amount if forward else 0, 'amountIn': amount, 'quotedOutput': quote, 'minOutput': minimum}


def quote_calldata(name, config):
    forward = name.endswith('Forward')
    amount = FORWARD if forward else REVERSE
    if name.startswith('v3'):
        a, b = (config['wrappedNative'], STABLE) if forward else (STABLE, config['wrappedNative'])
        return config['contracts']['v3Quoter'], calldata('quoteExactInputSingle((address,address,uint256,uint24,uint160))', f'({a},{b},{amount},100,0)')
    return config['contracts']['v4Quoter'], calldata('quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))',
                                                 f'({key(config)},{str(forward).lower()},{amount},0x)')

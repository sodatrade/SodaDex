"""Bounded SodaDEX branding continuation: artifacts, intents and spending policy.

This module never accesses a wallet, signs a transaction, or mutates a chain.
Original pool/deployment plans remain immutable inputs to this new phase.
"""
import copy
import json
import re
from decimal import Decimal
from pathlib import Path

import pool_plan as pool
from pool_chain import sha, old

require, number = pool.require, pool.number
DEPLOYS = ('v3NFTDescriptor', 'v3TokenDescriptor', 'v3PositionManager',
           'v4Descriptor', 'v4PositionManager', 'universalRouter')
CALLS = ('revokeOldV3', 'approveV3', 'resetPermit2', 'approvePermit2',
         'permitV4LP', 'mintV3', 'mintV4', 'v3Forward', 'permitRouter',
         'v3Reverse', 'v4Forward', 'v4Reverse')
STEPS = DEPLOYS + CALLS
PRIOR_NAMES = ('seed', 'approveV3', 'approvePermit2')
MARKET_ROUTER = '0x7c5bee2a8091c3ef39072f64f18fac913060aeaf'
MARKET_ROUTER_SHA = '4e884ab2966a335f3462791c91acc1819a2209ec2ace1716e3498463ccb0a1ce'
SOURCE_FILES = ('brand-phase.py', 'brand_plan.py', 'brand_chain.py', 'pool_plan.py',
                'pool_chain.py', 'deploy-xlayer-test.py', 'rehearse-xlayer-test.py')


def gas_wei(text):
    amount = Decimal(text) * 10**18
    require(amount.is_finite() and amount > 0 and amount == amount.to_integral_value(), 'Invalid approved gas cap')
    return int(amount)


def policy(cap=pool.GAS_CAP):
    return {'gasCapWei': cap, 'grossPrincipalCapWei': pool.PRINCIPAL_CAP,
            'priorSeedPrincipalWei': pool.BUY, 'newSeedPurchasesAllowed': False,
            'slippageBps': pool.SLIPPAGE_BPS, 'deadlineSeconds': pool.DEADLINE_SECONDS,
            'lpNativeCapEachWei': pool.LP_NATIVE, 'forwardNativeEachWei': pool.FORWARD,
            'reverseStableEachRaw': pool.REVERSE, 'productionDeployment': 'deferred'}


def load_artifacts(path):
    manifest_bytes = path.read_bytes()
    manifest = json.loads(manifest_bytes)
    entries = manifest['artifacts']
    require(set(entries) == set(DEPLOYS), 'Expected exactly six branding artifacts')
    artifacts = {}
    for name in DEPLOYS:
        entry = entries[name]
        file = (path.parent / entry['path']).resolve()
        require(file.is_relative_to(path.parent.resolve()), 'Artifact path escapes build directory')
        raw = file.read_bytes()
        require(sha(raw) == entry['artifactSha256'], 'Brand artifact file changed')
        data = json.loads(raw)
        code = data['bytecode']['object'].removeprefix('0x')
        runtime = data['deployedBytecode']['object'].removeprefix('0x')
        require(sha(code.encode()) == entry['creationObjectSha256']
                and sha(runtime.encode()) == entry['runtimeObjectSha256'], 'Brand artifact bytecode changed')
        require(entry['baselineAbiPreserved'] is True, 'Baseline ABI compatibility proof required')
        require(len(code) // 2 == entry['creationBytes'] and len(runtime) // 2 == entry['runtimeBytes'], 'Artifact length mismatch')
        artifacts[name] = {'path': str(file), 'sha256': sha(raw), 'abi': data['abi'],
            'code': code, 'runtime': runtime, 'links': data['bytecode'].get('linkReferences', {}),
            'runtimeLinks': data['deployedBytecode'].get('linkReferences', {}),
            'immutableReferences': data['deployedBytecode'].get('immutableReferences', {})}
    return manifest, artifacts, sha(manifest_bytes)


def derive_config(original, nonce):
    config = copy.deepcopy(original)
    for index, name in enumerate(DEPLOYS):
        output = pool.cast('compute-address', config['owner'], '--nonce', nonce + index)
        found = re.search(r'0x[0-9a-fA-F]{40}', output)
        require(found is not None, 'Cannot derive CREATE address')
        config['contracts'][name] = found.group()
    return config


def deployment_intent(name, config, artifacts):
    c, wrapped, permit = config['contracts'], config['wrappedNative'], config['permit2']
    label = '0x' + b'OKB'.hex().ljust(64, '0')
    constructors = {'v3NFTDescriptor': [], 'v3TokenDescriptor': [wrapped, label],
        'v3PositionManager': [c['v3Factory'], wrapped, c['v3TokenDescriptor']],
        'v4Descriptor': [c['v4PoolManager'], wrapped, label],
        'v4PositionManager': [c['v4PoolManager'], permit, config['v4UnsubscribeGasLimit'], c['v4Descriptor'], wrapped],
        'universalRouter': ['(' + ','.join([permit, wrapped, c['unsupportedProtocol'], c['v3Factory'],
            old.rehearsal.ZERO32, old.rehearsal.POOL_HASH, c['v4PoolManager'],
            c['v3PositionManager'], c['v4PositionManager'], c['unsupportedProtocol']]) + ')']}
    source = artifacts[name]
    # Library identifiers remain the audited Solidity identifiers for ABI/link compatibility.
    data = old.rehearsal.initcode(source, constructors[name], {'NFTDescriptor': c['v3NFTDescriptor']})
    return {'name': name, 'to': None, 'value': 0, 'data': data,
            'artifactSha256': source['sha256'], 'expectedAddress': c[name]}


def checked_quote(payload):
    require(payload.get('ok') is True and len(payload.get('data', [])) == 1, 'Market quote failed')
    quote = payload['data'][0]
    require(quote.get('action') == 'ok' and not quote.get('reason') and number(quote['chainIndex']) == pool.CHAIN,
            'Market quote not executable on chain 196')
    require(quote['swapMode'] == 'exactIn' and number(quote['fromTokenAmount']) == pool.BUY, 'Market quote amount/mode changed')
    require(quote['fromToken']['tokenContractAddress'].lower() == '0x' + 'ee' * 20
            and number(quote['fromToken']['decimal']) == 18
            and quote['toToken']['tokenContractAddress'].lower() == pool.STABLE.lower()
            and number(quote['toToken']['decimal']) == 6, 'Market quote asset/decimal mismatch')
    return quote


def market_call(response, config, block, code_sha):
    quote, tx = response['routerResult'], response['tx']
    checked_quote({'ok': True, 'data': [quote]})
    require(code_sha == MARKET_ROUTER_SHA and tx['to'].lower() == MARKET_ROUTER,
            'Market reference router changed')
    require(tx['from'].lower() == config['owner'].lower() and number(tx['value']) == pool.BUY,
            'Market reference sender/value changed')
    data = tx['data']
    require(re.fullmatch(r'0xf2c42696(?:[0-9a-fA-F]{2})+', data) and len(data) >= 10 + 7 * 64,
            'Unsupported market reference calldata')
    words = [int(data[10+i*64:10+(i+1)*64], 16) for i in range(7)]
    require(words[1:4] == [int('ee' * 20, 16), int(pool.STABLE, 16), pool.BUY]
            and words[4] == number(tx['minReceiveAmount'])
            and words[4] >= pool.min_output(number(quote['toTokenAmount']))
            and words[5] > number(block['timestamp']) and words[6] == 224,
            'Market reference pair/minimum/deadline changed')
    require(number(quote['contextSlot']) <= number(block['number']), 'Market route block is in the future')
    return {'from': tx['from'], 'to': tx['to'], 'data': data, 'value': hex(pool.BUY)}


def reference_quote(response, config, block, code_sha, result):
    """A new market observation from a pinned-router eth_call, not an API timestamp rewrite."""
    call = market_call(response, config, block, code_sha)
    require(re.fullmatch(r'0x[0-9a-fA-F]{64}', result) is not None, 'Invalid market reference return value')
    require(re.fullmatch(r'0x[0-9a-fA-F]{64}', block['hash']) is not None, 'Invalid market reference block hash')
    output = int(result, 16)
    require(output >= number(response['tx']['minReceiveAmount']) and output > 0, 'Market reference output below minimum')
    require('onchainReference' not in response['routerResult'], 'Recursive market reference prohibited')
    quote = copy.deepcopy(response['routerResult'])
    quote.update(contextSlot=number(block['number']), toTokenAmount=str(output), onchainReference={
        'source': 'pinned-router-eth_call', 'block': block, 'routerCodeSha256': code_sha,
        'call': call, 'returnData': result, 'apiResponse': response})
    return {'ok': True, 'data': [quote]}


def quote_context(payload, config, stable_balance, block, timestamp, *, quote_timestamp):
    quote = checked_quote(payload)
    if 'onchainReference' in quote:
        ref = quote['onchainReference']
        expected = reference_quote(ref['apiResponse'], config, ref['block'], ref['routerCodeSha256'], ref['returnData'])
        require(payload == expected and number(ref['block']['timestamp']) == quote_timestamp,
                'On-chain market reference changed')
    require(number(quote['contextSlot']) <= block, 'Market quote block is in the future')
    require(0 <= timestamp - quote_timestamp <= pool.DEADLINE_SECONDS, 'Market quote block is stale')
    require(stable_balance == 11844, 'Seed stable balance changed before new LP allocation')
    cap = (stable_balance - 2 * pool.REVERSE) // 2
    output = number(quote['toTokenAmount'])
    s3, s4 = pool.sqrt_price(pool.BUY, output), pool.sqrt_price(output, pool.BUY)
    return {'stableCap': cap, 'sqrt3': s3, 'sqrt4': s4,
            'lp3': pool.full_range(s3, cap, pool.LP_NATIVE),
            'lp4': pool.full_range(s4, pool.LP_NATIVE, cap),
            'marketQuote': quote, 'observedBlock': block, 'observedTimestamp': timestamp,
            'quoteBlockTimestamp': quote_timestamp}


def validate_context(ctx, config):
    expected = quote_context({'ok': True, 'data': [ctx['marketQuote']]}, config, 11844,
                             ctx['observedBlock'], ctx['observedTimestamp'], quote_timestamp=ctx['quoteBlockTimestamp'])
    require(ctx == expected, 'Frozen market/allocation context changed')


def build(name, original, config, artifacts, ctx, deadline, quote=None):
    require(name in STEPS, 'Unknown branding continuation step')
    if name in DEPLOYS:
        return deployment_intent(name, config, artifacts)
    if name in ('revokeOldV3', 'resetPermit2'):
        spender = original['contracts']['v3PositionManager'] if name == 'revokeOldV3' else config['permit2']
        return {'name': name, 'to': pool.STABLE, 'value': 0, 'deadline': deadline,
                'data': pool.calldata('approve(address,uint256)', spender, 0), 'approvalAmount': 0}
    require(ctx is not None or name in ('approveV3', 'approvePermit2', 'permitV4LP'), 'Frozen market context required')
    allocation = ctx or {'stableCap': 5822}
    return pool.build(name, config, {}, allocation, deadline, quote)


def budget(rows, remaining, prior, cap, *, balance=None, enforce=True):
    spent = sum(old.receipt_cost(row['receipt']) for row in prior['transactions'])
    spent += sum(old.receipt_cost(row['receipt']) for row in rows if row.get('receipt'))
    pending = [row['unsigned'] for row in rows if not row.get('receipt')] + remaining
    reserve = sum(number(tx['gas']) * number(tx['gasPrice']) for tx in pending)
    gross = pool.BUY + sum(number(row['unsigned']['value']) for row in rows) + sum(number(tx['value']) for tx in remaining)
    require(gross <= pool.PRINCIPAL_CAP, 'Approved gross native principal exceeded; refunds do not add budget')
    if enforce:
        require(spent + reserve <= cap, 'Approved total gas budget exceeded; explicit new approval required')
    if balance is not None:
        require(balance >= reserve + sum(number(tx['value']) for tx in pending), 'Insufficient balance for remaining caps')
    return {'gasSpentWei': spent, 'remainingGasCapWei': reserve, 'maximumTotalGasWei': spent + reserve,
            'approvedGasCapWei': cap, 'needsBudgetApproval': spent + reserve > cap, 'grossPrincipalWei': gross}


def validate_row(row, original, config, artifacts, nonce):
    ctx = row.get('contextAtBuild')
    if ctx is not None:
        validate_context(ctx, config)
    intent = row['intent']
    expected = build(row['name'], original, config, artifacts, ctx, intent.get('deadline'), intent.get('quotedOutput'))
    require(all(intent.get(key) == value for key, value in expected.items()), 'Journal semantic intent changed')
    tx = row['unsigned']
    require(number(tx['chainId']) == pool.CHAIN and tx['from'].lower() == config['owner'].lower()
            and number(tx['nonce']) == nonce and (tx.get('to') or '').lower() == (intent.get('to') or '').lower()
            and tx['data'] == intent['data'] and number(tx['value']) == intent['value'], 'Journal transaction intent changed')
    require(number(tx['gas']) > 0 and number(tx['gasPrice']) > 0, 'Invalid signed gas cap')

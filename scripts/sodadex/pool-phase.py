#!/usr/bin/env python3
"""Rehearse, then explicitly execute the approved tiny chain-196 pool tests.

Default mode is read-only. --rehearse owns an isolated localhost Anvil fork.
Only --execute accesses the encrypted local owner wallet or broadcasts remotely.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import socket
import subprocess
import time

import pool_plan as plan
from pool_chain import (Chain, budgets, cast, make_unsigned, mktx, number, old, oracle_gate,
                        postcondition, require, runtime_gate, save, sha, validate_signed, wait_receipt, receipt,
                        parallel, OFFICIAL_READ_RPC)

ROOT = Path(__file__).resolve().parents[2]
STATE = Path.home() / '.local/share/sodadex/deployments/xlayer-test-pools'
WALLET = Path.home() / '.local/share/sodadex/wallets/xlayer-test-owner'


def read_inputs(args):
    config_bytes = (args.source_root / 'deployments/xlayer-test/plan.json').read_bytes()
    report_bytes = (args.source_root / 'deployments/xlayer-test/receipts.json').read_bytes()
    seed_bytes = args.seed_route.read_bytes()
    config, deployment, seed = map(json.loads, (config_bytes, report_bytes, seed_bytes))
    plan.validate_config(config)
    require(config['contracts'] == deployment['contracts'] and config['owner'].lower() == deployment['owner'].lower(), 'Deployment report/plan mismatch')
    source_hashes = {Path(__file__).with_name(name).name: sha(Path(__file__).with_name(name).read_bytes())
                     for name in ('pool-phase.py', 'pool_plan.py', 'pool_chain.py', 'deploy-xlayer-test.py', 'rehearse-xlayer-test.py')}
    pins = {'configSha256': sha(config_bytes), 'deploymentSha256': sha(report_bytes), 'seedSha256': sha(seed_bytes),
            'sourceSha256': source_hashes, 'policy': {'gasCapWei': plan.GAS_CAP, 'grossPrincipalCapWei': plan.PRINCIPAL_CAP,
            'slippageBps': plan.SLIPPAGE_BPS, 'deadlineSeconds': plan.DEADLINE_SECONDS}}
    return config, deployment, seed, pins


def latest(chain):
    block = chain.rpc('eth_getBlockByNumber', ['latest', False])
    return number(block['number']), number(block['timestamp'])


def fresh_intent(chain, name, config, seed, ctx):
    block, timestamp = latest(chain)
    if name == 'seed':
        plan.validate_seed(seed, config, timestamp, block)
    quote = None
    if name.startswith(('v3', 'v4')) and name not in ('mintV3', 'mintV4'):
        address, data = plan.quote_calldata(name, config)
        raw = chain.call(address, data=data, sender=config['owner'])
        require(len(raw) >= 66, 'Invalid exact-input quote')
        quote = int(raw[2:66], 16)
    intent = plan.build(name, config, seed, ctx, timestamp + plan.DEADLINE_SECONDS, quote)
    intent['quoteBlock'] = block
    return intent


def simulate(chain, intent, owner, *, margin=True):
    tx = {'from': owner, 'to': intent['to'], 'data': intent['data'], 'value': hex(intent['value'])}
    chain.rpc('eth_call', [tx, 'latest'])
    estimate = number(chain.rpc('eth_estimateGas', [tx]))
    return estimate + (estimate + 9) // 10 if margin else estimate


def gas_cap_gate(estimate, cap):
    require(estimate <= cap, 'Current raw gas estimate exceeds fixed rehearsed gas cap')


def initial_pool_gate(chain, config):
    c = config['contracts']
    require(number(chain.call(c['v3Factory'], 'getPool(address,address,uint24)', [plan.STABLE, config['wrappedNative'], 100])) == 0,
            'V3 test pool already exists; use the retained journal')
    require(chain.words(c['v4StateView'], 'getSlot0(bytes32)', [plan.pool_id(config)])[0] == 0,
            'V4 test pool already exists; use the retained journal')
    def check(address):
        balances = parallel(lambda: number(chain.rpc('eth_getBalance', [address, 'latest'])),
            lambda: number(chain.call(plan.STABLE, 'balanceOf(address)', [address])),
            lambda: number(chain.call(config['wrappedNative'], 'balanceOf(address)', [address])))
        require(balances == [0, 0, 0], 'Operation contract has existing native or token balance')
    parallel(*(lambda a=address: check(a) for address in (c['universalRouter'], c['v3PositionManager'], c['v4PositionManager'])))


def validate_row(row, config, seed, ctx, nonce):
    intent = row['intent']
    expected = plan.build(row['name'], config, seed, ctx, intent['deadline'], intent.get('quotedOutput'))
    require(all(intent.get(k) == value for k, value in expected.items()), 'Journal semantic intent changed')
    tx = row['unsigned']
    require(number(tx['chainId']) == plan.CHAIN and tx['from'].lower() == config['owner'].lower()
            and number(tx['nonce']) == nonce and tx['to'].lower() == intent['to'].lower()
            and tx['data'] == intent['data'] and number(tx['value']) == intent['value'], 'Journal transaction intent changed')
    require(number(tx['gas']) > 0 and number(tx['gasPrice']) > 0, 'Invalid journal gas cap')
    if row.get('raw'):
        validate_signed(row)


def failure_checks(chain, config, seed, ctx):
    """Negative paths are local eth_call checks with state snapshots, never remote writes."""
    require(chain.local, 'Failure checks require owned localhost fork')
    success_snapshot = chain.rpc('evm_snapshot')
    try:
        # Both real reverse tests consumed their finite approvals. Restore only
        # local fixture approvals so minimum-output failures cannot be masked by
        # an earlier allowance failure. The whole fixture is reverted below.
        _, timestamp = latest(chain)
        fixtures = [(plan.STABLE, plan.calldata('approve(address,uint256)', config['permit2'], 2 * plan.REVERSE)),
                    (config['permit2'], plan.calldata('approve(address,address,uint160,uint48)', plan.STABLE,
                        config['contracts']['universalRouter'], 2 * plan.REVERSE, timestamp + plan.DEADLINE_SECONDS))]
        for address, data in fixtures:
            local_fixture(chain, config['owner'], address, data)
        return check_failures(chain, config, seed, ctx)
    finally:
        require(chain.rpc('evm_revert', [success_snapshot]), 'Failed to restore local success state')


def local_fixture(chain, owner, address, data):
    require(chain.local, 'Local fixture cannot run remotely')
    tx_hash = chain.rpc('eth_sendTransaction', [{'from': owner, 'to': address, 'data': data}])
    end = time.monotonic() + 30
    while time.monotonic() < end:
        result = chain.rpc('eth_getTransactionReceipt', [tx_hash])
        if result:
            require(result['status'] == '0x1', 'Local fixture transaction reverted')
            return
        time.sleep(0.05)
    raise RuntimeError('Local fixture receipt timed out')


def check_failures(chain, config, seed, ctx):
    checked = []
    for name in ('v3Forward', 'v3Reverse', 'v4Forward', 'v4Reverse'):
        current = fresh_intent(chain, name, config, seed, ctx)
        chain.call(current['to'], data=current['data'], sender=config['owner'], value=current['value'])
        for case in ('expired', 'impossibleMinimum'):
            intent = plan.build(name, config, seed, ctx, 1 if case == 'expired' else current['deadline'],
                                current['quotedOutput'] if case == 'expired' else 10**30)
            before = chain.snapshot(config)
            try:
                chain.call(intent['to'], data=intent['data'], sender=config['owner'], value=intent['value'])
            except RuntimeError:
                require(chain.snapshot(config) == before, 'Failed simulation changed owner balances')
                checked.append(name + ':' + case)
            else:
                raise ValueError('Expected swap simulation to reject ' + case)
    snapshot = chain.rpc('evm_snapshot')
    try:
        data = plan.calldata('approve(address,address,uint160,uint48)', plan.STABLE, config['contracts']['universalRouter'], 0, 0)
        local_fixture(chain, config['owner'], config['permit2'], data)
        for name in ('v3Reverse', 'v4Reverse'):
            intent = fresh_intent(chain, name, config, seed, ctx)
            before = chain.snapshot(config)
            try:
                chain.call(intent['to'], data=intent['data'], sender=config['owner'])
            except RuntimeError:
                require(chain.snapshot(config) == before, 'Failed allowance simulation changed owner balances')
                checked.append(name + ':missingAllowance')
            else:
                raise ValueError('Expected missing allowance rejection')
    finally:
        require(chain.rpc('evm_revert', [snapshot]), 'Failed to restore local success state')
    return checked


def rehearse(args, config, deployment, seed, pins):
    remote = Chain()
    runtime_gate(remote, config, deployment, seed)
    block, timestamp = latest(remote)
    plan.validate_seed(seed, config, timestamp, block)
    source_nonce = number(remote.rpc('eth_getTransactionCount', [config['owner'], hex(block)]))
    require(source_nonce == number(remote.rpc('eth_getTransactionCount', [config['owner'], 'pending'])), 'Unknown pending owner transaction')
    source_balance = remote.snapshot(config, hex(block))
    ctx = plan.context(seed)
    price = number(remote.rpc('eth_gasPrice'))
    initial_pool_gate(remote, config)
    anchor = remote.rpc('eth_getBlockByNumber', [hex(block), False])
    fork_source = Chain(args.fork_source_rpc)
    fork_anchor = fork_source.rpc('eth_getBlockByNumber', [hex(block), False])
    require(fork_anchor['hash'] == anchor['hash'], 'Fork source block hash differs from broadcast RPC')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', args.port))
    with (args.output.parent / 'anvil-pools.log').open('w') as log:
        process = subprocess.Popen(['anvil', '--host', '127.0.0.1', '--port', str(args.port), '--accounts', '0',
            '--fork-url', args.fork_source_rpc, '--fork-header', 'User-Agent: SodaDex/1.0',
            '--fork-block-number', str(block), '--chain-id', str(plan.CHAIN),
            '--auto-impersonate', '--gas-price', str(price), '--silent'], stdout=log, stderr=log)
        def owned():
            require(process.poll() is None, 'Owned Anvil process exited')
            ids = subprocess.check_output(['lsof', '-nP', f'-iTCP@127.0.0.1:{args.port}', '-sTCP:LISTEN', '-t'], text=True).splitlines()
            require(set(ids) == {str(process.pid)}, 'Local listener is not the owned Anvil process')
        chain = Chain(f'http://127.0.0.1:{args.port}', owned=owned)
        try:
            for _ in range(120):
                try:
                    version = chain.rpc('web3_clientVersion')
                    require('anvil' in version.lower(), 'Local client mismatch')
                    break
                except (OSError, subprocess.CalledProcessError):
                    require(process.poll() is None, 'Anvil startup failed; inspect local log')
                    time.sleep(0.25)
            else:
                raise RuntimeError('Owned Anvil startup timed out')
            require(number(chain.rpc('eth_chainId')) == plan.CHAIN and chain.snapshot(config) == source_balance,
                    'Fork initial state differs from real owner state')
            require(number(chain.rpc('eth_getTransactionCount', [config['owner'], 'latest'])) == source_nonce, 'Fork owner nonce mismatch')
            runtime_gate(chain, config, deployment, seed)
            rows = []
            for index, name in enumerate(plan.STEPS):
                if name == 'seed':
                    # Preserve the external route's freshly updated on-chain
                    # oracle context while preparing its immediate next block.
                    # Anvil otherwise advances pending time to wall-clock time
                    # after slow fork reads, which can invalidate an oracle.
                    chain.rpc('evm_setNextBlockTimestamp', [number(anchor['timestamp']) + 1])
                intent = fresh_intent(chain, name, config, seed, ctx)
                gas = simulate(chain, intent, config['owner'])
                tx = make_unsigned(intent, config['owner'], source_nonce + index, gas, price)
                before = chain.snapshot(config)
                tx_hash = chain.rpc('eth_sendTransaction', [{k: v for k, v in tx.items() if k != 'chainId'}])
                row = {'name': name, 'intent': intent, 'unsigned': tx, 'before': before, 'hash': tx_hash}
                row['receipt'] = wait_receipt(chain, row)
                row['proof'] = postcondition(chain, config, ctx, row)
                rows.append(row)
                print(json.dumps({'local': True, 'step': name, 'gasUsed': number(row['receipt']['gasUsed'])}), flush=True)
            caps = [row['unsigned'] for row in rows]
            gate = budgets([], caps, balance=source_balance['native'])
            unsigned_bytes = max(len(bytes.fromhex(mktx(tx)[2:])) for tx in caps)
            oracle = oracle_gate(remote, unsigned_bytes, max(number(tx['gas']) for tx in caps))
            negatives = failure_checks(chain, config, seed, ctx)
            report = {'status': 'localhost-pool-rehearsal-passed', 'pins': pins, 'chainId': plan.CHAIN,
                      'sourceBlock': block, 'sourceBlockHash': anchor['hash'], 'forkSourceRPC': args.fork_source_rpc,
                      'seedLocalPendingTimestamp': number(anchor['timestamp']) + 1,
                      'broadcastRPC': plan.RPC_URL, 'ownerNonce': source_nonce, 'owner': config['owner'], 'initialBalances': source_balance,
                      'context': ctx, 'oracle': oracle, 'gasPriceWei': price, 'budget': gate,
                      'negativeChecks': negatives, 'transactions': rows, 'finalBalances': chain.snapshot(config),
                      'productionDeployment': 'deferred', 'mainnetWrites': False}
            save(args.output, report)
            print(json.dumps({'status': report['status'], 'steps': len(rows), 'budget': gate, 'report': str(args.output)}), flush=True)
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


def remaining_caps(prepared, start, price):
    return [{**row['unsigned'], 'gasPrice': hex(price)} for row in prepared['transactions'][start:]]


def unsent_gate(chain, row, config, deployment, seed, prepared, journal, index, *, freshly_checked=False):
    """Revalidate frozen signed bytes before a first send or exact rebroadcast."""
    if not freshly_checked:
        runtime_gate(chain, config, deployment, seed)
    block, timestamp = latest(chain)
    require(timestamp < row['intent']['deadline'], 'Retained signed transaction expired; no automatic replacement')
    if row['name'] == 'seed':
        plan.validate_seed(seed, config, timestamp, block)
    require(chain.snapshot(config) == row['before'], 'Owner balances changed since signing; retain journal for review')
    old.nonce_gate(number(chain.rpc('eth_getTransactionCount', [config['owner'], 'latest'])),
                   number(chain.rpc('eth_getTransactionCount', [config['owner'], 'pending'])), number(row['unsigned']['nonce']))
    price = number(row['unsigned']['gasPrice'])
    require(number(chain.rpc('eth_gasPrice')) <= price, 'Gas price increased after signing')
    future = remaining_caps(prepared, index + 1, price)
    budgets(journal['rows'], future, balance=row['before']['native'])
    if not freshly_checked:
        oracle = oracle_gate(chain, len(bytes.fromhex(mktx(row['unsigned'])[2:])), number(row['unsigned']['gas']))
        require(oracle == prepared['oracle'], 'Oracle changed since rehearsal')
    gas_cap_gate(simulate(chain, row['intent'], config['owner'], margin=False), number(row['unsigned']['gas']))
    require(number(chain.call(old.ORACLE, 'getL1Fee(bytes)', [row['raw']])) == 0, 'Nonzero signed data fee')


def reconcile(chain, path, journal, config, deployment, seed, prepared, ctx):
    """Recover signed intents first; known pending transactions are only waited on."""
    require(len(journal['rows']) <= len(plan.STEPS), 'Unexpected journal length')
    for index, row in enumerate(journal['rows']):
        require(row['name'] == plan.STEPS[index], 'Journal order changed')
        validate_row(row, config, seed, ctx, journal['ownerNonce'] + index)
        require(row.get('raw'), 'Retained intent is missing its signed transaction')
        found = receipt(chain, row)
        require(found is not None or not row.get('receipt'), 'Confirmed receipt disappeared or became immature')
        if found:
            if row.get('receipt'):
                require(found['blockHash'] == row['receipt']['blockHash'], 'Previously confirmed receipt moved blocks')
            row['receipt'] = found
        else:
            known = chain.rpc('eth_getTransactionByHash', [row['hash']])
            if known is None:
                require(index == len(journal['rows']) - 1, 'Non-final journal row cannot be unresolved')
                unsent_gate(chain, row, config, deployment, seed, prepared, journal, index)
                returned = chain.rpc('eth_sendRawTransaction', [row['raw']])
                require(returned.lower() == row['hash'].lower(), 'Broadcast hash mismatch')
            row['receipt'] = wait_receipt(chain, row)
        row['proof'] = postcondition(chain, config, ctx, row)
        save(path, journal)


def execute(args, config, deployment, seed, pins):
    prepared = json.loads(args.rehearsal.read_text())
    require(prepared['status'] == 'localhost-pool-rehearsal-passed' and prepared['pins'] == pins, 'Rehearsal inputs/source changed')
    require(prepared['negativeChecks'] and len(prepared['transactions']) == len(plan.STEPS), 'Incomplete rehearsal')
    ctx = plan.context(seed)
    require(ctx == prepared['context'], 'Rehearsal price/allocation context changed')
    chain = Chain(execute=True)
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(not STATE.is_symlink(), 'Private state directory cannot be a symlink')
    os.chmod(STATE, 0o700)
    path = STATE / 'journal.json'
    with (STATE / 'lock').open('a') as lock:
        os.chmod(STATE / 'lock', 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if path.exists():
            require(not path.is_symlink() and path.stat().st_mode & 0o077 == 0, 'Journal permissions invalid')
            journal = json.loads(path.read_text())
            require(journal['pins'] == pins and journal['preparedSha256'] == sha(args.rehearsal.read_bytes()), 'Retained journal inputs changed')
        else:
            runtime_gate(chain, config, deployment, seed)
            initial_pool_gate(chain, config)
            source_nonce = number(chain.rpc('eth_getTransactionCount', [config['owner'], 'latest']))
            old.nonce_gate(source_nonce, number(chain.rpc('eth_getTransactionCount', [config['owner'], 'pending'])), prepared['ownerNonce'])
            block, timestamp = latest(chain)
            plan.validate_seed(seed, config, timestamp, block)
            journal = {'pins': pins, 'preparedSha256': sha(args.rehearsal.read_bytes()), 'prepared': prepared,
                       'ownerNonce': source_nonce, 'rows': [], 'initialBalances': chain.snapshot(config), 'createdAt': time.time()}
            save(path, journal)
        # Recover before evaluating the new balance or spending another nonce.
        reconcile(chain, path, journal, config, deployment, seed, prepared, ctx)
        if journal.get('completed'):
            print(json.dumps({'status': 'already-complete', 'report': str(args.report)}), flush=True)
            return
        signer = cast('wallet', 'address', '--keystore', WALLET / 'owner', '--password-file', WALLET / 'password')
        require(signer.lower() == config['owner'].lower(), 'Local keystore owner mismatch')
        for index in range(len(journal['rows']), len(plan.STEPS)):
            name = plan.STEPS[index]
            runtime_gate(chain, config, deployment, seed)
            price = number(chain.rpc('eth_gasPrice'))
            require(price <= prepared['gasPriceWei'], 'Gas price increased; new complete rehearsal required')
            latest_nonce = number(chain.rpc('eth_getTransactionCount', [signer, 'latest']))
            pending_nonce = number(chain.rpc('eth_getTransactionCount', [signer, 'pending']))
            old.nonce_gate(latest_nonce, pending_nonce, journal['ownerNonce'] + index)
            intent = fresh_intent(chain, name, config, seed, ctx)
            estimate = simulate(chain, intent, signer, margin=False)
            cap = number(prepared['transactions'][index]['unsigned']['gas'])
            gas_cap_gate(estimate, cap)
            tx = make_unsigned(intent, signer, journal['ownerNonce'] + index, cap, price)
            balance = chain.snapshot(config)
            if name in ('mintV3', 'mintV4'):
                reserve = ctx['stableCap'] * (2 if name == 'mintV3' else 1) + 2 * plan.REVERSE
                require(balance['stable'] - journal['initialBalances']['stable'] >= reserve, 'Seed stable output insufficient for remaining LP and reverse inputs')
            future = remaining_caps(prepared, index + 1, price)
            row = {'name': name, 'intent': intent, 'unsigned': tx, 'before': balance}
            budget = budgets(journal['rows'] + [row], future, balance=balance['native'])
            unsigned = mktx(tx)
            oracle = oracle_gate(chain, len(bytes.fromhex(unsigned[2:])), cap)
            require(oracle == prepared['oracle'], 'Oracle changed since successful rehearsal')
            # Refresh account/chain/deadline/simulation immediately before local signing.
            require(number(chain.rpc('eth_chainId')) == plan.CHAIN, 'Chain changed before signing')
            _, timestamp = latest(chain)
            require(timestamp < intent['deadline'], 'Transaction deadline expired before signing')
            gas_cap_gate(simulate(chain, intent, signer, margin=False), cap)
            row['raw'] = mktx(tx, sign=True, wallet=WALLET)
            row['hash'] = cast('keccak', row['raw'])
            validate_signed(row)
            journal['rows'].append(row)
            save(path, journal)  # fsync and atomic replace before the first remote mutation.
            unsent_gate(chain, row, config, deployment, seed, prepared, journal, index, freshly_checked=True)
            returned = chain.rpc('eth_sendRawTransaction', [row['raw']])
            require(returned.lower() == row['hash'].lower(), 'Broadcast hash mismatch')
            row['receipt'] = wait_receipt(chain, row)
            row['proof'] = postcondition(chain, config, ctx, row)
            budgets(journal['rows'], future)
            require(journal['initialBalances']['native'] - row['proof']['after']['native']
                    <= plan.PRINCIPAL_CAP + plan.GAS_CAP, 'Observed wallet decrease exceeds total approved caps')
            save(path, journal)
            print(json.dumps({'step': name, 'hash': row['hash'], 'gasUsed': number(row['receipt']['gasUsed']), 'budget': budget}), flush=True)
        # Final canonical recheck of every receipt and the current deployed runtime pins.
        for row in journal['rows']:
            verified = receipt(chain, row)
            require(verified and verified['blockHash'] == row['receipt']['blockHash'], 'Final receipt canonical check failed')
        runtime_gate(chain, config, deployment, seed)
        final = chain.snapshot(config)
        result = {'status': 'test-pools-live-both-directions-passed', 'chainId': plan.CHAIN, 'rpcUrl': plan.RPC_URL,
                  'owner': signer, 'context': ctx, 'pins': pins, 'budget': budgets(journal['rows'], []),
                  'initialBalances': journal['initialBalances'], 'finalBalances': final,
                  'observedNativeDecreaseExcludingGas': journal['initialBalances']['native'] - final['native']
                      - budgets(journal['rows'], [])['gasSpentWei'],
                  'transactions': [{k: row[k] for k in ('name', 'hash', 'intent', 'unsigned', 'receipt', 'proof')} for row in journal['rows']],
                  'productionDeployment': 'deferred'}
        args.report.parent.mkdir(parents=True, exist_ok=True)
        save(args.report, result)
        journal['completed'] = True
        journal['reportSha256'] = sha(args.report.read_bytes())
        save(path, journal)
        print(json.dumps({'status': result['status'], 'budget': result['budget'], 'report': str(args.report)}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=ROOT)
    parser.add_argument('--seed-route', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / '.analysis/pools/rehearsal.json')
    parser.add_argument('--rehearsal', type=Path, default=ROOT / '.analysis/pools/rehearsal.json')
    parser.add_argument('--report', type=Path, default=ROOT / '.analysis/pools/receipts.json')
    parser.add_argument('--port', type=int, default=18547)
    parser.add_argument('--fork-source-rpc', choices=[plan.RPC_URL, OFFICIAL_READ_RPC], default=plan.RPC_URL,
                        help='Read-only Anvil fork source; its block hash must match the fixed broadcast RPC')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--rehearse', action='store_true')
    mode.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    config, deployment, seed, pins = read_inputs(args)
    if args.rehearse:
        rehearse(args, config, deployment, seed, pins)
    elif args.execute:
        execute(args, config, deployment, seed, pins)
    else:
        chain = Chain()
        runtime_gate(chain, config, deployment, seed)
        print(json.dumps({'status': 'read-only', 'owner': config['owner'], 'balances': chain.snapshot(config),
                          'steps': list(plan.STEPS), 'policy': pins['policy']}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Pool phase stopped: {type(error).__name__}: {error}', flush=True)
        raise SystemExit(1) from None

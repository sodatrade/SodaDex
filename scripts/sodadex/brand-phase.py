#!/usr/bin/env python3
"""Rehearse/resume the bounded SodaDEX NFT branding + remaining test-pool phase.

Default mode only reads public chain data. --rehearse mutates an owned Anvil fork.
Only root's explicitly reviewed --execute mode accesses the local encrypted wallet.
No production contract, old deployment journal, or completed seed is modified.
"""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import time

import brand_plan as plan
import brand_chain as chain_tools
import pool_plan as pool
from brand_chain import (Chain, parallel, save, sha, old, require, number, cast, oracle_gate,
                         make_unsigned, mktx, validate_signed, receipt, wait_receipt,
                         prior_gate, postcondition, brand_bindings, OFFICIAL_READ_RPC)

ROOT = Path(__file__).resolve().parents[2]
STATE = Path.home() / '.local/share/sodadex/deployments/xlayer-test-sodadex-branding'
WALLET = Path.home() / '.local/share/sodadex/wallets/xlayer-test-owner'
POOL_SPEC = importlib.util.spec_from_file_location('completed_pool_tools', Path(__file__).with_name('pool-phase.py'))
pool_phase = importlib.util.module_from_spec(POOL_SPEC)
POOL_SPEC.loader.exec_module(pool_phase)


def read_inputs(args):
    paths = [args.source_root / 'deployments/xlayer-test' / name
             for name in ('plan.json', 'receipts.json', 'pools-interrupted.json')]
    config_bytes, deploy_bytes, prior_bytes = [path.read_bytes() for path in paths]
    original, deployment, prior = map(json.loads, (config_bytes, deploy_bytes, prior_bytes))
    pool.validate_config(original)
    require(original['contracts'] == deployment['contracts']
            and original['owner'].lower() == deployment['owner'].lower(), 'Original deployment inputs disagree')
    manifest, artifacts, manifest_hash = plan.load_artifacts(args.build_manifest)
    # The build manifest binds source bytes. Resolve only explicit repository files.
    build_source_root = args.build_source_root or args.source_root
    for relative, digest in manifest.get('canonicalSources', {}).items():
        source = (build_source_root / relative).resolve()
        require(source.is_relative_to(build_source_root.resolve()) and sha(source.read_bytes()) == digest,
                'Brand source differs from compiled manifest')
    require(manifest.get('canonicalSources'), 'Build manifest lacks source hashes')
    bundle = (args.build_manifest.parent / manifest['sourceBundle']['path']).resolve()
    require(bundle.is_relative_to(args.build_manifest.parent.resolve())
            and sha(bundle.read_bytes()) == manifest['sourceBundle']['sha256'], 'Compiler source bundle changed')
    for relative, digest in manifest['unmodified'].items():
        source = (args.source_root / relative).resolve()
        require(source.is_relative_to(args.source_root.resolve()) and sha(source.read_bytes()) == digest,
                'Reused upstream core/router artifact changed')
    sources = {name: sha(Path(__file__).with_name(name).read_bytes()) for name in plan.SOURCE_FILES}
    sources['pool-phase.py'] = sha(Path(__file__).with_name('pool-phase.py').read_bytes())
    cap = plan.gas_wei(args.approved_total_gas_okb)
    pins = {'configSha256': sha(config_bytes), 'deploymentSha256': sha(deploy_bytes),
            'priorReportSha256': sha(prior_bytes), 'buildManifestSha256': manifest_hash,
            'sourceSha256': sources, 'policy': plan.policy(cap)}
    return original, deployment, prior, manifest, artifacts, pins


def latest(chain):
    block = chain.rpc('eth_getBlockByNumber', ['latest', False])
    return number(block['number']), number(block['timestamp'])


def fresh_context(chain, config):
    # This endpoint only creates unsigned calldata. It never signs or broadcasts;
    # the value is simulated at an explicit current block, never bought again.
    result = subprocess.run(['onchainos', 'swap', 'swap', '--from', 'okb', '--to', pool.STABLE.lower(),
                             '--readable-amount', '0.0001', '--chain', '196', '--wallet', config['owner'].lower(),
                             '--slippage', '0.49'], capture_output=True, text=True)
    require(result.returncode == 0, 'Read-only market quote command failed')
    try:
        quote = json.loads(result.stdout)
    except ValueError:
        raise ValueError('Read-only market quote is not JSON') from None
    require(quote.get('ok') is True and len(quote.get('data', [])) == 1, 'Market quote command returned no route')
    anchor = chain.rpc('eth_getBlockByNumber', ['latest', False])
    block = {key: anchor[key] for key in ('number', 'hash', 'timestamp')}
    code = chain.rpc('eth_getCode', [plan.MARKET_ROUTER, block['number']])
    code_sha = sha(bytes.fromhex(code[2:]))
    call = plan.market_call(quote['data'][0], config, block, code_sha)
    output = chain.rpc('eth_call', [call, block['number']])
    observed = plan.reference_quote(quote['data'][0], config, block, code_sha, output)
    require(chain.rpc('eth_getBlockByNumber', [block['number'], False])['hash'] == block['hash'],
            'Market reference block changed')
    head, timestamp = latest(chain)
    return plan.quote_context(observed, config, chain.snapshot(config)['stable'], head, timestamp,
                              quote_timestamp=number(block['timestamp']))


def fresh_intent(chain, name, original, config, artifacts, ctx):
    block, timestamp = latest(chain)
    quote = None
    if name.startswith(('v3', 'v4')) and name not in plan.DEPLOYS:
        address, data = pool.quote_calldata(name, config)
        raw = chain.call(address, data=data, sender=config['owner'])
        require(len(raw) >= 66, 'Invalid exact-input quote')
        quote = int(raw[2:66], 16)
    intent = plan.build(name, original, config, artifacts, ctx, timestamp + pool.DEADLINE_SECONDS, quote)
    intent['quoteBlock'] = block
    return intent


def simulate(chain, intent, owner, *, margin=True):
    tx = {'from': owner, 'data': intent['data'], 'value': hex(intent['value'])}
    if intent.get('to'):
        tx['to'] = intent['to']
    chain.rpc('eth_call', [tx, 'latest'])
    estimate = number(chain.rpc('eth_estimateGas', [tx]))
    return estimate + (estimate + 9) // 10 if margin else estimate


def initial_pool_gate(chain, config):
    c = config['contracts']
    require(number(chain.call(c['v3Factory'], 'getPool(address,address,uint24)',
                             [pool.STABLE, config['wrappedNative'], 100])) == 0, 'V3 pool already exists')
    require(chain.words(c['v4StateView'], 'getSlot0(bytes32)', [pool.pool_id(config)])[0] == 0, 'V4 pool already exists')


def remaining_caps(prepared, start, price):
    return [{**row['unsigned'], 'gasPrice': hex(price)} for row in prepared['transactions'][start:]]


def ensure_prepared(prepared, pins, original, artifacts):
    require(prepared['status'] == 'localhost-branding-pool-rehearsal-passed' and prepared['pins'] == pins,
            'Rehearsal inputs/source/policy changed')
    require(len(prepared['transactions']) == len(plan.STEPS) and len(prepared['negativeChecks']) == 10,
            'Incomplete deployment, mint, swap or negative rehearsal')
    config = plan.derive_config(original, prepared['ownerNonce'])
    require(config == prepared['config'], 'Predicted branding addresses changed')
    for index, row in enumerate(prepared['transactions']):
        require(row['name'] == plan.STEPS[index], 'Rehearsal step order changed')
        plan.validate_row(row, original, config, artifacts, prepared['ownerNonce'] + index)
    return config


def rehearse(args, original, deployment, prior, manifest, artifacts, pins):
    remote = Chain()
    prior_gate(remote, original, deployment, prior)
    block, _ = latest(remote)
    anchor = remote.rpc('eth_getBlockByNumber', [hex(block), False])
    fork_source = Chain(args.fork_source_rpc)
    require(fork_source.rpc('eth_getBlockByNumber', [hex(block), False])['hash'] == anchor['hash'],
            'Official fork source and custom RPC disagree at anchor block')
    nonce = number(remote.rpc('eth_getTransactionCount', [original['owner'], hex(block)]))
    old.nonce_gate(nonce, number(remote.rpc('eth_getTransactionCount', [original['owner'], 'pending'])), 16)
    config = plan.derive_config(original, nonce)
    balance = remote.snapshot(original, hex(block))
    require(balance['stable'] == prior['balances']['stable'] and balance['wrapped'] == 0, 'Owner seed state changed')
    initial_pool_gate(remote, config)
    price = number(remote.rpc('eth_gasPrice'))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', args.port))
    with (args.output.parent / 'anvil-branding.log').open('w') as log:
        process = subprocess.Popen(['anvil', '--host', '127.0.0.1', '--port', str(args.port), '--accounts', '0',
            '--fork-url', args.fork_source_rpc, '--fork-header', 'User-Agent: SodaDex/1.0',
            '--fork-block-number', str(block), '--chain-id', str(pool.CHAIN), '--auto-impersonate',
            '--gas-price', str(price), '--silent'], stdout=log, stderr=log)
        def owned():
            require(process.poll() is None, 'Owned Anvil process exited')
            ids = subprocess.check_output(['lsof', '-nP', f'-iTCP@127.0.0.1:{args.port}', '-sTCP:LISTEN', '-t'], text=True).splitlines()
            require(set(ids) == {str(process.pid)}, 'Local listener is not the owned Anvil process')
        chain = Chain(f'http://127.0.0.1:{args.port}', owned=owned)
        try:
            for _ in range(120):
                try:
                    require('anvil' in chain.rpc('web3_clientVersion').lower(), 'Local client mismatch')
                    break
                except (OSError, subprocess.CalledProcessError):
                    require(process.poll() is None, 'Anvil startup failed; inspect local log')
                    time.sleep(0.25)
            else:
                raise RuntimeError('Owned Anvil startup timed out')
            require(number(chain.rpc('eth_chainId')) == pool.CHAIN and chain.snapshot(config) == balance,
                    'Fork owner state differs from anchored real state')
            require(number(chain.rpc('eth_getTransactionCount', [config['owner'], 'latest'])) == nonce, 'Fork nonce mismatch')
            rows, ctx = [], None
            for index, name in enumerate(plan.STEPS):
                if name == 'mintV3':
                    # Obtain market data now, not before slow deployment rehearsals.
                    ctx = fresh_context(remote, config)
                intent = fresh_intent(chain, name, original, config, artifacts, ctx)
                gas = simulate(chain, intent, config['owner'])
                tx = make_unsigned(intent, config['owner'], nonce + index, gas, price)
                row = {'name': name, 'intent': intent, 'unsigned': tx, 'contextAtBuild': ctx,
                       'before': chain.snapshot(config)}
                local_tx = {key: value for key, value in tx.items() if key != 'chainId' and value is not None}
                row['hash'] = chain.rpc('eth_sendTransaction', [local_tx])
                row['receipt'] = wait_receipt(chain, row)
                row['proof'] = postcondition(chain, original, config, artifacts, row)
                rows.append(row)
                if name == 'universalRouter':
                    bindings = brand_bindings(chain, config)
                print(json.dumps({'local': True, 'step': name, 'gasUsed': number(row['receipt']['gasUsed'])}), flush=True)
            negatives = pool_phase.failure_checks(chain, config, {}, ctx)
            caps = [row['unsigned'] for row in rows]
            budget = plan.budget([], caps, prior, pins['policy']['gasCapWei'], balance=balance['native'], enforce=False)
            used = sum(old.receipt_cost(row['receipt']) for row in prior['transactions'] + rows)
            budget['rehearsalActualTotalGasWei'] = used
            oracle = oracle_gate(remote, max(len(bytes.fromhex(mktx(tx)[2:])) for tx in caps),
                                 max(number(tx['gas']) for tx in caps))
            report = {'status': 'localhost-branding-pool-rehearsal-passed', 'pins': pins, 'chainId': pool.CHAIN,
                'sourceBlock': block, 'sourceBlockHash': anchor['hash'], 'forkSourceRPC': args.fork_source_rpc,
                'broadcastRPC': pool.RPC_URL, 'ownerNonce': nonce, 'owner': config['owner'], 'config': config,
                'initialBalances': balance, 'context': ctx, 'oracle': oracle, 'gasPriceWei': price,
                'budget': budget, 'brandBindings': bindings, 'negativeChecks': negatives,
                'transactions': rows, 'finalBalances': chain.snapshot(config), 'productionDeployment': 'deferred', 'mainnetWrites': False}
            save(args.output, report)
            ensure_prepared(report, pins, original, artifacts)
            print(json.dumps({'status': report['status'], 'steps': len(rows), 'budget': budget, 'report': str(args.output)}), flush=True)
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


def live_runtimes(chain, original, deployment, prior, config, artifacts, rows):
    prior_gate(chain, original, deployment, prior)
    for row in rows:
        if row['name'] in plan.DEPLOYS and row.get('receipt'):
            code = chain.rpc('eth_getCode', [row['intent']['expectedAddress'], 'latest'])
            require(sha(bytes.fromhex(code[2:])) == row['proof']['runtimeCodeSha256'], 'Deployed brand runtime changed')
            chain_tools.runtime_matches_artifact(code, artifacts[row['name']], {'NFTDescriptor': config['contracts']['v3NFTDescriptor']},
                library_address=config['contracts'][row['name']] if row['name'] == 'v3NFTDescriptor' else None)


def unsent_gate(chain, row, original, deployment, prior, config, artifacts, prepared, journal, index):
    live_runtimes(chain, original, deployment, prior, config, artifacts, journal['rows'])
    block, timestamp = latest(chain)
    if row['intent'].get('deadline'):
        require(timestamp < row['intent']['deadline'], 'Retained signed transaction expired; no automatic replacement')
    if row['name'] in ('mintV3', 'mintV4'):
        require(0 <= timestamp - row['contextAtBuild']['quoteBlockTimestamp'] <= pool.DEADLINE_SECONDS,
                'Frozen market quote expired before unsent LP initialization; retain journal')
    require(chain.snapshot(config) == row['before'], 'Owner balances changed since signing')
    old.nonce_gate(number(chain.rpc('eth_getTransactionCount', [config['owner'], 'latest'])),
                   number(chain.rpc('eth_getTransactionCount', [config['owner'], 'pending'])), number(row['unsigned']['nonce']))
    price, gas = number(row['unsigned']['gasPrice']), number(row['unsigned']['gas'])
    require(number(chain.rpc('eth_gasPrice')) <= price, 'Gas price increased after signing')
    plan.budget(journal['rows'], remaining_caps(prepared, index + 1, price), prior,
                journal['pins']['policy']['gasCapWei'], balance=row['before']['native'])
    require(oracle_gate(chain, len(bytes.fromhex(mktx(row['unsigned'])[2:])), gas) == prepared['oracle'], 'Fee oracle changed')
    require(simulate(chain, row['intent'], config['owner'], margin=False) <= gas, 'Current gas estimate exceeds rehearsed cap')
    require(number(chain.call(old.ORACLE, 'getL1Fee(bytes)', [row['raw']])) == 0, 'Nonzero signed data fee')


def reconcile(chain, path, journal, original, deployment, prior, config, artifacts, prepared):
    require(len(journal['rows']) <= len(plan.STEPS), 'Unexpected journal length')
    for index, row in enumerate(journal['rows']):
        require(row['name'] == plan.STEPS[index], 'Journal order changed')
        plan.validate_row(row, original, config, artifacts, journal['ownerNonce'] + index)
        require(row.get('raw'), 'Retained intent is missing signed bytes')
        validate_signed(row)
        if row.get('contextAtBuild') is not None:
            require(row['contextAtBuild'] == journal['context'], 'Signed LP market context changed')
        found = receipt(chain, row)
        require(found is not None or not row.get('receipt'), 'Confirmed receipt disappeared or became immature')
        if found:
            if row.get('receipt'):
                require(found['blockHash'] == row['receipt']['blockHash'], 'Confirmed receipt moved blocks')
            row['receipt'] = found
        else:
            known = chain.rpc('eth_getTransactionByHash', [row['hash']])
            if known is None:
                require(index == len(journal['rows']) - 1, 'Non-final journal row unresolved')
                unsent_gate(chain, row, original, deployment, prior, config, artifacts, prepared, journal, index)
                returned = chain.rpc('eth_sendRawTransaction', [row['raw']])
                require(returned.lower() == row['hash'].lower(), 'Broadcast returned another hash')
            row['receipt'] = wait_receipt(chain, row)
        row['proof'] = postcondition(chain, original, config, artifacts, row)
        save(path, journal)


def execute(args, original, deployment, prior, manifest, artifacts, pins):
    prepared = json.loads(args.rehearsal.read_text())
    config = ensure_prepared(prepared, pins, original, artifacts)
    chain = Chain(execute=True)
    # Fail before wallet access, journal creation, or any remote mutation if the
    # complete rehearsed continuation exceeds the exact user-approved cap.
    if not (STATE / 'journal.json').exists():
        plan.budget([], remaining_caps(prepared, 0, number(chain.rpc('eth_gasPrice'))), prior, pins['policy']['gasCapWei'])
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
            prior_gate(chain, original, deployment, prior)
            initial_pool_gate(chain, config)
            old.nonce_gate(number(chain.rpc('eth_getTransactionCount', [config['owner'], 'latest'])),
                           number(chain.rpc('eth_getTransactionCount', [config['owner'], 'pending'])), prepared['ownerNonce'])
            balance = chain.snapshot(config)
            require(balance['stable'] == 11844 and balance['wrapped'] == 0, 'Seed state changed before continuation')
            journal = {'pins': pins, 'preparedSha256': sha(args.rehearsal.read_bytes()), 'ownerNonce': prepared['ownerNonce'],
                       'rows': [], 'initialBalances': balance, 'context': None, 'createdAt': time.time()}
            save(path, journal)
        # Recover previously signed intents before any new balance or gas gates.
        reconcile(chain, path, journal, original, deployment, prior, config, artifacts, prepared)
        if journal.get('completed'):
            print(json.dumps({'status': 'already-complete', 'report': str(args.report)}), flush=True)
            return
        signer = cast('wallet', 'address', '--keystore', WALLET / 'owner', '--password-file', WALLET / 'password')
        require(signer.lower() == config['owner'].lower(), 'Local keystore owner mismatch')
        live_runtimes(chain, original, deployment, prior, config, artifacts, journal['rows'])
        for index in range(len(journal['rows']), len(plan.STEPS)):
            name = plan.STEPS[index]
            nonce = journal['ownerNonce'] + index
            old.nonce_gate(number(chain.rpc('eth_getTransactionCount', [signer, 'latest'])),
                           number(chain.rpc('eth_getTransactionCount', [signer, 'pending'])), nonce)
            if name == 'mintV3':
                # Before the first LP signature this context may be refreshed.
                # Once a mint is signed, all continuation rows use this exact context.
                journal['context'] = fresh_context(chain, config)
                save(path, journal)
            ctx = journal['context']
            intent = fresh_intent(chain, name, original, config, artifacts, ctx)
            price = number(chain.rpc('eth_gasPrice'))
            cap = number(prepared['transactions'][index]['unsigned']['gas'])
            tx = make_unsigned(intent, signer, nonce, cap, price)
            balance = chain.snapshot(config)
            if name in ('mintV3', 'mintV4'):
                stable_reserve = 5822 * (2 if name == 'mintV3' else 1) + 2 * pool.REVERSE
                require(balance['stable'] >= stable_reserve, 'Stable balance insufficient for remaining LP and reverse inputs')
            row = {'name': name, 'intent': intent, 'unsigned': tx, 'before': balance, 'contextAtBuild': ctx}
            if name in plan.DEPLOYS:
                row['expectedRuntimeSha256'] = prepared['transactions'][index]['proof']['runtimeCodeSha256']
            future = remaining_caps(prepared, index + 1, price)
            budget = plan.budget(journal['rows'] + [row], future, prior, pins['policy']['gasCapWei'], balance=balance['native'])
            require(oracle_gate(chain, len(bytes.fromhex(mktx(tx)[2:])), cap) == prepared['oracle'], 'Oracle changed since rehearsal')
            require(number(chain.rpc('eth_chainId')) == pool.CHAIN, 'Chain changed before signing')
            if intent.get('deadline'):
                now = latest(chain)[1]
                require(now < intent['deadline'], 'Deadline expired before signing')
                if name in ('mintV3', 'mintV4'):
                    require(0 <= now - ctx['quoteBlockTimestamp'] <= pool.DEADLINE_SECONDS, 'Frozen market quote expired before LP signature')
            require(simulate(chain, intent, signer, margin=False) <= cap, 'Current gas estimate exceeds rehearsed fixed cap')
            row['raw'] = mktx(tx, sign=True, wallet=WALLET)
            row['hash'] = cast('keccak', row['raw'])
            validate_signed(row)
            journal['rows'].append(row)
            save(path, journal)  # Atomic fsync of signed bytes and hash BEFORE network write.
            unsent_gate(chain, row, original, deployment, prior, config, artifacts, prepared, journal, index)
            returned = chain.rpc('eth_sendRawTransaction', [row['raw']])
            require(returned.lower() == row['hash'].lower(), 'Broadcast returned another hash')
            row['receipt'] = wait_receipt(chain, row)
            row['proof'] = postcondition(chain, original, config, artifacts, row)
            plan.budget(journal['rows'], future, prior, pins['policy']['gasCapWei'])
            require(journal['initialBalances']['native'] - row['proof']['after']['native']
                    <= pool.PRINCIPAL_CAP - pool.BUY + pins['policy']['gasCapWei'], 'Observed decrease exceeds remaining approved caps')
            save(path, journal)
            print(json.dumps({'step': name, 'hash': row['hash'], 'address': row['receipt'].get('contractAddress'),
                              'gasUsed': number(row['receipt']['gasUsed']), 'budget': budget}), flush=True)
        for row in journal['rows']:
            canonical = receipt(chain, row)
            require(canonical and canonical['blockHash'] == row['receipt']['blockHash'], 'Final canonical receipt check failed')
        live_runtimes(chain, original, deployment, prior, config, artifacts, journal['rows'])
        bindings = brand_bindings(chain, config)
        report = {'status': 'sodadex-test-pools-live-both-directions-passed', 'chainId': pool.CHAIN,
            'rpcUrl': pool.RPC_URL, 'owner': signer, 'config': config, 'context': journal['context'], 'pins': pins,
            'budget': plan.budget(journal['rows'], [], prior, pins['policy']['gasCapWei']), 'brandBindings': bindings,
            'priorTransactions': prior['transactions'], 'initialBalances': journal['initialBalances'],
            'finalBalances': chain.snapshot(config), 'productionDeployment': 'deferred',
            'transactions': [{key: value for key, value in row.items() if key != 'raw'} for row in journal['rows']]}
        args.report.parent.mkdir(parents=True, exist_ok=True)
        save(args.report, report)
        journal['completed'], journal['reportSha256'] = True, sha(args.report.read_bytes())
        save(path, journal)
        print(json.dumps({'status': report['status'], 'budget': report['budget'], 'report': str(args.report)}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=ROOT)
    parser.add_argument('--build-manifest', type=Path, required=True)
    parser.add_argument('--build-source-root', type=Path, help='Optional detached build checkout for canonical source hash verification')
    parser.add_argument('--output', type=Path, default=ROOT / '.analysis/branding/phase-rehearsal.json')
    parser.add_argument('--rehearsal', type=Path, default=ROOT / '.analysis/branding/phase-rehearsal.json')
    parser.add_argument('--report', type=Path, default=ROOT / '.analysis/branding/phase-receipts.json')
    parser.add_argument('--approved-total-gas-okb', default='0.0005',
                        help='Exact total pool-phase gas cap including the three prior transactions; requires user approval to increase')
    parser.add_argument('--port', type=int, default=18548)
    parser.add_argument('--fork-source-rpc', choices=[pool.RPC_URL, OFFICIAL_READ_RPC], default=OFFICIAL_READ_RPC)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--rehearse', action='store_true')
    mode.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    inputs = read_inputs(args)
    if args.rehearse:
        rehearse(args, *inputs)
    elif args.execute:
        execute(args, *inputs)
    else:
        original, deployment, prior, _, _, pins = inputs
        chain = Chain()
        prior_gate(chain, original, deployment, prior)
        print(json.dumps({'status': 'read-only', 'balances': chain.snapshot(original),
                          'steps': list(plan.STEPS), 'policy': pins['policy']}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never emit subprocess output, signed bytes, wallet material or tracebacks.
        print(f'Brand phase stopped: {type(error).__name__}: {error}', flush=True)
        raise SystemExit(1) from None

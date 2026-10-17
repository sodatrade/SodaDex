#!/usr/bin/env python3
"""Compile original SodaDEX settlement. Never signs, broadcasts, or accesses a deployment wallet."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[2]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--solc',type=Path,default=Path.home()/'Library/Application Support/svm/0.8.26/solc-0.8.26')
    parser.add_argument('--check',action='store_true',help='Verify tracked ABI rather than updating it')
    args=parser.parse_args()
    folder=ROOT/'contracts/sodadex-orders'
    sources={str(p.relative_to(folder)):{'content':p.read_text()} for p in sorted((folder/'src').glob('*.sol'))}
    value={'language':'Solidity','sources':sources,'settings':{'optimizer':{'enabled':True,'runs':200},'viaIR':True,'evmVersion':'cancun','metadata':{'bytecodeHash':'none'},'outputSelection':{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.gasEstimates']}}}}
    result=subprocess.run([str(args.solc),'--standard-json'],input=json.dumps(value),capture_output=True,text=True,check=True)
    output=json.loads(result.stdout)
    errors=[e['formattedMessage'] for e in output.get('errors',[]) if e['severity']=='error']
    if errors:raise RuntimeError('\n'.join(errors))
    target=output['contracts']['src/SodaLimitSettlement.sol']['SodaLimitSettlement']
    build=ROOT/'.analysis/orders';build.mkdir(parents=True,exist_ok=True)
    (build/'compiler-input.json').write_text(json.dumps(value,indent=2)+'\n')
    (build/'settlement.json').write_text(json.dumps(target,indent=2)+'\n')
    expected_abi=json.dumps(target['abi'],indent=2)+'\n'
    if args.check:
        if (folder/'abi.json').read_text()!=expected_abi:raise ValueError('Tracked ABI differs from compiled source')
    else:(folder/'abi.json').write_text(expected_abi)
    print(json.dumps({'compiler':subprocess.check_output([str(args.solc),'--version'],text=True).strip().splitlines()[-1],'creationBytes':len(target['evm']['bytecode']['object'])//2,'runtimeBytes':len(target['evm']['deployedBytecode']['object'])//2,'compilerInputSha256':hashlib.sha256(json.dumps(value).encode()).hexdigest()}))

if __name__=='__main__':main()

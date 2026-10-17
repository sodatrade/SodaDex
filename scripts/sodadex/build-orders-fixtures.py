#!/usr/bin/env python3
"""Prepare local test dependencies/actual Permit2 runtime from an owned rehearsal dump. No network or keys."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shutil
ROOT=Path(__file__).resolve().parents[2]
def main():
    p=argparse.ArgumentParser();p.add_argument('--state',required=True,type=Path);p.add_argument('--forge-std',required=True,type=Path);a=p.parse_args()
    source=json.loads(a.state.read_text())
    if source.get('source')!='owned-local-rehearsal':raise ValueError('Owned local rehearsal dump required')
    state=json.loads(gzip.decompress(bytes.fromhex(source['state'][2:])))
    account=state['accounts']['0x000000000022d473030f116ddee9f6b43ac78ba3']
    code=account['code']
    target=ROOT/'.analysis/orders';(target/'fixtures').mkdir(parents=True,exist_ok=True);(target/'deps').mkdir(parents=True,exist_ok=True)
    shutil.copytree(a.forge_std,target/'deps/forge-std',dirs_exist_ok=True,ignore=shutil.ignore_patterns('.git','out','cache','node_modules'))
    (target/'fixtures/permit2-runtime.json').write_text(json.dumps({'runtime':code,'sha256':hashlib.sha256(bytes.fromhex(code[2:])).hexdigest(),'source':'owned-local-rehearsal actual chain-196 canonical Permit2 runtime'},indent=2)+'\n')
    print(json.dumps({'permit2RuntimeBytes':(len(code)-2)//2,'sha256':hashlib.sha256(bytes.fromhex(code[2:])).hexdigest()}))
if __name__=='__main__':main()

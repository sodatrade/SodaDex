#!/usr/bin/env python3
"""Render the 1952 source-history patch from pinned V1 and repo-owned library templates."""
from pathlib import Path
from mining_source import require_legacy_rehearsal
import difflib,json,hashlib
root=Path(__file__).resolve().parents[2]
require_legacy_rehearsal(root)
base=root/'.analysis/mining-1952/fabx-paid-rewards-v1'
changed={}
p=Path('src/pod/lib/DewebRewardAccounting.sol')
s=(base/p).read_text()
s=s.replace('import {DewebEpochRegistry}', 'import {FabxRewardHistory as History} from "./FabxRewardHistory.sol";\nimport {DewebEpochRegistry}',1)
s=s.replace('        (baseDelta, s.accumulator, forgone) = preview(start, last, baseline);','        History.checkpoint(start, last, baseline, s.epoch, s.until, s.rawTotal, s.accumulator);\n        (baseDelta, s.accumulator, forgone) = preview(start, last, baseline);',1)
s=s.replace('function settle(State storage s, MinerExtra storage m) private {','function settle(State storage s, MinerExtra storage m, bytes32 key) private {',1)
s=s.replace('        uint256 earned = accrued(s, m);\n        if (earned > m.debt) m.credit += earned - m.debt;', '        uint256 endpoint = m.epoch == s.epoch ? s.accumulator[m.pool] : s.ended[m.epoch][m.pool];\n        History.recordExtra(key, m.epoch, m.pool, m.rawWeight, m.debt, endpoint);\n        uint256 earned = accrued(s, m);\n        if (earned > m.debt) m.credit += earned - m.debt;',1)
s=s.replace('settle(s, m);','settle(s, m, key);')
a=s.index('        amount = baseline + take(key);',s.index('function prepareHarvest'))
b=s.index('\n    function paidTo',a)
s=s[:a]+'''        uint256 extra = take(key);
        amount = baseline + extra;
        uint256 room = IMiningRewardAsset(asset).MAX_SUPPLY() - IMiningRewardAsset(asset).totalSupply();
        if (amount > room) amount = room;
        if (amount != 0) {
            recipient = IMiningRewardNft(circuits).ownerOf(id);
            state().paid[key][recipient] += amount;
        }
        History.recordHarvest(key, recipient, amount, baseline, extra);
    }'''+s[b:]
changed[p]=s
p=Path('src/pod/lib/DewebMiningExtension.sol')
s=(base/p).read_text()
s=s.replace('import {PodMining,','import {FabxRewardHistory as History} from "./FabxRewardHistory.sol";\nimport {PodMining,',1)
s=s.replace('    function dewebApplied(bytes32 key)', '''    function rewardHistoryVersion() external pure returns (uint256) { return 2; }
    function rewardReceiptCount(bytes32 key, address recipient) external view returns (uint256) {
        return History.receiptCount(key, recipient);
    }
    function rewardReceipt(bytes32 key, address recipient, uint256 index) external view returns (History.Receipt memory) {
        return History.receipt(key, recipient, index);
    }
    function rewardPaidThrough(bytes32 key, address recipient, uint256 first, uint256 last, uint256 timestamp)
        external view returns (uint256)
    {
        return History.paidThrough(key, recipient, first, last, timestamp);
    }
    function rewardPeriodCount() external view returns (uint256) { return History.periodCount(); }
    function dewebApplied(bytes32 key)''',1)
changed[p]=s
for name in ('FabxRewardHistory','FabxHistoryMath'):
    changed[Path('src/pod/lib/'+name+'.sol')]=(root/'contracts/mining-rehearsal/src'/ (name+'.sol')).read_text()
patch=''
for p,s in changed.items():
    old=(base/p).read_text() if (base/p).exists() else ''
    patch+=''.join(difflib.unified_diff(old.splitlines(keepends=True),s.splitlines(keepends=True),fromfile='a/'+str(p) if old else '/dev/null',tofile='b/'+str(p)))
out=root/'contracts/mining-rehearsal/patches/fabx-history-v2.patch'
out.write_text(patch)
out.with_suffix('.json').write_text(json.dumps({'baseVariant':'1952-paid-rewards-v1','patchSha256':hashlib.sha256(patch.encode()).hexdigest(),'patchedFileSha256':{str(p):hashlib.sha256(s.encode()).hexdigest() for p,s in changed.items()}},indent=2)+'\n')

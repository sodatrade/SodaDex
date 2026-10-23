import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from mining_rewards_source import PATCHED_FILES, STAMP, verify_variant
from mining_source import FABX_SOURCE


class RewardSourceVerificationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name) / 'base'
        self.variant = Path(self.temp.name) / 'variant'
        self.base.mkdir()
        for relative in (*PATCHED_FILES, 'src/unchanged.sol'):
            path = self.base / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('original')
        shutil.copytree(self.base, self.variant)
        self.expected = {}
        for relative in PATCHED_FILES:
            (self.variant / relative).write_text('reviewed-patch')
            self.expected[relative] = hashlib.sha256(b'reviewed-patch').hexdigest()
        self.stamp = {'baseCommit': FABX_SOURCE, 'patchSha256': 'reviewed-hash', 'patchedFileSha256': self.expected.copy()}
        self.write_stamp()

    def write_stamp(self):
        (self.variant / STAMP).write_text(json.dumps(self.stamp))

    def verify(self):
        return verify_variant(self.base, self.variant, 'reviewed-hash', self.expected)

    def test_accepts_exact_patch_and_unmodified_baseline_files(self):
        self.assertEqual(self.verify()['baseCommit'], FABX_SOURCE)

    def test_rejects_modified_unchanged_source(self):
        (self.variant / 'src/unchanged.sol').write_text('unexpected')
        with self.assertRaisesRegex(ValueError, 'source file changed'):
            self.verify()

    def test_modified_source_cannot_self_certify_by_updating_its_stamp(self):
        relative = PATCHED_FILES[0]
        (self.variant / relative).write_text('unreviewed')
        self.stamp['patchedFileSha256'][relative] = hashlib.sha256(b'unreviewed').hexdigest()
        self.write_stamp()
        with self.assertRaisesRegex(ValueError, 'provenance changed'):
            self.verify()

    def test_rejects_added_or_removed_source(self):
        added = self.variant / 'hidden.sol'
        added.write_text('extra')
        with self.assertRaisesRegex(ValueError, 'file set changed'):
            self.verify()
        added.unlink()
        (self.variant / PATCHED_FILES[0]).unlink()
        with self.assertRaisesRegex(ValueError, 'file set changed'):
            self.verify()

    def test_rejects_patch_or_commit_mismatch(self):
        self.stamp['patchSha256'] = 'other-patch'
        self.write_stamp()
        with self.assertRaisesRegex(ValueError, 'provenance changed'):
            self.verify()
        self.stamp['patchSha256'] = 'reviewed-hash'
        self.stamp['baseCommit'] = 'other-commit'
        self.write_stamp()
        with self.assertRaisesRegex(ValueError, 'provenance changed'):
            self.verify()


if __name__ == '__main__':
    unittest.main()

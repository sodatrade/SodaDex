#!/usr/bin/env python3
"""Create/reuse a local 1952 admission signer. Never print a key or send a transaction."""
import json
import os
from pathlib import Path
import re
import secrets
import subprocess


def main():
    folder = Path.home() / ".local/share/sodadex/wallets/xlayer-1952-mining-authorizer"
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    if folder.is_symlink():
        raise ValueError("Signer directory cannot be a symlink")
    os.chmod(folder, 0o700)
    password_file, keystore = folder / "password", folder / "authorizer"
    for file in (password_file, keystore):
        if file.is_symlink():
            raise ValueError("Signer files cannot be symlinks")
    if not password_file.exists():
        fd = os.open(password_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w") as stream:
            stream.write(secrets.token_urlsafe(48))
    if not keystore.exists():
        env = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "LANG") if key in os.environ}
        env["CAST_PASSWORD"] = password_file.read_text()
        result = subprocess.run(["cast", "wallet", "new", str(folder), "authorizer", "--json"],
                                env=env, capture_output=True, text=True, check=False)
        if result.returncode or not keystore.is_file():
            raise RuntimeError("Local encrypted signer creation failed; no transaction was sent")
    os.chmod(keystore, 0o600)
    result = subprocess.run(["cast", "wallet", "address", "--keystore", str(keystore), "--password-file", str(password_file)],
                            capture_output=True, text=True, check=False)
    address = result.stdout.strip()
    if result.returncode or not re.fullmatch(r"0x[0-9a-fA-F]{40}", address):
        raise RuntimeError("Local signer address verification failed")
    public = {"chainId": 1952, "address": address, "purpose": "1952 test launch, procurement and tax conversion admission",
              "ownerKeyUsed": False, "broadcast": False}
    (folder / "public.json").write_text(json.dumps(public, indent=2) + "\n")
    print(json.dumps(public))


if __name__ == "__main__":
    main()

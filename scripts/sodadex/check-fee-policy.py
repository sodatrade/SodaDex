#!/usr/bin/env python3
"""Inspect local fee parameters only; never signs, broadcasts or deploys."""

import argparse
import json
from pathlib import Path
from fee_policy import PROFILES, inspect_profile, read_profile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=PROFILES, required=True)
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--output", type=Path, help="New public evidence file; never overwritten")
    args = parser.parse_args()
    try:
        result = inspect_profile(read_profile(args.profile or PROFILES[args.stage]), args.stage)
    except (ValueError, OSError) as error:
        result = {"valid": False, "errors": [str(error)], "pendingProductDecisions": []}
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        with args.output.open("x") as target:
            target.write(rendered)
    print(rendered, end="")
    return 0 if result["valid"] else 2


if __name__ == "__main__":
    raise SystemExit(main())

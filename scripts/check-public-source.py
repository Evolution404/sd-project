"""Check the checked-out public source tree without printing matched data."""

import argparse
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys


PRIVATE_ROOTS = {"data", "data-training", "dist", ".build", "test-results"}
PRIVATE_TYPES = re.compile(
    r"\.(?:sqlite3?(?:-[^./]+)?|db(?:-[^./]+)?|xlsx?|xlsm|zip|7z|log|pfx|p12|key)$",
    re.IGNORECASE,
)
CREDENTIAL = re.compile(
    rb"(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{25,}\b"
    rb"|\bgithub_pat_[A-Za-z0-9_]{30,}\b|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"
    rb"|\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{40,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}\b)"
)
LOCAL_PATH = re.compile(rb"/(?:Users|Volumes)/[A-Za-z0-9_.-]+/")
SQLITE_MAGIC = b"SQLite format 3\x00"


def private_ledger_patterns(path):
    data = json.loads(path.read_text(encoding="utf-8-sig"))["data"]
    voltage_prefix = re.compile(r"^(?:[±+−-]?\d+(?:\.\d+)?\s*k\s*v\s*)", re.I)
    line_names = {str(row["name"]).strip() for row in data["lines"] if row.get("name")}
    line_names.update(voltage_prefix.sub("", name) for name in tuple(line_names))
    names = {name for name in line_names if len(name) >= 4 and re.search(r"[\u3400-\u9fff]", name)}
    phones = {re.sub(r"\D", "", str(row.get("phone") or "")) for row in data["grids"]}
    equipment = {str(row.get("equipmentCode") or "").strip() for row in data["poles"]}
    groups = {
        "reference ledger line name": names,
        "reference ledger mobile number": {phone for phone in phones if re.fullmatch(r"1[3-9]\d{9}", phone)},
        "reference ledger equipment identifier": {code for code in equipment if len(code) >= 9},
    }
    if not names:
        raise ValueError("reference ledger has no recognizable line names")
    return {
        category: re.compile("|".join(re.escape(value) for value in sorted(values)))
        for category, values in groups.items() if values
    }


def content_violations(name, contents, private_patterns):
    path = PurePosixPath(name)
    if (PRIVATE_ROOTS.intersection(path.parts) or PRIVATE_TYPES.search(name)
            or (path.name.startswith(".env") and path.name != ".env.example")
            or path.name.upper() in {"IMPORT-RECEIPT.JSON", "UPGRADE-RECEIPT.JSON"}):
        return [("private artifact path", name)]
    findings = []
    if contents.startswith(SQLITE_MAGIC):
        findings.append(("database payload", name))
    if CREDENTIAL.search(contents):
        findings.append(("credential signature", name))
    if LOCAL_PATH.search(contents):
        findings.append(("workstation location", name))
    if private_patterns and b"\0" not in contents:
        text = contents.decode(errors="replace")
        for category, pattern in private_patterns.items():
            if pattern.search(text):
                findings.append((category, name))
    return findings


def scan_range(revisions, private_patterns):
    commits = subprocess.check_output(["git", "rev-list", revisions, "--"]).decode().splitlines()
    findings = []
    for commit in commits:
        paths = subprocess.check_output(
            ["git", "diff-tree", "-m", "-r", "--no-commit-id", "--name-only", "--diff-filter=ACMR", "-z", commit]
        ).decode().split("\0")
        for name in sorted(set(filter(None, paths))):
            blob = subprocess.check_output(["git", "show", commit + ":" + name])
            findings.extend((category, commit[:12] + ":" + path)
                            for category, path in content_violations(name, blob, private_patterns))
    return findings, len(commits)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-ledger", type=Path, help="optional local-only ledger used to compare identifiers")
    parser.add_argument("--git-range", help="also scan changed files in a local Git revision range")
    options = parser.parse_args()
    try:
        private_patterns = private_ledger_patterns(options.reference_ledger) if options.reference_ledger else {}
    except (OSError, ValueError, TypeError, KeyError):
        print("private reference ledger could not be validated", file=sys.stderr)
        return 1

    paths = subprocess.check_output(["git", "ls-files", "-z"]).decode().split("\0")
    violations = []
    for name in filter(None, paths):
        local = Path(name)
        if local.is_symlink():
            violations.append(("symbolic link", name))
            continue
        if local.is_file():
            violations.extend(content_violations(name, local.read_bytes(), private_patterns))
    commits_checked = None
    if options.git_range:
        if options.git_range.startswith("-"):
            parser.error("--git-range must be a Git revision range")
        history, commits_checked = scan_range(options.git_range, private_patterns)
        violations.extend(history)

    for category, path in violations:
        print(f"{category}: {path}", file=sys.stderr)
    if violations:
        return 1
    print(f"PUBLIC_SOURCE_CHECK_OK {len(paths) - 1} tracked paths")
    if commits_checked is not None:
        print(f"PUBLIC_HISTORY_CHECK_OK {commits_checked} commits")
    return 0


if __name__ == "__main__":
    sys.exit(main())

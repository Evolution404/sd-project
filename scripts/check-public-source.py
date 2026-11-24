"""Check the checked-out public source tree without printing matched data."""

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
    rb"|\bgithub_pat_[A-Za-z0-9_]{30,}\b|\bAKIA[A-Z0-9]{16}\b)"
)
LOCAL_PATH = re.compile(rb"/(?:Users|Volumes)/[A-Za-z0-9_.-]+/")
SQLITE_MAGIC = b"SQLite format 3\x00"


def main():
    paths = subprocess.check_output(["git", "ls-files", "-z"]).decode().split("\0")
    violations = []
    for name in filter(None, paths):
        path = PurePosixPath(name)
        local = Path(name)
        if local.is_symlink():
            violations.append(("symbolic link", name))
            continue
        if not local.is_file():
            continue
        if (PRIVATE_ROOTS.intersection(path.parts) or PRIVATE_TYPES.search(name)
                or (path.name.startswith(".env") and path.name != ".env.example")
                or path.name.upper() in {"IMPORT-RECEIPT.JSON", "UPGRADE-RECEIPT.JSON"}):
            violations.append(("private artifact path", name))
            continue
        contents = local.read_bytes()
        if contents.startswith(SQLITE_MAGIC):
            violations.append(("database payload", name))
        if CREDENTIAL.search(contents):
            violations.append(("credential signature", name))
        if LOCAL_PATH.search(contents):
            violations.append(("workstation location", name))

    for category, path in violations:
        print(f"{category}: {path}", file=sys.stderr)
    if violations:
        return 1
    print(f"PUBLIC_SOURCE_CHECK_OK {len(paths) - 1} tracked paths")
    return 0


if __name__ == "__main__":
    sys.exit(main())

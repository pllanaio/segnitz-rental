#!/usr/bin/env python3
"""Extract an OCI layout without trusting archive paths, links or duplicates.

Trivy accepts OCI directories, whereas --input TAR expects Docker save format.
The existing release-artifact verifier checks all descriptor hashes separately.
"""
import os
from pathlib import Path
import re
import shutil
import sys
import tarfile


def prepare(archive, destination):
    destination = Path(destination)
    # Exclusive target: never overwrite any existing scan or application data.
    destination.mkdir(mode=0o700)
    seen = set()
    try:
        with tarfile.open(archive, "r:") as source:
            for member in source:
                name = member.name.removeprefix("./")
                if name in seen:
                    raise ValueError("Duplicate OCI archive member")
                seen.add(name)
                if member.isdir() and name.rstrip("/") in (".", "blobs", "blobs/sha256"):
                    continue
                if not member.isfile() or not re.fullmatch(r"(?:index\.json|oci-layout|blobs/sha256/[a-f0-9]{64})", name):
                    raise ValueError("Unexpected OCI archive member")
                target = destination / name
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with source.extractfile(member) as incoming, target.open("xb") as outgoing:
                    os.chmod(target, 0o600)
                    shutil.copyfileobj(incoming, outgoing)
        if not {"index.json", "oci-layout"}.issubset(seen):
            raise ValueError("Incomplete OCI layout")
    except BaseException:
        shutil.rmtree(destination)
        raise


if __name__ == "__main__":
    prepare(sys.argv[1], sys.argv[2])

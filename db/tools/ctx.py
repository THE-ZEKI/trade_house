#!/usr/bin/env python3
"""Affiche le contexte autour d'une position donnee (diagnostic)."""
import re
import sys

META = re.compile(r"^\s*\\[a-zA-Z]")
path, pos = sys.argv[1], int(sys.argv[2])
raw = open(path, encoding="ascii").read()
s = "\n".join("" if META.match(l) else l for l in raw.splitlines())
line = s[:pos].count("\n") + 1
print(f"--- {path} offset {pos} (ligne {line}) ---")
print(s[max(0, pos - 500):pos + 200])

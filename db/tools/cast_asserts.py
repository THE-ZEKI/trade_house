#!/usr/bin/env python3
"""
trade_house · tools/cast_asserts.py

pg_temp.assert_equals(text, text, text) n'accepte pas implicitement un
integer, un bigint ou une enumeration : PostgreSQL n'applique la conversion
par E/S qu'aux constantes. Ce script ajoute un cast ::text explicite sur les
arguments 2 et 3 de chaque appel, dans db/tests/smoke.sql.
"""
from __future__ import annotations

import os
import sys

FUNC = "pg_temp.assert_equals("


def split_args(s: str) -> list[str]:
    args, depth, quote, cur = [], 0, False, ""
    for ch in s:
        if quote:
            cur += ch
            if ch == "'":
                quote = False
            continue
        if ch == "'":
            quote = True
            cur += ch
        elif ch == "(":
            depth += 1
            cur += ch
        elif ch == ")":
            depth -= 1
            cur += ch
        elif ch == "," and depth == 0:
            args.append(cur)
            cur = ""
        else:
            cur += ch
    args.append(cur)
    return args


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "..", "tests", "smoke.sql")
    src = open(path, encoding="ascii").read()

    out, i, changed = [], 0, 0
    while True:
        j = src.find(FUNC, i)
        if j < 0:
            out.append(src[i:])
            break
        start = j + len(FUNC)
        # ne pas modifier la definition de la fonction elle-meme
        head = src[max(0, j - 60):j]
        if "function" in head:
            out.append(src[i:k0 if (k0 := src.find(";", j)) > 0 else j + 1])
            i = j + 1
            continue
        depth, k, quote = 1, start, False
        while k < len(src) and depth:
            ch = src[k]
            if quote:
                if ch == "'":
                    quote = False
            elif ch == "'":
                quote = True
            elif ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            k += 1
        body = src[start:k - 1]
        args = split_args(body)
        new_args = [args[0]]
        for arg in args[1:]:
            a = arg.rstrip()
            if a.lstrip().lower().startswith("exists"):
                a = "(" + a.strip() + ")"
            new_args.append(a + "::text")
            changed += 1
        out.append(src[i:j] + FUNC + ",".join(new_args) + ")")
        i = k

    open(path, "w", encoding="ascii", newline="").write("".join(out))
    print(f"{changed} arguments castes en ::text dans {os.path.basename(path)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

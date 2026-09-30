#!/usr/bin/env python3
"""
trade_house · tools/validate_sql.py

Validation syntaxique des migrations avec pglast (binding officiel de
libpg_query, le parseur du serveur PostgreSQL). Detecte les erreurs de syntaxe
et quelques Forgetables de structure sans avoir besoin d'un serveur.

  python db/tools/validate_sql.py
"""
from __future__ import annotations

import glob
import os
import re
import sys

try:
    from pglast import parse_sql
    from pglast.parser import ParseError
except ImportError:  # pragma: no cover
    sys.exit("pglast manquant : pip install pglast")

META = re.compile(r"^\s*\\[a-zA-Z]")


def strip_meta(sql: str) -> str:
    """Retire les meta-commandes psql (\\i, \\set, \\echo...)."""
    return "\n".join("" if META.match(line) else line for line in sql.splitlines())


def count(sql: str, pattern: str) -> int:
    return len(re.findall(pattern, sql, re.IGNORECASE))


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    args = sys.argv[1:]
    if args:
        files = [os.path.abspath(a) for a in args]
    else:
        files = sorted(glob.glob(os.path.join(here, "..", "migrations", "*.sql")))

    if not files:
        sys.exit("Aucun fichier SQL trouve")

    errors = 0
    total_tables = total_indexes = total_funcs = total_triggers = total_views = 0

    for path in files:
        name = os.path.basename(path)
        with open(path, encoding="ascii", errors="replace") as fh:
            raw = fh.read()

        non_ascii = [i for i, ch in enumerate(raw) if ord(ch) > 127]
        if non_ascii:
            print(f"  [!] {name}: {len(non_ascii)} caractere(s) non ASCII")
            errors += 1

        try:
            stmts = parse_sql(strip_meta(raw))
        except ParseError as exc:
            line = getattr(exc, "location", None)
            print(f"  [ERREUR] {name}" + (f" (ligne {line})" if line else ""))
            print(f"           {exc}")
            errors += 1
            continue

        t = count(raw, r"create table ")
        i = count(raw, r"create (unique )?index ")
        f = count(raw, r"create (or replace )?function ")
        g = count(raw, r"create (constraint )?trigger ")
        v = count(raw, r"create (or replace )?view ")
        p = count(raw, r"create policy ")
        total_tables += t
        total_indexes += i
        total_funcs += f
        total_triggers += g
        total_views += v

        print(
            f"  [ok] {name:<28} {len(stmts):>3} instructions | "
            f"{t} tables, {v} vues, {i} index, {f} fonctions, {g} triggers, {p} politiques"
        )

    print()
    print(f"TOTAL : {total_tables} tables, {total_views} vues, {total_indexes} index, "
          f"{total_funcs} fonctions, {total_triggers} triggers")

    if errors:
        print(f"\n{errors} fichier(s) en erreur")
        return 1
    print("Syntaxe SQL valide pour tous les fichiers.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

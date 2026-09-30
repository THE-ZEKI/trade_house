#!/usr/bin/env python3
"""
trade_house · tools/validate_schema.py

Controle semantique statique, sans serveur : verifie que toute table, colonne
et cle etrangere referencee par les migrations existe bien dans le corpus.

  python db/tools/validate_schema.py
"""
from __future__ import annotations

import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATIONS = sorted(glob.glob(os.path.join(HERE, "..", "migrations", "*.sql")))

CREATE_TABLE = re.compile(
    r"create table (?:if not exists )?(public\.)?(\w+)\s*\((.*?)\n\);", re.I | re.S
)
COLUMN = re.compile(r"^\s{2}(\w+)\s+[a-z][\w ]*", re.I)
CONSTRAINT_KW = ("constraint", "primary", "unique", "check", "foreign", "exclude")

tables: dict[str, set[str]] = {}
errors: list[str] = []
warnings: list[str] = []

# Contrat d'API : toute fonction listée ici doit exister dans les migrations.
# (source de vérité : README.md, section « API metier »)
EXPECTED_FUNCTIONS = {
    # comptes
    "create_user", "issue_invitation", "accept_invitation", "set_password",
    "deactivate_user", "reactivate_user", "update_profile", "hash_token",
    "fn_password_meets_policy", "current_user_id", "current_user_role",
    "set_user", "is_admin", "is_manager", "is_trader", "can_manage_trader",
    "can_view_trader", "can_access_meeting", "can_edit_meeting", "settings",
    "fn_audit", "fn_touch_updated_at",
    # reunions
    "create_meeting", "meeting_conflicts", "cancel_meeting", "reschedule_meeting",
    "update_meeting_link", "rsvp", "send_manual_reminder", "fn_set_current_link",
    "fn_meeting_links_sync", "fn_meeting_link_required", "fn_reminder_guard",
    "fn_participant_guard",
    # rappels
    "claim_due_reminders", "prepare_reminder", "mark_notification_sent",
    "mark_notification_failed", "complete_reminder",
    # salle et presence
    "attendance_join", "attendance_leave", "materialize_attendance",
    "close_meeting", "fn_attendance_close",
    # rapports et corrections
    "reviewers_of", "fn_notify", "submit_report", "resubmit_report",
    "declare_no_trade", "cancel_no_trade", "start_review", "add_correction",
    "request_corrections", "respond_correction", "arbitrate_correction",
    "validate_report", "dismiss_report", "reopen_report",
    "fn_report_transition", "fn_report_validate", "fn_report_version_snapshot",
    "fn_report_files_limits", "fn_users_cascade_reports",
    # comptes : garde-fous
    "fn_users_manager_guard", "fn_users_deactivate_guard",
    "fn_invitations_revoke_previous",
}


def load_corpus() -> str:
    parts = []
    for path in MIGRATIONS:
        with open(path, encoding="ascii") as fh:
            parts.append(fh.read())
    return "\n".join(parts)


def collect_tables(corpus: str) -> None:
    for m in CREATE_TABLE.finditer(corpus):
        name, body = m.group(2).lower(), m.group(3)
        cols = set()
        for line in body.splitlines():
            s = line.strip()
            if not s or s.startswith("--"):
                continue
            head = s.split()[0].lower()
            if head in CONSTRAINT_KW:
                continue
            c = COLUMN.match(line)
            if c:
                cols.add(c.group(1).lower())
        tables[name] = cols


def check(label: str, table: str, column: str | None, where: str) -> None:
    t = table.lower()
    if t not in tables:
        errors.append(f"{where}: table inconnue {label} {t}")
        return
    if column and column.lower() not in tables[t]:
        errors.append(f"{where}: colonne inconnue {t}.{column.lower()}")


def main() -> int:
    corpus = load_corpus()
    collect_tables(corpus)
    print(f"Tables detectees : {len(tables)}")

    # 1. cles etrangeres
    for m in re.finditer(
        r"references\s+(?:public\.)?(\w+)\s*(?:\(\s*(\w+)\s*\))?", corpus, re.I
    ):
        check("references", m.group(1), m.group(2), "cle etrangere")

    # 2. alter table / trigger / policy
    for m in re.finditer(r"alter table\s+(?:public\.)?(\w+)", corpus, re.I):
        check("alter table", m.group(1), None, "alter table")
    for m in re.finditer(
        r"create (?:constraint )?trigger\s+\w+[\s\S]{0,200}?on\s+(?:public\.)?(\w+)", corpus, re.I
    ):
        check("trigger", m.group(1), None, "trigger")
    for m in re.finditer(
        r"create policy\s+\w+\s+on\s+(?:public\.)?(\w+)", corpus, re.I
    ):
        check("policy", m.group(1), None, "policy")
    for m in re.finditer(r"on conflict[^\n]*?do nothing", corpus, re.I):
        pass  # cible deduite par le INSERT, traitee ci-dessous

    # 3. insert into ... (colonnes)
    for m in re.finditer(
        r"insert into\s+(?:public\.)?(\w+)\s*\(([^)]*)\)", corpus, re.I | re.S
    ):
        table, cols = m.group(1), m.group(2)
        if "select" in cols.lower():  # INSERT ... SELECT : pas de liste explicite
            continue
        for col in cols.split(","):
            col = col.strip()
            if col:
                check("insert into", table, col, "insert into")

    # 4. update ... set (colonnes affectees)
    for m in re.finditer(
        r"update\s+(?:public\.)?(\w+)\s+(?:as\s+\w+\s+)?set\s+([^;]+?)(?:;|\n\s*(?:where|returning|and|or|--))",
        corpus,
        re.I | re.S,
    ):
        table, block = m.group(1), m.group(2)
        # les expressions CASE ne sont pas des affectations de colonnes
        block = re.sub(r"case\b[\s\S]*?\bend\b", " ", block, flags=re.I)
        for col in re.findall(r"(\w+)\s*=(?!=)", block):
            if col.lower() in ("case", "select", "and", "or", "not", "when", "then", "else"):
                continue
            check("update", table, col, "update set")

    # 5. fonctions app.* appelees mais jamais definies
    defined = {m.group(2).lower() for m in re.finditer(
        r"create (?:or replace )?function\s+(app\.)?(\w+)", corpus, re.I)}
    called = {m.group(1).lower() for m in re.finditer(r"\bapp\.(\w+)\s*\(", corpus)}
    for name in sorted(called - defined):
        warnings.append(f"fonction app.{name}() appelee mais non definie dans les migrations")

    # 6. contrat d'API : toute fonction attendue doit etre definie
    for name in sorted(EXPECTED_FUNCTIONS - defined):
        errors.append(f"fonction attendue absente des migrations : app.{name}()")

    for w in warnings:
        print(f"  [avertissement] {w}")
    for e in errors:
        print(f"  [ERREUR] {e}")

    print()
    if errors:
        print(f"{len(errors)} erreur(s) semantique(s)")
        return 1
    print("Toutes les tables, colonnes et cles etrangeres referencees existent.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

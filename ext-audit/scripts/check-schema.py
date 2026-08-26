#!/usr/bin/env python3
"""
Valida el esquema de la base de datos aplicando las migraciones sobre un
SQLite efimero. D1 es SQLite, asi que un error aqui es un error en produccion.

Uso:  python3 scripts/check-schema.py
"""
import glob
import io
import os
import sqlite3
import sys
import tempfile

def main() -> int:
    db_path = os.path.join(tempfile.mkdtemp(), 'schema-check.db')
    con = sqlite3.connect(db_path)

    for path in sorted(glob.glob('migrations/*.sql')):
        try:
            con.executescript(io.open(path, encoding='utf-8').read())
            print(f'  OK   {path}')
        except sqlite3.Error as exc:
            print(f'  FALLO {path}: {exc}', file=sys.stderr)
            return 1

    seed = 'scripts/seed-demo.sql'
    if os.path.exists(seed):
        try:
            con.executescript(io.open(seed, encoding='utf-8').read())
            print(f'  OK   {seed}')
        except sqlite3.Error as exc:
            print(f'  FALLO {seed}: {exc}', file=sys.stderr)
            return 1

    con.execute('PRAGMA foreign_keys = ON')
    violations = con.execute('PRAGMA foreign_key_check').fetchall()
    if violations:
        print(f'  FALLO integridad referencial: {violations}', file=sys.stderr)
        return 1

    objects = con.execute(
        "SELECT type, name FROM sqlite_master WHERE type IN ('table','view') ORDER BY type, name"
    ).fetchall()

    # Las vistas deben ser consultables (detecta columnas mal referenciadas).
    for kind, name in objects:
        if kind == 'view':
            try:
                con.execute(f'SELECT * FROM "{name}" LIMIT 1').fetchall()
            except sqlite3.Error as exc:
                print(f'  FALLO vista {name}: {exc}', file=sys.stderr)
                return 1

    tables = [n for k, n in objects if k == 'table']
    views = [n for k, n in objects if k == 'view']
    esperadas = {
        'campaigns', 'imported_accounts', 'companies', 'contract_administrators',
        'account_assignments', 'validation_requests', 'validation_responses',
        'email_deliveries', 'audit_log', 'user_actions',
    }
    faltantes = esperadas - set(tables)
    if faltantes:
        print(f'  FALLO faltan tablas del modelo: {sorted(faltantes)}', file=sys.stderr)
        return 1

    print(f'OK: {len(tables)} tablas y {len(views)} vistas, integridad referencial correcta.')
    return 0


if __name__ == '__main__':
    sys.exit(main())

# Backups de `trips.json`

Snapshots versionados, criados antes de qualquer migração ou
operação automatizada que reescreva `data/trips.json`.

## Convenção

Nome: `trips.YYYY-MM-DD.json` (ou `.YYYY-MM-DD-HHMM.json` se houver
mais de um no mesmo dia).

Conteúdo: cópia literal do `data/trips.json` no instante anterior à
mudança. Validável contra `data/schemas/trips-file.schema.json` (o
schema é tolerante o suficiente para aceitar versões mais antigas).

## Quando criar um backup

- Antes de migração manual em massa (ex: Fase 1b)
- Antes de operação destrutiva (ex: re-merge de sync)

O backup automático do `sync.py` (criado na Fase 1c) usará a mesma
pasta com a mesma convenção.

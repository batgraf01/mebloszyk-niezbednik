# Backup i rollback (release)

Ten zestaw daje bezpieczne, wersjonowane snapshoty zmian kodu oraz szybki rollback.

## Pliki

- `ops/release/create_release.py` - tworzy snapshot release i wpis w `zmiany.log`
- `ops/release/rollback_release.py` - przywraca wybrany release (domyslnie ostatni)
- `ops/release/prune_releases.py` - usuwa stare snapshoty wg retencji

## Gdzie sa backupy

- `backups/releases/<CHANGE_ID>__<YYYYMMDD_HHMMSS>/...`
- `backups/rollback_pre/<YYYYMMDD_HHMMSS>/...` (kopie "przed rollbackiem")
- Dziennik zdarzen: `zmiany.log` (lokalnie i na serwerze)

## Minimalny flow przed kazdym deployem

1) Zrob snapshot:

```bash
python ops/release/create_release.py --note "Opis zmiany"
```

2) Wdrozenie plikow

3) Smoke test

4) W razie problemu rollback:

```bash
python ops/release/rollback_release.py --release R-20260403-120000 --note "Rollback po bledzie"
```

lub bez `--release` (cofa ostatni snapshot):

```bash
python ops/release/rollback_release.py --note "Rollback ostatniego release"
```

## Retencja (zeby nie zapchac serwera)

Domyslnie skrypty trzymaja 20 ostatnich release.
Mozesz recznie odchudzic:

```bash
python ops/release/prune_releases.py --keep 20
```

## Automatyka na serwerze (cron)

Przyklad dziennego prune:

```bash
0 3 * * * cd /opt/batgraf/mag1 && /usr/bin/python3 ops/release/prune_releases.py --keep 20 >> /var/log/mag1-prune.log 2>&1
```

## Uwagi

- Snapshoty obejmuja domyslnie: `app.py`, `base_panel.html`, `templates/base_panel.html`, `templates/kontakty.html`, `shared/kontakty.json`.
- Jesli chcesz rozszerzyc zakres, podaj dodatkowe `--items ...` przy `create_release.py`.
- To uzupelnia GitHub (nie zastepuje historii commitow).


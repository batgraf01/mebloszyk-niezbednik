# Niezbędnik – wytyczne do pracy

> **Jak używać:** Otwórz ten plik w Cursor (lub dodaj folder WYTYCZNE do workspace) i powiedz agentowi: „Otwórz niezbednik.md” / „Przeczytaj wytyczne Niezbędnika”. Agent odczyta ten plik i będzie miał pełny kontekst.

---

## Lokalizacja projektu

| Co | Ścieżka |
|----|--------|
| **Workspace Cursor** | `/opt/batgraf/mag1` (VPS / serwer) lub odpowiednik lokalny |
| **Aplikacja** | mebloszyk.pl (Flask, Gunicorn, Nginx) |
| **Moduł** | Zgłoszenia (wcześniej: Reklamacje) |

---

## Technologie

- **Backend:** Python, Flask, SQLite/PostgreSQL (reklamacje)
- **Frontend:** HTML (templates/reklamacje.html), Bootstrap, vanilla JS
- **Skrypt zewnętrzny:** Tampermonkey – Mebloszyk (integracja z SellRocket/Rakieta)

---

## Ostatnie zmiany (do uzupełniania)

1. **UI:** Zamiana „reklamacje” → „zgłoszenia” (etykiety, menu, komunikaty).
2. **Typ zgłoszenia:** „Typ reklamacji” → „Typ zgłoszenia”; dodana opcja „Zgłoszenie niereklamacyjne”.
3. **Pole braki/wady:** Fix zapisu – `syncMissingWithParts()` nie nadpisuje już zapisanej wartości z API; uzupełnia z listy części tylko gdy pole puste.
4. **Skrypt Mebloszyk (v0.3.3):**  
   - Auto-otwarcie pierwszego zamówienia tylko po wejściu z Niezbędnika (mr_q).  
   - Po przekierowaniu (`ensureSearchParams`) sesja w GM – `fromReklamacje = hadQuery \|\| GM_getValue(KEYS.autoCopySession)`.  
   - `waitAndOpenFirstResult()` – odpytywanie co 500 ms (max 15 s), klik w pierwszy link z tabeli (`getOrderLinks()`).  
   - Plik skryptu: `mebloszyk-sellrocket-v2.user.js` (pełna wersja).

---

## Ważne pliki

| Plik | Opis |
|------|------|
| `app.py` | Backend Flask, API reklamacji, walidacja |
| `templates/reklamacje.html` | Widok Zgłoszeń (formularze, lista, szczegóły, JS) |
| `templates/base_panel.html` | Menu boczne (Zgłoszenia w nav) |
| `templates/dashboard.html` | Dashboard, kafelek Zgłoszenia |
| `mebloszyk-sellrocket-v2.user.js` | Skrypt TM – kopiowanie z Rakiety do Niezbędnika |

---

## Jak wrócić do pracy

1. W Cursor otwórz workspace **mag1** (lub folder z Niezbędnikiem).
2. Powiedz agentowi: **„Otwórz niezbednik.md”** lub **„Przeczytaj wytyczne Niezbędnika”** (jeśli plik jest w workspace / WYTYCZNE).
3. Opcjonalnie: **„Przypomnij, co ostatnio robiliśmy”** – agent użyje tego pliku + historii.

---

## Format tego pliku

- **Rozszerzenie:** `.md` (Markdown).
- **Edytuj** sekcję „Ostatnie zmiany” po każdej większej pracy – dopisuj punkty, datę, krótki opis.
- **Struktura:** nagłówki `##`, tabele, listy – agent dobrze to czyta.

---

*Ostatnia aktualizacja wytycznych: [data – uzupełnij ręcznie]*

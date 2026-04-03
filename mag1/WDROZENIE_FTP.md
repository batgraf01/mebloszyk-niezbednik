═══════════════════════════════════════════════════════════════
  WDROŻENIE APLIKACJI MAGAZYN NA SERWER PRZEZ FTP
═══════════════════════════════════════════════════════════════

⚠️  WAŻNE - WYMAGANIA SERWERA:

Aplikacja Flask wymaga:
✓ Python 3.7+ na serwerze
✓ Możliwość uruchomienia aplikacji Python (WSGI, CGI, lub moduł)
✓ Dostęp przez FTP

═══════════════════════════════════════════════════════════════

📦 PLIKI DO WGRANIA NA SERWER:

1. Wgraj WSZYSTKIE pliki z katalogu mag1 przez FTP:

   ✓ app.py                    - Główny plik aplikacji Flask
   ✓ requirements.txt          - Zależności Python
   ✓ static/                   - Folder ze stylami CSS
     └── style.css
   ✓ templates/                - Folder z szablonami HTML
     ├── login.html
     ├── magazyn.html
     ├── availability.html
     ├── base.html
     ├── dashboard.html
     └── tickets.html

═══════════════════════════════════════════════════════════════

🔧 KONFIGURACJA NA SERWERZE:

1. POŁĄCZENIE FTP:
   - Użyj klienta FTP (FileZilla, WinSCP, itp.)
   - Połącz się z serwerem Aftermarket

2. STRUKTURA PLIKÓW NA SERWERZE:
   
   Powinno wyglądać tak:
   
   /public_html/              (lub główny katalog domeny)
   ├── app.py
   ├── requirements.txt
   ├── static/
   │   └── style.css
   └── templates/
       ├── login.html
       ├── magazyn.html
       └── ...

3. INSTALACJA ZALEŻNOŚCI:
   
   Jeśli masz dostęp SSH lub Panel zarządzania:
   
   cd /sciezka/do/aplikacji
   pip3 install -r requirements.txt

4. KONFIGURACJA APLIKACJI:
   
   Jeśli serwer używa mod_wsgi lub podobnego:
   - Może być potrzebny plik .htaccess
   - Lub plik wsgi.py
   
   Jeśli serwer obsługuje CGI:
   - Może być potrzebny plik .htaccess z konfiguracją

═══════════════════════════════════════════════════════════════

📝 PLIK .htaccess (jeśli potrzebny):

Jeśli serwer używa Apache z mod_wsgi:

```apache
WSGIPythonPath /sciezka/do/aplikacji
WSGIScriptAlias / /sciezka/do/aplikacji/app.wsgi

<Directory /sciezka/do/aplikacji>
    WSGIApplicationGroup %{GLOBAL}
    Order allow,deny
    Allow from all
</Directory>
```

═══════════════════════════════════════════════════════════════

⚙️  WERYFIKACJA PO WDROŻENIU:

1. Sprawdź czy pliki są na serwerze
2. Sprawdź czy Python jest dostępny
3. Sprawdź czy Flask można zainstalować
4. Przetestuj dostępność aplikacji

═══════════════════════════════════════════════════════════════

🔐 BEZPIECZEŃSTWO:

⚠️  WAŻNE: Po wdrożeniu na produkcję ZMIEŃ klucz sesji!

W pliku app.py linia 6:
app.secret_key = 'suuhouse-magazyn-secret-key-change-in-production-2025'

Zmień na losowy, długi ciąg znaków!

═══════════════════════════════════════════════════════════════

📞 PROBLEMY?

Jeśli masz tylko dostęp FTP:
- Sprawdź w panelu zarządzania serwerem, czy Python jest dostępny
- Skontaktuj się z hostingiem, aby upewnić się, że Flask jest obsługiwany
- Może być potrzebny upgrade planu hostingu

═══════════════════════════════════════════════════════════════


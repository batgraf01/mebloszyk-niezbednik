from flask import Flask, render_template, request, redirect, url_for, session, send_from_directory, jsonify, flash
from functools import wraps
import os
from werkzeug.utils import secure_filename
import datetime
import csv
import io
import requests

app = Flask(__name__, static_folder='static', static_url_path='/static')
app.secret_key = 'suuhouse-magazyn-secret-key-change-in-production-2025'
app.config['UPLOAD_FOLDER'] = 'shared'
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size

# Dozwolone rozszerzenia plików
ALLOWED_EXTENSIONS = {'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'doc', 'docx', 'xls', 'xlsx', 'zip', 'rar', 'mp4', 'avi', 'mp3'}

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# Prosta baza użytkowników (w produkcji użyj prawdziwej bazy)
USERS = {
    'suu': 'Suuhouse123'
}

# Google Sheets / Drive file (stan magazynu)
GOOGLE_SHEET_ID = '1qN8sUUUXv1PXjjVLoEwhCeoTI5XDUQzC4gHQLNkhvhg'
GOOGLE_SHEET_GID = '0'

CACHE_BUSTER = "20260108-21"

@app.context_processor
def inject_cache_buster():
    # Used in templates to bust long-lived static caching
    return {"cache_buster": CACHE_BUSTER}

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/')
def index():
    return redirect(url_for('rozmiary'))

# File sharing routes (no authentication required)
@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'Brak pliku'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Nie wybrano pliku'}), 400

    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)

        return jsonify({
            'success': True,
            'filename': filename,
            'url': f'/download/shared/{filename}',
            'message': f'Plik {filename} został przesłany pomyślnie!'
        }), 200
    else:
        return jsonify({'error': 'Niedozwolony typ pliku'}), 400

@app.route('/download/shared/<filename>')
def download_shared_file(filename):
    """Pobierz plik z katalogu shared"""
    try:
        return send_from_directory(app.config['UPLOAD_FOLDER'], filename, as_attachment=True)
    except FileNotFoundError:
        return jsonify({'error': 'Plik nie istnieje'}), 404

@app.route('/files')
def get_files():
    """Pobierz listę dostępnych plików"""
    files = []
    if os.path.exists(app.config['UPLOAD_FOLDER']):
        for filename in os.listdir(app.config['UPLOAD_FOLDER']):
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            if os.path.isfile(filepath):
                stat = os.stat(filepath)
                files.append({
                    'name': filename,
                    'size': stat.st_size,
                    'modified': datetime.datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S')
                })

    return jsonify(files)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        
        # Debugowanie (można usunąć później)
        print(f"[DEBUG] Próba logowania: username='{username}', password='{password}'")
        print(f"[DEBUG] Dostępni użytkownicy: {list(USERS.keys())}")
        if username in USERS:
            print(f"[DEBUG] Użytkownik znaleziony. Oczekiwane hasło: '{USERS[username]}'")
            print(f"[DEBUG] Porównanie: '{USERS[username]}' == '{password}' -> {USERS[username] == password}")
        
        if username in USERS and USERS[username] == password:
            session['logged_in'] = True
            session['username'] = username
            print(f"[DEBUG] Logowanie udane dla użytkownika: {username}")
            return redirect(url_for('index'))
        else:
            print(f"[DEBUG] Logowanie nieudane dla użytkownika: {username}")
            return render_template('login.html', error='Nieprawidłowa nazwa użytkownika lub hasło')
    
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/magazyn')
@login_required
def magazyn():
    return render_template('magazyn_new.html',
                         sheet_id=GOOGLE_SHEET_ID,
                         sheet_gid=GOOGLE_SHEET_GID,
                         username=session.get('username', 'Użytkownik'))


def fetch_inventory():
    """
    Pobiera arkusz w formacie CSV i zwraca listę słowników.
    """
    candidates = [
        f"https://docs.google.com/spreadsheets/d/{GOOGLE_SHEET_ID}/export?format=csv&gid={GOOGLE_SHEET_GID}",
        f"https://drive.google.com/uc?export=download&id={GOOGLE_SHEET_ID}",
    ]
    last_error = None
    for url in candidates:
        try:
            resp = requests.get(url, timeout=15)
            resp.raise_for_status()
            content = resp.content.decode('utf-8', errors='ignore')
            # Odrzuć HTML (np. brak dostępu)
            if content.lstrip().lower().startswith("<!doctype") or content.lstrip().lower().startswith("<html"):
                raise ValueError("Otrzymano HTML zamiast CSV (brak dostępu?)")
            reader = csv.DictReader(io.StringIO(content))
            rows = list(reader)
            if rows:
                return rows
            last_error = ValueError("Brak wierszy w CSV")
        except Exception as exc:
            last_error = exc
            continue
    if last_error:
        raise last_error
    raise RuntimeError("Nie udało się pobrać danych z arkusza")


def parse_inventory_rows(rows):
    items = []
    now_ts = datetime.datetime.utcnow().isoformat() + "Z"
    for row in rows:
        items.append({
            "code": (row.get("Kod") or "").strip(),
            "name": (row.get("Nazwa") or "").strip(),
            "unit": (row.get("jm") or "").strip(),
            "ean": (row.get("EAN") or "").strip(),
            "stock": (row.get("Stan") or row.get("STAN") or "").strip(),
            "reservation": (row.get("Rezerwacja") or "").strip(),
            "availability": (row.get("Dostepnosc") or row.get("Dostępność") or "").strip(),
        })
    return {"updated_at": now_ts, "items": items}


@app.route('/api/magazyn')
def magazyn_api():
    try:
        rows = fetch_inventory()
        data = parse_inventory_rows(rows)
        return jsonify({"success": True, **data})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500

@app.route('/tickets')
@login_required
def tickets():
    return render_template('tickets.html', username=session.get('username', 'Użytkownik'))

@app.route('/availability')
@login_required
def availability():
    return render_template('availability.html', 
                         sheet_id=GOOGLE_SHEET_ID,
                         sheet_gid=GOOGLE_SHEET_GID,
                         username=session.get('username', 'Użytkownik'))

@app.route('/rozmiary')
def rozmiary():
    return render_template('rozmiary.html', username=session.get('username', 'Użytkownik'))

@app.route('/magazyn-new')
def magazyn_new():
    return render_template('magazyn_new.html', username=session.get('username', 'Użytkownik'))

@app.route('/reklamacje')
def reklamacje():
    return render_template('reklamacje.html', username=session.get('username', 'Użytkownik'))

@app.route('/ustawienia')
def ustawienia():
    return render_template('ustawienia.html', username=session.get('username', 'Użytkownik'))

# Jawna obsługa plików statycznych (backup)
@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory(app.static_folder, filename)

# Dla produkcji (Docker/WSGI)
application = app

if __name__ == '__main__':
    # Dla lokalnego uruchomienia
    app.run(debug=True, port=5000, host='0.0.0.0')

#!/usr/bin/env python3
"""
Erasmus Takip — GitHub otomatik push scripti
Kullanım: python3 github_push.py
"""
import requests, base64, os, sys

REPO  = "firatarslan-gif/erasmus-takip"
BRANCH = "main"
FILES = [
    "index.html",
    "erasdesk_login.html",
    "erasdesk_portal.html",
    "erasdesk_koordinator.html",
]  # Yüklenecek dosyalar

# Token dosyasından oku
_dir = os.path.dirname(os.path.abspath(__file__))
_cfg = os.path.join(_dir, ".gh_config")
try:
    with open(_cfg) as f:
        TOKEN = f.read().strip()
except FileNotFoundError:
    print("HATA: .gh_config dosyası bulunamadı"); sys.exit(1)

HEADERS = {
    "Authorization": f"token {TOKEN}",
    "Accept": "application/vnd.github.v3+json"
}

def push_file(filename):
    filepath = os.path.join(_dir, filename)
    with open(filepath, "rb") as f:
        content = base64.b64encode(f.read()).decode("utf-8")

    # Mevcut SHA'yı al (güncelleme için gerekli)
    print(f"  SHA alınıyor...", flush=True)
    r = requests.get(
        f"https://api.github.com/repos/{REPO}/contents/{filename}",
        headers=HEADERS, params={"ref": BRANCH}, timeout=30
    )
    sha = r.json().get("sha", "") if r.status_code == 200 else ""
    print(f"  SHA: {sha[:10] if sha else 'yok'}", flush=True)

    # Dosyayı yükle / güncelle
    payload = {
        "message": f"Otomatik güncelleme: {filename}",
        "content": content,
        "branch": BRANCH
    }
    if sha:
        payload["sha"] = sha

    print(f"  Yükleniyor ({len(content)//1024} KB)...", flush=True)
    r = requests.put(
        f"https://api.github.com/repos/{REPO}/contents/{filename}",
        headers=HEADERS, json=payload, timeout=60
    )
    if r.status_code in (200, 201):
        print(f"✅ {filename} → GitHub'a yüklendi")
    else:
        print(f"❌ {filename} HATA: {r.status_code} — {r.json().get('message','')}")

if __name__ == "__main__":
    for f in FILES:
        push_file(f)
    print("Bitti.")

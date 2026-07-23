#!/usr/bin/env python3
"""
auto_push.py — index.html değişince otomatik GitHub'a yükler.
Terminalde bir kez çalıştır, arka planda çalışır.
Durdurmak için: Ctrl+C
"""
import time, hashlib, subprocess, os, sys

FILE = os.path.join(os.path.dirname(__file__), 'index.html')
PUSH = os.path.join(os.path.dirname(__file__), 'github_push.py')
INTERVAL = 6  # saniyede bir kontrol

def file_hash(path):
    try:
        with open(path, 'rb') as f:
            return hashlib.md5(f.read()).hexdigest()
    except FileNotFoundError:
        return None

print("👁️  Auto-push aktif — index.html izleniyor")
print(f"   Dosya: {FILE}")
print("   Durdurmak için: Ctrl+C\n")

last_hash = file_hash(FILE)
last_push = 0
COOLDOWN = 15  # aynı değişiklik için minimum bekleme (sn)

try:
    while True:
        time.sleep(INTERVAL)
        h = file_hash(FILE)
        if h is None:
            continue
        now = time.time()
        if h != last_hash and (now - last_push) > COOLDOWN:
            last_hash = h
            last_push = now
            print(f"🔄 Değişiklik algılandı [{time.strftime('%H:%M:%S')}] — GitHub'a yükleniyor...")
            result = subprocess.run(
                [sys.executable, PUSH],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                print(f"✅ Yüklendi! {result.stdout.strip()}")
            else:
                print(f"❌ Hata: {result.stderr.strip()}")
except KeyboardInterrupt:
    print("\n⏹️  Auto-push durduruldu.")

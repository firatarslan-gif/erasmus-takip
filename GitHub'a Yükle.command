#!/bin/bash
cd "$(dirname "$0")"
echo "📤 GitHub'a yükleniyor..."
python3 github_push.py
echo ""
echo "✅ Tamamlandı! Bu pencereyi kapatabilirsin."
read -p "Kapatmak için Enter'a bas..."

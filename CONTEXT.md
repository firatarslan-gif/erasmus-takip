# Erasmus Akreditasyon — Proje Bağlamı

> **Claude için:** Her yeni oturumda bu dosyayı oku. Kullanıcı "devam et" veya benzer bir şey dediğinde buradan başla.

## Proje Özeti

Kocaeli MEM Erasmus+ 2025 SCH akreditasyon süreçlerini takip eden tek sayfalık HTML dashboard. 41 okul, 68 hareketlilik. Dosya: `erasmus_v13.html` (~4.7MB, tüm JS/CSS/veri tek dosyada).

## Ana Dosyalar

| Dosya | Açıklama |
|-------|----------|
| `erasmus_v13.html` | Ana dashboard — tüm sekmeler burada |
| `takip25_data.json` | 41 okul, 68 mob verisi (Drive sync kaynağı) |

## Teknik Mimari

- **TAKIP25_DATA** — HTML içine gömülü JS sabiti, 41 okul verisi
- **`_t25LastData`** — Render sırasında kullanılan değişken; önce localStorage, sonra TAKIP25_DATA
- **localStorage şema kontrolü** — `mobs[0].total !== undefined` kontrolü; geçersiz önbellek temizlenir
- **`window.sendPrompt()`** — Sadece Cowork webview'de çalışır; Chrome'da undefined
- **`_t25RequestUpdate()`** — Cowork'ta `sendPrompt` tetikler, Chrome'da JSON yapıştır alanı açar

## Drive Yapısı

- **Drive root (2025 okulları):** `1zXHr5XbFKMvgjLLj68xMtXbJjbzpsla-`
- **Google Drive MCP hesabı:** f.arslan@kocaeliarge.gov.tr
- **Drive search notu:** SADECE `parentId = 'ID'` sorguları çalışır — `name contains`, `mimeType` vb. çalışmaz
- **Alt klasör yapısı (her mob):** 1. Katılımcı Seçimi / 2. Hareketlilik Öncesi / 3. Hareketlilik Sonrası / 4. Ölçme ve Değerlendirme / 5. Tamamlandı Beyanı

## Veri Şeması (takip25_data.json)

```json
{
  "name": "İLÇE-OKUL ADI",
  "ilce": "İLÇE",
  "drive_id": "...",
  "durum": "oncesi",
  "mobs": [{
    "tur": "İşbaşı Öğrenme",
    "durum": "oncesi",
    "evet": 14, "hayir": 42, "total": 56, "pct": 25,
    "sec": {"oncesi": {"e":14,"h":25}, "sirasi": {"e":0,"h":4}, "sonrasi": {"e":0,"h":13}},
    "firstHayir": "İlk tamamlanmamış görevin adı",
    "sheet_id": "Google Sheets dosya ID",
    "mob_folder_id": "Drive klasör ID",
    "modifiedTime": "2026-06-22T05:49:29.605Z",
    "folders": {"secim":"ID","oncesi":"ID","sonrasi":"ID","olcme":"ID","tamam_beyani":"ID"},
    "gidis_tarihi": "YYYY-MM-DD veya null",
    "donus_tarihi": "YYYY-MM-DD veya null",
    "hibe_teslim": true
  }]
}
```

## Stage Hesaplama Kuralları

```
total > 0 && total == evet  → tamam       (✅ Tamamlandı)
total == 0 && evet == 0     → baslamamis  (⚠️ ASLA tamam değil — 0/0 bug düzeltildi)
sec.sonrasi.e > 0           → sonrasi
sec.sirasi.e > 0            → surasi
sec.oncesi.e >= 11          → oncesi
sec.oncesi.e > 0            → secim
else                        → baslamamis
```

## Spreadsheet Formatı

- **Sekme:** "Kontrol Listesi" — EVET/HAYIR satırları (Öncesi/Sırası/Sonrası bölümleri)
- **Sekme:** "Hareketlilik Bilgileri" — okul bilgileri, ev sahibi kurum, seyahat detayları
- **SEYAHAT TARİHLERİ** satırı: `DD/MM/YYYY-DD/MM/YYYY` formatı (boş = tarih girilmemiş)
- **"Hibe sözleşmeleri imzalandı, AR-GE birimine elden teslim edildi"** = EVET → hibe_teslim: true

## Seyahat Durumu (Render Zamanı Hesaplanır)

| Durum | Koşul | Görünüm |
|-------|-------|---------|
| Hareketlilik Gerçekleşti | donus_tarihi < bugün | ✅ Yeşil |
| Şu An Hareketlikte | gidis ≤ bugün ≤ donus | ✈️ Mavi (yanıp sönen) |
| Planlandı | hibe_teslim = true | 📋 Sarı |

Sıralama: Hareketlikte → Gerçekleşti → Planlandı → Diğerleri

## Zamanlanmış Görevler

Aşağıdaki görevleri **her yeni Mac'te bir kez kurman** yeterli. Cowork açıkken otomatik çalışırlar.

### Görev 1: takip25-drive-sync (Her gün 17:30)
- **Cron:** `30 17 * * *`
- **Açıklama:** Drive'dan günlük 17:30 takip sync

### Görev 2: takip25-drive-sync-gece (Her gün 23:00)
- **Cron:** `0 23 * * *`
- **Açıklama:** Drive'dan gece 23:00 takip sync

### Prompt (her iki görev için aynı):
```
2025 SCH takip güncelle (GAS → JSON → HTML)

Google Apps Script tarafından hazırlanan takip25_sync.json'u Drive'dan indirip HTML'e göm.

## Adımlar

1. Drive MCP ile dosyayı bul (f.arslan@kocaeliarge.gov.tr):
   - search_files: title = 'takip25_sync.json' and parentId = '1zXHr5XbFKMvgjLLj68xMtXbJjbzpsla-'
   - Bulunan dosyanın id alanını al

2. download_file_content ile tam içeriği indir (fileId = bulunan id)
   - Sonuç token limitini aşarsa dosya path'e kaydedilir — bash'te python3 ile oku:
     import json, base64; wrapper=json.load(open(PATH)); data=json.loads(base64.b64decode(wrapper['content']))

3. data['schools'] dizisini JSON string'e çevir (ensure_ascii=False, separators=(',',':'))

4. erasmus_v13.html'deki TAKIP25_DATA'yı güncelle (Python ile):
   - Dosya: /Users/firatimac/Documents/Claude/Projects/Erasmus Akreditasyon/erasmus_v13.html
   - var TAKIP25_DATA= ile başlayan yeri bul, açılış [ dan kapanış ] a kadar yeni veriyle değiştir
   - Bracket matching ile doğru kapanış köşeli parantezini bul (iç içe array'ler var)
   - Sync tarihini güncelle: Gömülü veri (son Drive sync: GG.AA.YYYY) → bugünün tarihi

5. Özet ver: kaç okul, kaç hareketlilik, syncTime, işlem süresi

Hata durumu: takip25_sync.json bulunamazsa dur ve belirt.
```

## GAS Kurulumu (tamamlandı — 23.06.2026)

- **Script:** script.google.com → Erasmus2025Takip projesi (f.arslan@kocaeliarge.gov.tr)
- **sourceFileId:** `1F-jVln4OAm4PXLAJV2Rrq5dZmb5UG963` (takip25_data.json)
- **outputFolderId:** `1zXHr5XbFKMvgjLLj68xMtXbJjbzpsla-`
- **Tetikleyiciler:** Her gün 07:00, 17:00, 22:00 (otomatik)
- **Çıktı:** `takip25_sync.json` (Drive'da, ~83KB, fileId: `19RxqYmVhm3LCQGBlHOGaZEN5Iq-c26PD`)
- **İlk sync:** 23.06.2026 — 85 sn'de 68 mob, 0 hata

## Ev Mac'inde İlk Kurulum

Yeni bir Mac'te Cowork açınca Claude'a şunu söyle:

> "CONTEXT.md dosyasını oku ve zamanlanmış görevleri kur"

Claude bu dosyayı okuyup görevleri otomatik kurar.

## Önemli Notlar

- HTML dosyasında unicode kaçış dizileri var (`\uXXXX`) — Edit aracı yerine Python `str.replace()` kullan
- localStorage eski şeması için `mobs[0].total` kontrolü yapılıyor, geçersizse temizleniyor
- `_t25FM(stage)` fonksiyonu satırları gizler/gösterir — yeniden render etmez
- iCloud Desktop & Documents sync aktif → dosyalar otomatik senkronize

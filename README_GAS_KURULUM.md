# Google Apps Script Kurulum Rehberi

Bu script, Erasmus+ 2025 SCH takip verilerini Drive'dan otomatik çekip `takip25_sync.json` dosyasına yazar.  
Claude bu dosyayı okur → HTML'e gömer. **1 API çağrısı, ~5 saniye.**

---

## Kurulum (bir kez yapılır)

### 1. takip25_data.json'u Drive'a yükle

1. Drive'ı aç: https://drive.google.com (f.arslan@kocaeliarge.gov.tr ile)
2. 2025 okulları klasörüne gir (`1zXHr5XbFKMvgjLLj68xMtXbJjbzpsla-`)
3. `takip25_data.json` dosyasını buraya sürükle-bırak

### 2. Google Apps Script projesi oluştur

1. https://script.google.com adresine git (aynı hesap)
2. **Yeni proje** tıkla
3. Projeye ad ver: `Erasmus2025Takip`
4. Varsayılan kodu sil
5. `takip25_gas_sync.gs` içindeki tüm kodu kopyalayıp yapıştır
6. **Kaydet** (Ctrl+S)

### 3. Drive dosya ID'sini bul

1. Script editöründe sağ üstten `findSourceFileId` fonksiyonunu seç
2. **Çalıştır** tıkla
3. İlk çalıştırmada izin iste → **İzin ver**
4. **Yürütme günlüğü**nde dosya ID'sini gör (şuna benzer: `1abc...xyz`)
5. Bu ID'yi kopyala

### 4. ID'yi script'e yapıştır

Script'te bu satırı bul ve ID'yi yapıştır:
```javascript
sourceFileId: '',  // ← buraya yapıştır
```
Örnek:
```javascript
sourceFileId: '1abc...xyz',
```
Kaydet.

### 5. Tek okul testi yap

1. `testSingleSchool` fonksiyonunu seç → **Çalıştır**
2. Günlükte EVET/HAYIR sayılarını ve tarih bilgilerini gör
3. Sonuçlar mantıklı görünüyorsa devam et

### 6. Tam sync'i test et

1. `syncTakip25` fonksiyonunu seç → **Çalıştır**
2. ~3-5 dakika bekle (68 spreadsheet ilk seferde biraz sürer)
3. Drive'da `takip25_sync.json` dosyasının oluştuğunu doğrula
4. Dosyayı aç — 41 okul verisi JSON formatında olmalı

### 7. Tetikleyicileri kur

1. `setupTriggers` fonksiyonunu seç → **Çalıştır**
2. Sol menüden **Tetikleyiciler** (saat simgesi) tıkla
3. 3 tetikleyicinin oluştuğunu doğrula: 07:00, 17:00, 22:00

---

## Artık nasıl çalışır

```
Google (günde 3x, otomatik):
  Apps Script → 68 spreadsheet oku → takip25_sync.json yaz

Sen "Güncelle" istediğinde Claude:
  takip25_sync.json oku (1 dosya) → HTML'e göm → Bitti (~5 sn)
```

---

## Sorun Giderme

| Sorun | Çözüm |
|-------|-------|
| "sourceFileId boş" hatası | 3. adımı tekrarla |
| "openById yetki hatası" | Script'i tekrar çalıştır ve izin ver |
| Bazı moblar güncellenmedi | Yürütme günlüğünde HATA satırlarını bak |
| takip25_sync.json oluşmadı | outputFolderId'yi Drive'da doğrula |

---

## Önemli: Claude sync komutunu güncelle

GAS kurulumundan sonra Claude'a şunu söyle:

> "Takip25 sync metodunu güncelle — artık GAS kullanıyoruz, takip25_sync.json'u oku"

Claude scheduled task'ı güncelleyecektir (68 yerine 1 dosya okuyacak).

---

## Dosya konumları

| Dosya | Konum |
|-------|-------|
| `takip25_data.json` | Yerel + Drive root (kaynak/şablon) |
| `takip25_sync.json` | Drive root (GAS çıktısı, güncel veri) |
| `erasmus_v13.html` | Yerel (Claude bu dosyayı günceller) |
| `takip25_gas_sync.gs` | Yerel (referans) + Google Apps Script projesi |

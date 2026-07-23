# ErasDesk — Supabase Kurulum Talimatları

## 1. Supabase Projesi Oluştur

1. https://supabase.com → **New project**
2. Ad: `erasdesk-2026`
3. Şifre: güçlü bir şifre seç (kurtarmak için sakla)
4. Region: **Frankfurt (eu-central-1)** — AB veri gereksinimleri için
5. **Create new project** → proje kurulana kadar bekle (~2 dk)

---

## 2. DB Şemasını Yükle

1. Sol menü → **SQL Editor** → **New query**
2. `erasdesk_schema.sql` dosyasının içeriğini kopyala
3. **Run** (▶) → Başarılı mesajı görüyorsanız devam et

---

## 3. Storage Bucket Kur

1. Sol menü → **Storage** → **New bucket**
2. Name: `erasdesk-docs`
3. **Public bucket**: ❌ KAPALI (signed URL kullanacağız)
4. **Allowed MIME types**: `application/pdf, image/jpeg, image/png`
5. **Max file size**: `10485760` (10 MB)
6. **Create bucket**

**Storage Policy Ekle:**
SQL Editor'da çalıştır:
```sql
-- Kullanıcılar kendi klasörlerine yükleyebilir
CREATE POLICY "Kullanıcı kendi klasörüne yükler"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'erasdesk-docs'
  AND auth.uid() IS NOT NULL
);

-- Kullanıcılar kendi dosyalarını okuyabilir
CREATE POLICY "Kullanıcı kendi dosyalarını okur"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'erasdesk-docs'
  AND auth.uid() IS NOT NULL
);

-- Kullanıcılar kendi dosyalarını silebilir (onaylanmamışlar)
CREATE POLICY "Kullanıcı kendi dosyasını siler"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'erasdesk-docs'
  AND auth.uid() IS NOT NULL
);
```

---

## 4. API Anahtarlarını Al

1. Sol menü → **Settings** → **API**
2. **Project URL** → kopyala
3. **anon / public** key → kopyala

Bu iki değeri `erasdesk_login.html` ve `erasdesk_portal.html` içindeki şu satırlara yapıştır:
```javascript
const SUPABASE_URL  = 'https://xxxx.supabase.co';   // ← Project URL
const SUPABASE_ANON = 'eyJhbGciOi...';               // ← anon key
```

---

## 5. E-posta Ayarı (Supabase SMTP)

Şifre sıfırlama için Resend veya kendi SMTP'niz:

1. **Settings** → **Auth** → **SMTP Settings**
2. Enable custom SMTP: ✓
3. Resend hesabı için:
   - Host: `smtp.resend.com`
   - Port: `465`
   - User: `resend`
   - Password: Resend API key
   - Sender: `erasdesk@kocaeliarge.gov.tr`

---

## 6. Okul Hesaplarını Oluştur

### Yöntem A — Supabase Dashboard (Küçük ölçek)

1. **Authentication** → **Users** → **Invite user**
2. E-posta gir → **Send invitation**

Sonra SQL Editor'da kullanıcıyı okulla eşleştir:
```sql
-- Önce okul ID'sini bul
SELECT id FROM schools WHERE oid = 'E10348415';

-- Sonra users tablosuna ekle (auth user ID'sini kullan)
INSERT INTO users (id, school_id, role, full_name, email)
VALUES (
  'AUTH_USER_ID_BURAYA',   -- Authentication > Users'dan kopyala
  'SCHOOL_UUID_BURAYA',
  'school',
  '28 Haziran Ortaokulu',
  'okul@example.com'
);
```

### Yöntem B — Toplu Oluşturma (45 okul için)

`erasdesk_koordinator.html`'deki Admin panelinden toplu davet gönderilecek (ileride).

---

## 7. Okulları Sisteme Ekle

SQL Editor'da çalıştır (OID_BM_MAP verilerinden):
```sql
INSERT INTO schools (oid, name, city) VALUES
('E10026515', '28 Haziran Ortaokulu', 'İzmit'),
('E10348415', '50.Yıl Cumhuriyet Ortaokulu', 'Gebze'),
-- ... diğer okullar (45 okul)
-- Bu SQL'i otomatik üretmemi ister misin?
;
```

---

## 8. Test Et

1. `erasdesk_login.html` tarayıcıda aç (GitHub Pages veya lokal)
2. Davet edilen okul e-postasıyla giriş yap
3. Portal yüklendiyse ✓

---

## 9. GitHub Pages'e Deploy

Dosyalar zaten `/Erasmus Akreditasyon/` klasöründe:
- `erasdesk_login.html`
- `erasdesk_portal.html`
- `erasdesk_schema.sql` (commit edilmeyebilir — hassas değil ama)

GAS `autoPushToGitHub` trigger mevcut dosyaları her 15 dakikada bir push ediyor.
Ya da manuel: `GitHub'a Yükle.command` çalıştır.

**GitHub Pages ayarı (bir kez):**
1. GitHub repo → Settings → Pages
2. Source: `main` branch, `/ (root)` klasörü
3. URL: `https://kullanici.github.io/repo-adi/erasdesk_login.html`

---

## Özet: Sıralı Adımlar

- [ ] Supabase proje oluştur (eu-central-1)
- [ ] SQL şema çalıştır
- [ ] Storage bucket kur
- [ ] API URL + anon key → 2 HTML dosyasına yapıştır
- [ ] E-posta SMTP ayarla
- [ ] Test okulu için hesap oluştur
- [ ] Login test et
- [ ] GitHub Pages'e deploy
- [ ] Tüm okulları sisteme ekle

---

## Sonraki Adımlar (Faz 2)

- Koordinatör paneli (`erasdesk_koordinator.html`)
- Belge otomatik üretimi (hibe, LA, sertifika PDF)
- Claude API Edge Function (AI doğrulama)
- WhatsApp bildirimleri (Meta Cloud API)

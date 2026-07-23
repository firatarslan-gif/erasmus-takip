-- ============================================================
-- ErasDesk — Supabase PostgreSQL Şeması
-- Proje: 2025-1-TR01-KA121-SCH-000340391
-- ============================================================

-- UUID extension (Supabase'de zaten aktif)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ============================================================
-- 1. OKULLAR
-- ============================================================
CREATE TABLE schools (
  id            UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  oid           TEXT    UNIQUE NOT NULL,          -- E10348415
  name          TEXT    NOT NULL,
  city          TEXT,
  address       TEXT,
  email         TEXT,                             -- okul e-postası
  phone         TEXT,
  principal_name TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- İndeks
CREATE INDEX idx_schools_oid ON schools(oid);


-- ============================================================
-- 2. KULLANICILAR
-- Supabase auth.users tablosunu extend eder.
-- ============================================================
CREATE TABLE users (
  id         UUID    REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  school_id  UUID    REFERENCES schools(id) ON DELETE SET NULL,
  role       TEXT    NOT NULL CHECK (role IN ('school', 'coordinator', 'admin')),
  full_name  TEXT,
  email      TEXT    NOT NULL,
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_school ON users(school_id);
CREATE INDEX idx_users_role   ON users(role);


-- ============================================================
-- 3. HAREKETLİLİKLER
-- ============================================================
CREATE TABLE mobilities (
  id                UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id         UUID    REFERENCES schools(id) ON DELETE CASCADE NOT NULL,
  flow_id           TEXT,                         -- FLAT._flowId (2025 verisi)
  activity_type     TEXT    NOT NULL,             -- SM-TTA, LM-GRP-PUPIL, SM-JOB-SHDW, SM-COUR-TRAIN, LM-SHORT-PUPIL, LM-LONG-PUPILS, PREP-VISIT, OA-INV-EXP
  destination_country TEXT,
  destination_org   TEXT,
  destination_city  TEXT,
  start_date        DATE,
  end_date          DATE,
  duration_days     INT     GENERATED ALWAYS AS (end_date - start_date + 1) STORED,
  grant_template    TEXT,                         -- hibe_grup / hibe_kisa_ogrenci / hibe_uzun_ogrenci / hibe_refakatci / hibe_ogretmen / hibe_isbasi / hibe_kurs
  num_participants  INT     DEFAULT 0,
  status            TEXT    DEFAULT 'planned'
                    CHECK (status IN ('planned','active','completed','cancelled')),
  turna_ref         TEXT,                         -- TurnaPortal referans
  bm_ref            TEXT,                         -- Bilgi Merkezi referans
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mobilities_school        ON mobilities(school_id);
CREATE INDEX idx_mobilities_activity_type ON mobilities(activity_type);
CREATE INDEX idx_mobilities_status        ON mobilities(status);


-- ============================================================
-- 4. KATILIMCILAR
-- ============================================================
CREATE TABLE participants (
  id            UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  mobility_id   UUID    REFERENCES mobilities(id) ON DELETE CASCADE NOT NULL,
  school_id     UUID    REFERENCES schools(id) ON DELETE CASCADE NOT NULL,
  full_name     TEXT    NOT NULL,
  tc_no         TEXT,
  birth_date    DATE,
  role          TEXT    CHECK (role IN ('student','teacher','accompanying','expert','staff')),
  email         TEXT,
  phone         TEXT,

  -- Mali bilgiler (hibe sözleşmesi için)
  iban          TEXT,
  bank_name     TEXT,
  bank_branch   TEXT,

  -- 18 yaş altı veli bilgileri
  guardian_name TEXT,
  guardian_tc   TEXT,
  guardian_phone TEXT,

  -- Dil gelişim planı (sistem içi form)
  lang_plan     JSONB,

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_participants_mobility ON participants(mobility_id);
CREATE INDEX idx_participants_school   ON participants(school_id);


-- ============================================================
-- 5. REFAKATÇİLER (Grup hareketliliğinde değişken sayıda)
-- ============================================================
CREATE TABLE accompanying_teachers (
  id          UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  mobility_id UUID    REFERENCES mobilities(id) ON DELETE CASCADE NOT NULL,
  full_name   TEXT    NOT NULL,
  title       TEXT,                             -- Öğretmen, Müdür Yardımcısı...
  tc_no       TEXT,
  iban        TEXT,
  bank_name   TEXT,
  bank_branch TEXT,
  sort_order  INT     DEFAULT 1,               -- imza bloğu sırası
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_acc_teachers_mobility ON accompanying_teachers(mobility_id);


-- ============================================================
-- 6. BELGELER
-- ============================================================
CREATE TABLE documents (
  id              UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id       UUID    REFERENCES schools(id) ON DELETE CASCADE NOT NULL,
  mobility_id     UUID    REFERENCES mobilities(id) ON DELETE CASCADE,
  participant_id  UUID    REFERENCES participants(id) ON DELETE SET NULL,

  doc_type        TEXT    NOT NULL,
  -- Değerler:
  -- hibe_soz | hibe_soz_imzali
  -- ogrenme_soz | ogrenme_soz_imzali
  -- faaliyet_programi | faaliyet_programi_imzali
  -- kvkk | sertifika | europass | europass_imzali
  -- boarding_pass | sigorta | bilet | konaklama
  -- kurs_proforma | kurs_fatura | beyan
  -- valilik_oluru | ortaklik_soz | katilimci_secim_tutanagi
  -- gorev_yeri_belgesi | anket | yansitma

  doc_level       TEXT    CHECK (doc_level IN ('school','mobility','participant')),
  version         INT     DEFAULT 1,
  is_auto_gen     BOOLEAN DEFAULT FALSE,       -- sistem mi üretti?

  status          TEXT    DEFAULT 'pending'
                  CHECK (status IN (
                    'pending',          -- henüz yüklenmedi / üretilmedi
                    'generated',        -- sistem üretti, imzalanmadı
                    'uploaded',         -- okul yükledi, onay bekliyor
                    'ai_checked',       -- AI inceledi
                    'approved',         -- koordinatör onayladı
                    'rejected',         -- koordinatör reddetti
                    'archived'          -- eski versiyon
                  )),

  file_url        TEXT,                        -- Supabase Storage URL
  file_name       TEXT,                        -- standart isim (sistem atar)
  file_size_bytes INT,
  file_mime       TEXT,

  -- AI doğrulama sonuçları
  ai_validation   JSONB,
  -- Örnek: {"checked": true, "name_match": true, "date_match": true, "warnings": ["kaza sigortası belirsiz"]}

  -- Koordinatör notu
  coordinator_note TEXT,
  reviewed_by     UUID    REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,

  generated_content JSONB, -- şablon için doldurulmuş alanlar (PDF yeniden üretmek için)

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_documents_school      ON documents(school_id);
CREATE INDEX idx_documents_mobility    ON documents(mobility_id);
CREATE INDEX idx_documents_participant ON documents(participant_id);
CREATE INDEX idx_documents_type_status ON documents(doc_type, status);


-- ============================================================
-- 7. BELGE VERSİYONLARI (Arşiv)
-- ============================================================
CREATE TABLE document_versions (
  id            UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id   UUID    REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
  version       INT     NOT NULL,
  file_url      TEXT,
  file_name     TEXT,
  file_size_bytes INT,
  uploaded_by   UUID    REFERENCES users(id),
  uploaded_at   TIMESTAMPTZ DEFAULT NOW(),
  note          TEXT                           -- "Yanlış kişi yüklendi, yeniden yüklendi" gibi
);

CREATE INDEX idx_doc_versions_doc ON document_versions(document_id);


-- ============================================================
-- 8. CHECKLİST TANIMLARI (Şablon — koordinatör yönetir)
-- ============================================================
CREATE TABLE checklist_definitions (
  id              UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  phase           TEXT    NOT NULL CHECK (phase IN ('oncesi','sirasi','sonrasi')),
  sort_order      INT     NOT NULL,
  title           TEXT    NOT NULL,
  check_type      TEXT    NOT NULL CHECK (check_type IN ('info','document','form')),

  -- Belge gerektiren maddeler için:
  required_doc_type TEXT,  -- documents.doc_type değeri

  -- Form gerektiren maddeler için:
  required_form_type TEXT, -- 'lang_plan' | 'anket' | 'yansitma' | 'on_test' | 'son_test'

  -- Sadece belirli faaliyet türleri için görünür (NULL = hepsi)
  activity_types  TEXT[],  -- örn: ARRAY['SM-COUR-TRAIN'] sadece kurs için

  -- Yardımcı link / metin
  helper_url      TEXT,
  helper_text     TEXT,

  is_active       BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_cl_def_phase ON checklist_definitions(phase, sort_order);


-- ============================================================
-- 9. CHECKLİST İLERLEME (Hareketlilik bazlı)
-- ============================================================
CREATE TABLE checklist_progress (
  id              UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  mobility_id     UUID    REFERENCES mobilities(id) ON DELETE CASCADE NOT NULL,
  definition_id   UUID    REFERENCES checklist_definitions(id) ON DELETE CASCADE NOT NULL,
  status          TEXT    DEFAULT 'pending' CHECK (status IN ('pending','done','na')),
  completed_by    UUID    REFERENCES users(id),
  completed_at    TIMESTAMPTZ,
  revoked_by      UUID    REFERENCES users(id),    -- geri alma
  revoked_at      TIMESTAMPTZ,
  note            TEXT,
  UNIQUE(mobility_id, definition_id)
);

CREATE INDEX idx_cl_progress_mobility ON checklist_progress(mobility_id);


-- ============================================================
-- 10. İMZA BLOKLARI (Belge bazlı, dinamik)
-- ============================================================
CREATE TABLE signature_slots (
  id            UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id   UUID    REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
  slot_type     TEXT    NOT NULL
                CHECK (slot_type IN (
                  'coordinator',       -- Kocaeli İl MEM Müdürü (her zaman)
                  'school_principal',  -- Okul Müdürü
                  'participant',       -- Bireysel katılımcı
                  'guardian',          -- Yasal vasi (18 yaş altı)
                  'accompanying'       -- Refakatçi öğretmen (grup, değişken)
                )),
  person_name   TEXT,
  person_title  TEXT,
  person_tc     TEXT,
  sort_order    INT     DEFAULT 1,
  is_signed     BOOLEAN DEFAULT FALSE,
  signed_at     TIMESTAMPTZ,
  notes         TEXT
);

CREATE INDEX idx_sig_slots_doc ON signature_slots(document_id);


-- ============================================================
-- 11. NOTLAR
-- ============================================================
CREATE TABLE notes (
  id          UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  mobility_id UUID    REFERENCES mobilities(id) ON DELETE CASCADE,
  school_id   UUID    REFERENCES schools(id)   ON DELETE CASCADE,
  author_id   UUID    REFERENCES users(id),
  content     TEXT    NOT NULL,
  is_internal BOOLEAN DEFAULT FALSE,  -- TRUE = sadece koordinatörler görür
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notes_mobility ON notes(mobility_id);
CREATE INDEX idx_notes_school   ON notes(school_id);


-- ============================================================
-- 12. BİLDİRİMLER
-- ============================================================
CREATE TABLE notifications (
  id          UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID    REFERENCES users(id) ON DELETE CASCADE,
  school_id   UUID    REFERENCES schools(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL,
  -- 'doc_approved' | 'doc_rejected' | 'checklist_blocked' | 'reminder' | 'note_added'
  title       TEXT    NOT NULL,
  body        TEXT,
  link_url    TEXT,
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notif_user  ON notifications(user_id, is_read);
CREATE INDEX idx_notif_school ON notifications(school_id);


-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE schools              ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobilities           ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE accompanying_teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_progress   ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_slots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications        ENABLE ROW LEVEL SECURITY;

-- Yardımcı fonksiyon: mevcut kullanıcının rolü
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM users WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Yardımcı fonksiyon: mevcut kullanıcının school_id'si
CREATE OR REPLACE FUNCTION current_user_school_id()
RETURNS UUID AS $$
  SELECT school_id FROM users WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ──────────────────────────────────────────────────────────
-- SCHOOLS: Koordinatörler hepsini görür, okullar sadece kendini
-- ──────────────────────────────────────────────────────────
CREATE POLICY "Koordinatörler tüm okulları görür"
  ON schools FOR SELECT
  USING (current_user_role() IN ('coordinator','admin'));

CREATE POLICY "Okul kendi kaydını görür"
  ON schools FOR SELECT
  USING (id = current_user_school_id());

CREATE POLICY "Koordinatörler okul ekler/günceller"
  ON schools FOR ALL
  USING (current_user_role() IN ('coordinator','admin'));

-- ──────────────────────────────────────────────────────────
-- USERS: Herkes kendini görür; koordinatörler hepsini görür
-- ──────────────────────────────────────────────────────────
CREATE POLICY "Kullanıcı kendini görür"
  ON users FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Koordinatörler tüm kullanıcıları görür"
  ON users FOR SELECT
  USING (current_user_role() IN ('coordinator','admin'));

CREATE POLICY "Koordinatörler kullanıcı yönetir"
  ON users FOR ALL
  USING (current_user_role() IN ('coordinator','admin'));

-- ──────────────────────────────────────────────────────────
-- MOBİLİTİES: Okul kendi hareketliliklerini görür
-- ──────────────────────────────────────────────────────────
CREATE POLICY "Okul kendi hareketliliklerini görür"
  ON mobilities FOR SELECT
  USING (school_id = current_user_school_id()
         OR current_user_role() IN ('coordinator','admin'));

CREATE POLICY "Koordinatörler hareketlilik yönetir"
  ON mobilities FOR ALL
  USING (current_user_role() IN ('coordinator','admin'));

CREATE POLICY "Okul hareketlilik güncelleyebilir (sınırlı)"
  ON mobilities FOR UPDATE
  USING (school_id = current_user_school_id()
         AND status NOT IN ('completed','cancelled'));

-- ──────────────────────────────────────────────────────────
-- PARTİCİPANTS: Okul kendi katılımcılarını yönetir
-- ──────────────────────────────────────────────────────────
CREATE POLICY "Okul kendi katılımcılarını yönetir"
  ON participants FOR ALL
  USING (school_id = current_user_school_id()
         OR current_user_role() IN ('coordinator','admin'));

-- ──────────────────────────────────────────────────────────
-- DOCUMENTS: Okul kendi belgelerini yönetir
-- ──────────────────────────────────────────────────────────
CREATE POLICY "Okul kendi belgelerini görür ve yükler"
  ON documents FOR SELECT
  USING (school_id = current_user_school_id()
         OR current_user_role() IN ('coordinator','admin'));

CREATE POLICY "Okul belge yükleyebilir"
  ON documents FOR INSERT
  WITH CHECK (school_id = current_user_school_id());

CREATE POLICY "Okul onaylanmamış belgeyi güncelleyebilir"
  ON documents FOR UPDATE
  USING (school_id = current_user_school_id()
         AND status NOT IN ('approved'));

CREATE POLICY "Koordinatör belge yönetir"
  ON documents FOR ALL
  USING (current_user_role() IN ('coordinator','admin'));

-- ──────────────────────────────────────────────────────────
-- CHECKLİST PROGRESS
-- ──────────────────────────────────────────────────────────
CREATE POLICY "Okul kendi checklist'ini görür ve günceller"
  ON checklist_progress FOR ALL
  USING (
    mobility_id IN (
      SELECT id FROM mobilities WHERE school_id = current_user_school_id()
    )
    OR current_user_role() IN ('coordinator','admin')
  );

-- ──────────────────────────────────────────────────────────
-- NOTİFİKASYONLAR
-- ──────────────────────────────────────────────────────────
CREATE POLICY "Kullanıcı kendi bildirimlerini görür"
  ON notifications FOR SELECT
  USING (user_id = auth.uid()
         OR (school_id = current_user_school_id() AND user_id IS NULL)
         OR current_user_role() IN ('coordinator','admin'));

CREATE POLICY "Kullanıcı kendi bildirimlerini günceller (okundu)"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid());


-- ============================================================
-- STOrage BUCKET (Supabase Dashboard'dan da yapılabilir)
-- ============================================================
-- Supabase Dashboard > Storage > New Bucket > "erasdesk-docs"
-- Public: FALSE (signed URLs kullanılacak)
-- Allowed MIME types: application/pdf, image/jpeg, image/png, image/jpg
-- Max file size: 10 MB


-- ============================================================
-- CHECKLİST TANIMLARI — BAŞLANGIÇ VERİSİ
-- ============================================================
INSERT INTO checklist_definitions (phase, sort_order, title, check_type, required_doc_type, required_form_type, activity_types, helper_url, helper_text) VALUES

-- HAREKETLİLİK ÖNCESİ
('oncesi',  1,  'Ortaklık Sözleşmesi imzalandı',                               'document', 'ortaklik_soz',           NULL,           NULL,                    NULL, NULL),
('oncesi',  2,  'Hareketlilik Uygulama Rehberi detaylı olarak incelendi',       'info',     NULL,                     NULL,           NULL,                    'https://www.ka121kocaeli.com/rehber', 'Rehberi okuyun ve "İnceledim" onayı verin.'),
('oncesi',  3,  'Fiziksel dosya oluşturuldu',                                   'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi',  4,  'Europass Hareketlilik Portalı üyeliği tamamlandı',             'info',     NULL,                     NULL,           NULL,                    'https://europass.eu.europa.eu/', NULL),
('oncesi',  5,  'Hareketlilik Yürütme Kurulu oluşturuldu',                      'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi',  6,  'Katılımcı Seçim Kurulu oluşturuldu',                           'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi',  7,  'Seçim yöntemi ve değerlendirme kriterleri belirlendi',         'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi',  8,  'TurnaPortal üzerinden başvurular alındı',                      'info',     NULL,                     NULL,           NULL,                    'https://turnaportal.meb.gov.tr/', NULL),
('oncesi',  9,  'KSK üyeleri Hareketlilik Bilgileri Tablosuna girildi',         'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi', 10,  'KSK üyeleri TurnaPortal''a eklendi',                           'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi', 11,  'TurnaPortal değerlendirme süreci tamamlandı',                  'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi', 12,  'Katılımcı Seçim Tutanağı hazırlandı ve imzalandı',            'document', 'katilimci_secim_tutanagi', NULL,          NULL,                    NULL, NULL),
('oncesi', 13,  'Asil/yedek liste ilan edildi',                                 'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi', 14,  'Görev yeri/öğrenci belgeleri yüklendi',                       'document', 'gorev_yeri_belgesi',      NULL,           NULL,                    NULL, NULL),
('oncesi', 15,  'Bireysel Yabancı Dil Gelişim Planı dolduruldu',               'form',     NULL,                     'lang_plan',    NULL,                    NULL, NULL),
('oncesi', 16,  'DUOLINGO hareketlilik kılavuzu incelendi',                     'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi', 17,  'Sonuçların Kullanımı Planı yapıldı ve Padlet''e eklendi',     'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi', 18,  'Öğrenme kazanımları incelendi',                               'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi', 19,  'Öğrenme kazanımları ev sahibiyle belirlendi',                 'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi', 20,  'Faaliyet Programı imzalı olarak alındı',                      'document', 'faaliyet_programi_imzali', NULL,          NULL,                    NULL, NULL),
('oncesi', 21,  'Hareketlilik Bilgileri tablosu eksiksiz dolduruldu',          'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi', 22,  'Kurs Proforma Faturası yüklendi',                             'document', 'kurs_proforma',           NULL,           ARRAY['SM-COUR-TRAIN'], NULL, 'Sadece yapılandırılmış kurs hareketlilikleri için.'),
('oncesi', 23,  'Hibe Sözleşmeleri hazırlandı',                               'info',     NULL,                     NULL,           NULL,                    NULL, 'ErasDesk üzerinden üretildi ve önizlendi.'),
('oncesi', 24,  'Öğrenme Sözleşmeleri hazırlandı',                            'info',     NULL,                     NULL,           NULL,                    NULL, 'ErasDesk üzerinden üretildi ve önizlendi.'),
('oncesi', 25,  'Hibe sözleşmeleri imzalandı, AR-GE''ye teslim edildi',       'document', 'hibe_soz_imzali',         NULL,           NULL,                    NULL, NULL),
('oncesi', 26,  'KVKK belgeleri imzalanıp yüklendi',                          'document', 'kvkk',                    NULL,           NULL,                    NULL, NULL),
('oncesi', 27,  'WhatsApp grubu kuruldu',                                      'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi', 28,  'Valilik Oluru EBYS''de hazırlandı',                          'info',     NULL,                     NULL,           NULL,                    NULL, 'EBYS üzerinden yazılır. "Hazırlandı" onayı verin.'),
('oncesi', 29,  'Onaylı Valilik Oluru alındı ve yüklendi',                    'document', 'valilik_oluru',            NULL,           NULL,                    NULL, NULL),
('oncesi', 30,  'Pasaport işlemleri tamamlandı',                               'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi', 31,  'Seyahat biletleri alındı',                                    'document', 'bilet',                   NULL,           NULL,                    NULL, NULL),
('oncesi', 32,  'Konaklama rezervasyonu yapıldı',                              'document', 'konaklama',               NULL,           NULL,                    NULL, NULL),
('oncesi', 33,  'Yurtdışı seyahat sağlık sigortası yapıldı',                  'document', 'sigorta',                 NULL,           NULL,                    NULL, NULL),
('oncesi', 34,  'Sertifika taslağı hazırlandı',                               'info',     NULL,                     NULL,           NULL,                    NULL, 'ErasDesk üzerinden üretildi.'),
('oncesi', 35,  'Europass akışı oluşturuldu, katılımcılar eklendi',           'info',     NULL,                     NULL,           NULL,                    'https://europass.eu.europa.eu/', NULL),
('oncesi', 36,  'Yabancı dil hazırlığı tamamlandı',                           'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi', 37,  'Mesleki hazırlık tamamlandı',                                'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi', 38,  'Kültürel hazırlık tamamlandı',                               'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi', 39,  'Yaygınlaştırma faaliyetleri yapıldı (öncesi)',               'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('oncesi', 40,  'Ön Test yapıldı',                                             'form',     NULL,                     'on_test',      NULL,                    NULL, NULL),

-- HAREKETLİLİK SIRASI
('sirasi',  1,  'Öğrenme Anlaşması ev sahibi kuruma imzalatıldı',             'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('sirasi',  2,  'Europass akışı bitirildi, çıktı alındı ve imzalatıldı',      'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('sirasi',  3,  'Katılım Sertifikası imzalatıldı',                            'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('sirasi',  4,  'Yaygınlaştırma faaliyetleri yapıldı (sırası)',               'info',     NULL,                     NULL,           NULL,                    NULL, NULL),

-- HAREKETLİLİK SONRASI
('sonrasi', 1,  'Katılımcı Anketi dolduruldu',                                'form',     NULL,                     'anket',        NULL,                    NULL, NULL),
('sonrasi', 2,  'Kurs Faturası yüklendi',                                     'document', 'kurs_fatura',             NULL,           ARRAY['SM-COUR-TRAIN'], NULL, NULL),
('sonrasi', 3,  'Son Test yapıldı',                                           'form',     NULL,                     'son_test',     NULL,                    NULL, NULL),
('sonrasi', 4,  'Yansıtma Yazıları dolduruldu',                               'form',     NULL,                     'yansitma',     NULL,                    NULL, NULL),
('sonrasi', 5,  'Resim/Video yüklendi',                                       'document', 'resim_video',             NULL,           NULL,                    NULL, 'En az 3 fotoğraf.'),
('sonrasi', 6,  'İmzalı Öğrenme Anlaşması yüklendi, AR-GE''ye teslim edildi', 'document', 'ogrenme_soz_imzali',     NULL,           NULL,                    NULL, NULL),
('sonrasi', 7,  'Sertifika yüklendi',                                         'document', 'sertifika',               NULL,           NULL,                    NULL, NULL),
('sonrasi', 8,  'İmzalı Europass Belgesi yüklendi',                           'document', 'europass_imzali',         NULL,           NULL,                    NULL, NULL),
('sonrasi', 9,  'Boarding Pass yüklendi',                                     'document', 'boarding_pass',           NULL,           NULL,                    NULL, NULL),
('sonrasi', 10, 'Odak Grup Görüşmeleri yapıldı',                              'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('sonrasi', 11, 'Yaygınlaştırma faaliyetleri yapıldı (sonrası)',              'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('sonrasi', 12, 'Sonuçların Kullanımı faaliyetleri yapıldı',                  'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('sonrasi', 13, 'Padlet güncellendi (kanıtlar yüklendi)',                     'info',     NULL,                     NULL,           NULL,                    NULL, NULL),
('sonrasi', 14, 'Beyan yüklendi',                                             'document', 'beyan',                   NULL,           NULL,                    NULL, 'Bu adımın tamamlanması %10 hibe ödemesini tetikler.');


-- ============================================================
-- YARDIMCI VİEW'LAR
-- ============================================================

-- Her hareketlilik için checklist tamamlanma yüzdesi
CREATE VIEW mobility_checklist_summary AS
SELECT
  m.id AS mobility_id,
  m.school_id,
  m.activity_type,
  COUNT(cd.id)                                           AS total_items,
  COUNT(cp.id) FILTER (WHERE cp.status = 'done')        AS done_items,
  ROUND(
    COUNT(cp.id) FILTER (WHERE cp.status = 'done') * 100.0
    / NULLIF(COUNT(cd.id), 0)
  )                                                      AS pct_done
FROM mobilities m
CROSS JOIN checklist_definitions cd
LEFT JOIN checklist_progress cp
  ON cp.mobility_id = m.id AND cp.definition_id = cd.id
WHERE cd.is_active = TRUE
  AND (cd.activity_types IS NULL OR m.activity_type = ANY(cd.activity_types))
GROUP BY m.id, m.school_id, m.activity_type;

-- Eksik belge özeti
CREATE VIEW missing_documents AS
SELECT
  m.id   AS mobility_id,
  m.school_id,
  s.name AS school_name,
  cd.required_doc_type,
  cd.title AS checklist_item
FROM mobilities m
JOIN schools s ON s.id = m.school_id
JOIN checklist_definitions cd ON cd.check_type = 'document'
  AND (cd.activity_types IS NULL OR m.activity_type = ANY(cd.activity_types))
LEFT JOIN documents d
  ON d.mobility_id = m.id
  AND d.doc_type = cd.required_doc_type
  AND d.status NOT IN ('pending','rejected','archived')
WHERE d.id IS NULL AND cd.is_active = TRUE;

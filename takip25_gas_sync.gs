// =============================================================================
// ERASMUS+ 2025 SCH TAKİP - GOOGLE APPS SCRIPT
// Versiyon: 1.0 | Tarih: Haziran 2026
//
// Ne yapar:
//   1. Drive'daki 68 spreadsheet'i okur (Google'ın quota'sı, Claude'unkini kullanmaz)
//   2. Her hareketlilik için EVET/HAYIR sayar, aşama hesaplar, tarih çeker
//   3. Tek bir JSON dosyası (takip25_sync.json) yazar
//   4. Claude bu dosyayı okur → HTML'e gömer (1 API çağrısı, ~5 sn)
//
// Kurulum: Aşağıdaki README_GAS_KURULUM.md dosyasına bak
// =============================================================================

// ── AYARLAR ──────────────────────────────────────────────────────────────────
var CONFIG = {
  // takip25_data.json'un Drive'daki dosya ID'si (kurulumda elde edilecek)
  // İlk kurulumda boş bırak — setupSourceFile() fonksiyonunu çalıştır
  sourceFileId: '1F-jVln4OAm4PXLAJV2Rrq5dZmb5UG963',

  // Çıktı JSON'unun yazılacağı klasör (Drive root = 2025 okulları klasörü)
  outputFolderId: '1zXHr5XbFKMvgjLLj68xMtXbJjbzpsla-',

  // Çıktı dosyasının adı
  outputFileName: 'takip25_sync.json',

  // Log dosyası adı (Drive root'a yazılır)
  logFileName: 'takip25_sync_log.json',
};

// =============================================================================
// ANA FONKSİYON — Tetikleyici bunu çağırır
// =============================================================================
function syncTakip25() {
  var startTime = new Date();
  Logger.log('=== Takip25 Sync Başladı: ' + startTime.toLocaleString('tr-TR') + ' ===');

  try {
    // 1. Kaynak JSON'u Drive'dan oku (okul/mob meta verisi)
    var schools = readSourceJson();
    if (!schools || !schools.length) {
      throw new Error('Kaynak JSON okunamadı veya boş');
    }
    Logger.log('Okul sayısı: ' + schools.length);

    // 2. Her okul ve mob için spreadsheet oku
    var updated = [];
    var processedMobs = 0;
    var errorMobs = 0;

    for (var i = 0; i < schools.length; i++) {
      var school = schools[i];
      var updatedMobs = [];

      Logger.log('[' + (i + 1) + '/' + schools.length + '] ' + school.name);

      var mobs = school.mobs || [];
      for (var j = 0; j < mobs.length; j++) {
        var mob = mobs[j];

        if (!mob.sheet_id) {
          updatedMobs.push(mob);
          continue;
        }

        try {
          var mobData = readSpreadsheet(mob.sheet_id, mob.tur);
          if (mobData) {
            var evet = mobData.oncesi.e + mobData.sirasi.e + mobData.sonrasi.e;
            var hayir = mobData.oncesi.h + mobData.sirasi.h + mobData.sonrasi.h;
            var total = evet + hayir;
            var pct = total > 0 ? Math.round(evet / total * 100) : 0;
            var durum = computeDurum(mobData.oncesi, mobData.sirasi, mobData.sonrasi);

            updatedMobs.push(Object.assign({}, mob, {
              evet: evet,
              hayir: hayir,
              total: total,
              pct: pct,
              sec: {
                oncesi: mobData.oncesi,
                sirasi: mobData.sirasi,
                sonrasi: mobData.sonrasi
              },
              durum: durum,
              firstHayir: mobData.firstHayir || mob.firstHayir || null,
              gidis_tarihi: mobData.gidis_tarihi,
              donus_tarihi: mobData.donus_tarihi,
              hibe_teslim: mobData.hibe_teslim,
              beyan_yuklendi: mobData.beyan_yuklendi || false,
              tasks: mobData.tasks || [],
              modifiedTime: new Date().toISOString()
            }));
            processedMobs++;
          } else {
            updatedMobs.push(mob);
            errorMobs++;
          }
        } catch (e) {
          Logger.log('HATA - ' + (mob.tur || '?') + ': ' + e.message);
          updatedMobs.push(mob);
          errorMobs++;
        }

        // Google'ın rate limit'ini aşmamak için kısa bekleme
        Utilities.sleep(200);
      }

      // Okul düzeyinde durum: en iyi mob durumu
      var schoolDurum = computeSchoolDurum(updatedMobs);
      updated.push(Object.assign({}, school, {mobs: updatedMobs, durum: schoolDurum}));
    }

    // 3. Çıktıyı Drive'a yaz
    var syncTime = new Date().toISOString();
    var output = {
      syncTime: syncTime,
      schools: updated,
      stats: {
        schoolCount: updated.length,
        mobCount: processedMobs + errorMobs,
        processedMobs: processedMobs,
        errorMobs: errorMobs,
        durationMs: new Date() - startTime
      }
    };

    writeJsonToDrive(CONFIG.outputFolderId, CONFIG.outputFileName, output);

    var duration = Math.round((new Date() - startTime) / 1000);
    Logger.log('=== Sync Tamamlandı: ' + duration + ' sn | ' + processedMobs + ' mob güncellendi ===');
    return output.stats;

  } catch (e) {
    Logger.log('KRİTİK HATA: ' + e.message + '\n' + e.stack);
    throw e;
  }
}

// =============================================================================
// SPREADSHEEt OKUMA
// =============================================================================
// Türkçe ay adlarından tarih parse eder
// Desteklenen formatlar:
//   DD/MM/YYYY-DD/MM/YYYY   →   04/05/2026-08/05/2026
//   DD.MM.YYYY-DD.MM.YYYY   →   04.05.2026-08.05.2026
//   DD-DD Ay YYYY           →   18-22 Mayıs 2026
//   DD Ay YYYY - DD Ay YYYY →   18 Mayıs 2026 - 22 Mayıs 2026
function parseTravelDateGAS(str) {
  var s = str.replace(/\s+/g, ' ').trim();
  // Format 1: DD/MM/YYYY-DD/MM/YYYY veya DD.MM.YYYY-DD.MM.YYYY
  var m = s.match(/(\d{1,2})[\/\.](\d{2})[\/\.](\d{4})\s*[-–]\s*(\d{1,2})[\/\.](\d{2})[\/\.](\d{4})/);
  if (m) {
    return {
      gidis: m[3]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[1]).slice(-2),
      donus: m[6]+'-'+('0'+m[5]).slice(-2)+'-'+('0'+m[4]).slice(-2)
    };
  }
  // Türkçe ay adları
  var TR_MONTHS = {
    'ocak':'01','subat':'02','şubat':'02','mart':'03','nisan':'04',
    'mayıs':'05','haziran':'06','temmuz':'07','ğagustos':'08','agustos':'08',
    'eylül':'09','ekim':'10','kasım':'11','aralik':'12','aralık':'12'
  };
  var sl = s.toLowerCase();
  // Format 2: DD-DD Ay YYYY
  var m2 = sl.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([a-zçğıöşü]+)\s+(\d{4})/);
  if (m2 && TR_MONTHS[m2[3]]) {
    var mon = TR_MONTHS[m2[3]];
    return {
      gidis: m2[4]+'-'+mon+'-'+('0'+m2[1]).slice(-2),
      donus: m2[4]+'-'+mon+'-'+('0'+m2[2]).slice(-2)
    };
  }
  // Format 3: DD Ay YYYY - DD Ay YYYY
  var m3 = sl.match(/(\d{1,2})\s+([a-zçğıöşü]+)\s+(\d{4})\s*[-–]\s*(\d{1,2})\s+([a-zçğıöşü]+)\s+(\d{4})/);
  if (m3 && TR_MONTHS[m3[2]] && TR_MONTHS[m3[5]]) {
    return {
      gidis: m3[3]+'-'+TR_MONTHS[m3[2]]+'-'+('0'+m3[1]).slice(-2),
      donus: m3[6]+'-'+TR_MONTHS[m3[5]]+'-'+('0'+m3[4]).slice(-2)
    };
  }
  return null;
}

// Tekil tarih parse: DD.MM.YYYY veya DD/MM/YYYY
function parseSingleDateGAS(str) {
  var m = str.trim().match(/(\d{1,2})[\/\.](\d{2})[\/\.](\d{4})/);
  if (m) return m[3]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[1]).slice(-2);
  return null;
}

function readSpreadsheet(sheetId, mobTur) {
  var ss = SpreadsheetApp.openById(sheetId);
  var sheets = ss.getSheets();

  // Kontrol Listesi sekmesini bul
  var targetSheet = null;
  for (var s = 0; s < sheets.length; s++) {
    var name = sheets[s].getName().toLowerCase();
    if (name.includes('kontrol') || s === 0) {
      targetSheet = sheets[s];
      if (name.includes('kontrol')) break;
    }
  }
  if (!targetSheet) return null;

  var data = targetSheet.getDataRange().getValues();

  var result = {
    oncesi: {e: 0, h: 0},
    sirasi: {e: 0, h: 0},
    sonrasi: {e: 0, h: 0},
    firstHayir: null,
    gidis_tarihi: null,
    donus_tarihi: null,
    hibe_teslim: false,
    beyan_yuklendi: false,
    tasks: []
  };

  var currentSection = null;
  var inBilgiTable = false; // Hareketlilik Bilgileri bölümüne girdi mi

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var col0 = String(row[0] || '').trim();
    var col1 = String(row[1] || '').trim();

    // ── Bölüm başlıklarını tanı ──────────────────────────────────────────
    if (col0.indexOf('Hareketlilik Öncesi') !== -1 || col0.indexOf('Hareketlilik Öncesi') !== -1) {
      currentSection = 'oncesi';
      inBilgiTable = false;
      continue;
    }
    if (col0.indexOf('Hareketlilik Sırası') !== -1 || col0.indexOf('Hareketlilik Sırası') !== -1) {
      currentSection = 'sirasi';
      inBilgiTable = false;
      continue;
    }
    if (col0.indexOf('Hareketlilik Sonrası') !== -1 || col0.indexOf('Hareketlilik Sonrası') !== -1) {
      currentSection = 'sonrasi';
      inBilgiTable = false;
      continue;
    }
    if (col0.indexOf('SEYAHAT DETAYLARI') !== -1 || col0.indexOf('SEYAHAT DETAYI') !== -1 ||
        col0.indexOf('EV SAHİBİ') !== -1 || col0.indexOf('AKREDİTASYON') !== -1) {
      inBilgiTable = true;
    }

    // ── EVET/HAYIR sayımı (kontrol listesi bölümleri) ────────────────────
    if (currentSection && !inBilgiTable && col0.length > 3) {
      // Kurs-özgü görevleri yalnızca kurs hareketlilikleri için say
      // Diğer türlerde bu satırı yok say (total/evet/hayir'a ekleme)
      var isKursTask = col0.indexOf('YAPILANDIRILMIŞ KURS') !== -1 ||
                       col0.indexOf('YAPILANDIRILMİŞ KURS') !== -1;
      var isKursMob = mobTur && (mobTur.toLowerCase().indexOf('kurs') !== -1 ||
                                  mobTur.toLowerCase().indexOf('yapılandır') !== -1 ||
                                  mobTur.toLowerCase().indexOf('yapılandır') !== -1);
      if (isKursTask && !isKursMob) {
        // Kurs görevi ama kurs hareketliliği değil — bu satırı atla
        continue;
      }

      var val = col1.toUpperCase();
      if (val === 'EVET') {
        result[currentSection].e++;
      } else if (val === 'HAYIR') {
        result[currentSection].h++;
        if (!result.firstHayir) {
          result.firstHayir = col0.substring(0, 120); // Max 120 karakter
        }
      }
      // Görevi tasks dizisine ekle (rowIndex + Danışman Açıklama notu dahil)
      result.tasks.push({
        row: i,
        section: currentSection,
        task: col0,
        durum: (val === 'EVET' || val === 'HAYIR') ? val : '',
        not: row.length > 3 ? String(row[3] || '').trim() : ''
      });
    }

    // ── Seyahat tarihleri (Kontrol Listesi sekmesinde varsa) ─────────────
    if (col0.toUpperCase().indexOf('SEYAHAT TAR') !== -1) {
      var parsed0 = parseTravelDateGAS(col1);
      if (parsed0) {
        result.gidis_tarihi = parsed0.gidis;
        result.donus_tarihi = parsed0.donus;
      }
    }

    // ── Hibe teslim ──────────────────────────────────────────────────────
    if (col0.indexOf('Hibe sözleşmeleri imzalandı') !== -1) {
      result.hibe_teslim = (col1.toUpperCase() === 'EVET');
    }

    // ── Tamamlandı beyanı yüklendi ───────────────────────────────────────
    if (col0.indexOf('beyanı yüklendi') !== -1 ||
        col0.indexOf('beyan') !== -1 && col0.indexOf('yüklendi') !== -1) {
      result.beyan_yuklendi = (col1.toUpperCase() === 'EVET');
    }
  }

  // ── Tarihleri diğer sekmelerde ara (Hareketlilik Bilgileri vb.) ──────────
  // Kontrol Listesi sekmesinde tarih bulunamadıysa tüm diğer sekmeleri tara
  if (!result.gidis_tarihi) {
    for (var s2 = 0; s2 < sheets.length; s2++) {
      if (sheets[s2] === targetSheet) continue; // Kontrol listesi zaten tarandı
      try {
        var otherData = sheets[s2].getDataRange().getValues();
        var foundDate = false;
        for (var i2 = 0; i2 < otherData.length; i2++) {
          var row2 = otherData[i2];

          // TÜM kolonları tara — SEYAHAT TAR içeren hücreyi bul
          for (var col2 = 0; col2 < row2.length; col2++) {
            var cv = String(row2[col2] || '').trim();
            if (cv.toUpperCase().indexOf('SEYAHAT TAR') === -1) continue;

            // Etiket hücresinin kendisinde tarih var mı? ("SEYAHAT TARİHLERİ: 02.05.2026-08.05.2026")
            var inlineMatch = cv.match(/(\d{1,2}[\/\.]\d{2}[\/\.]\d{4})\s*[-–]\s*(\d{1,2}[\/\.]\d{2}[\/\.]\d{4})/);
            if (inlineMatch) {
              var parsedInline = parseTravelDateGAS(inlineMatch[0]);
              if (parsedInline) {
                result.gidis_tarihi = parsedInline.gidis;
                result.donus_tarihi = parsedInline.donus;
                Logger.log('Tarih inline bulundu (col' + col2 + '): ' + inlineMatch[0]);
                foundDate = true;
                break;
              }
            }

            // Sonraki kolonda tarih var mı?
            if (col2 + 1 < row2.length) {
              var nextVal = String(row2[col2 + 1] || '').trim();
              var parsedNext = parseTravelDateGAS(nextVal);
              if (parsedNext) {
                result.gidis_tarihi = parsedNext.gidis;
                result.donus_tarihi = parsedNext.donus;
                Logger.log('Tarih sonraki kolonda bulundu (col' + (col2+1) + '): ' + nextVal);
                foundDate = true;
                break;
              }
            }
          }
          if (foundDate) break;

          // Katılımcı tablosundaki bireysel Gidiş/Dönüş tarihleri (col2 & col3)
          if (!foundDate && row2.length > 3) {
            var c2 = String(row2[2] || '').trim();
            var c3 = String(row2[3] || '').trim();
            if (c2.indexOf('Gidi') !== -1 || c3.indexOf('Dön') !== -1) continue;
            var d2 = parseSingleDateGAS(c2);
            var d3 = parseSingleDateGAS(c3);
            if (d2 && d3) {
              if (!result.gidis_tarihi || d2 < result.gidis_tarihi) result.gidis_tarihi = d2;
              if (!result.donus_tarihi || d3 > result.donus_tarihi) result.donus_tarihi = d3;
            }
          }
        }
        if (result.gidis_tarihi) break;
      } catch(e2) {
        Logger.log('Sekme okuma hatası [' + sheets[s2].getName() + ']: ' + e2.message);
      }
    }
  }

  return result;
}

// =============================================================================
// AŞAMA (DURUM) HESAPLAMA
// =============================================================================
function computeDurum(oncesi, sirasi, sonrasi) {
  var evetTotal = oncesi.e + sirasi.e + sonrasi.e;
  var hayirTotal = oncesi.h + sirasi.h + sonrasi.h;
  var total = evetTotal + hayirTotal;

  if (total === 0) return 'baslamamis';
  if (total > 0 && evetTotal === total) return 'tamam';
  if (sonrasi.e > 0) return 'sonrasi';
  if (sirasi.e > 0) return 'surasi';
  if (oncesi.e >= 11) return 'oncesi';
  if (oncesi.e > 0) return 'secim';
  return 'baslamamis';
}

function computeSchoolDurum(mobs) {
  var stageOrder = ['tamam', 'sonrasi', 'surasi', 'oncesi', 'secim', 'baslamamis', 'bilinmiyor'];
  var best = 'bilinmiyor';
  for (var i = 0; i < mobs.length; i++) {
    var d = mobs[i].durum || 'bilinmiyor';
    if (stageOrder.indexOf(d) < stageOrder.indexOf(best)) {
      best = d;
    }
  }
  return best;
}

// =============================================================================
// DRIVE OKUMA / YAZMA
// =============================================================================
function readSourceJson() {
  if (!CONFIG.sourceFileId) {
    throw new Error('sourceFileId boş. Önce setupSourceFile() çalıştır.');
  }
  var file = DriveApp.getFileById(CONFIG.sourceFileId);
  var content = file.getBlob().getDataAsString('UTF-8');
  return JSON.parse(content);
}

function writeJsonToDrive(folderId, fileName, data) {
  var folder = DriveApp.getFolderById(folderId);
  var jsonStr = JSON.stringify(data, null, 2);
  var files = folder.getFilesByName(fileName);

  if (files.hasNext()) {
    var existing = files.next();
    existing.setContent(jsonStr);
    Logger.log(fileName + ' güncellendi.');
  } else {
    folder.createFile(fileName, jsonStr, MimeType.PLAIN_TEXT);
    Logger.log(fileName + ' oluşturuldu.');
  }
}

// =============================================================================
// KURULUM FONKSİYONLARI (Sadece ilk kurulumda çalıştır)
// =============================================================================

// Adım 1: takip25_data.json'u Drive'a yükle ve dosya ID'sini al
// Önce takip25_data.json'u bilgisayardan Drive'a manuel olarak yükle
// Sonra bu fonksiyonu çalıştır — dosya ID'sini logger'da gösterir
function findSourceFileId() {
  var folder = DriveApp.getFolderById(CONFIG.outputFolderId);
  var files = folder.getFilesByName('takip25_data.json');
  if (files.hasNext()) {
    var f = files.next();
    Logger.log('takip25_data.json bulundu. ID: ' + f.getId());
    Logger.log('Bunu CONFIG.sourceFileId ye yapıştır.');
    return f.getId();
  } else {
    Logger.log('takip25_data.json bulunamadı. Önce Drive\'a yükle.');
    return null;
  }
}

// Adım 2: Tetikleyicileri kur (mevcut tetikleyicileri siler, yenilerini ekler)
function setupTriggers() {
  // Mevcut tetikleyicileri temizle
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }

  // Her gün 07:00-08:00 arası
  ScriptApp.newTrigger('syncTakip25')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .create();

  // Her gün 17:00-18:00 arası
  ScriptApp.newTrigger('syncTakip25')
    .timeBased()
    .everyDays(1)
    .atHour(17)
    .create();

  // Her gün 22:00-23:00 arası
  ScriptApp.newTrigger('syncTakip25')
    .timeBased()
    .everyDays(1)
    .atHour(22)
    .create();

  Logger.log('3 tetikleyici kuruldu: 07:00, 17:00, 22:00 (günlük)');
}

// Adım 3: Kurulumu test et (tek bir okul ile)
function testSingleSchool() {
  // takip25_data.json'dan ilk mob'u test et
  var schools = readSourceJson();
  var testMob = null;
  var testSchool = null;

  for (var i = 0; i < schools.length; i++) {
    var mobs = schools[i].mobs || [];
    for (var j = 0; j < mobs.length; j++) {
      if (mobs[j].sheet_id) {
        testMob = mobs[j];
        testSchool = schools[i];
        break;
      }
    }
    if (testMob) break;
  }

  if (!testMob) {
    Logger.log('Test için mob bulunamadı.');
    return;
  }

  Logger.log('Test: ' + testSchool.name + ' / ' + (testMob.tur || '?'));
  var data = readSpreadsheet(testMob.sheet_id, testMob.tur);
  Logger.log('Sonuç: ' + JSON.stringify(data));
}

// Tarih okuma testi — DERİNCE-MELİKŞAH okulu üzerinde test et
function testTarihOkuma() {
  var sheetId = '1DJCpZRtCPuhnT3L7QV8ufpnQFUukcCIzpDXYJWBjClg'; // DERİNCE-MELİKŞAH İşbaşı
  var ss = SpreadsheetApp.openById(sheetId);
  var sheets = ss.getSheets();
  Logger.log('Toplam sekme sayısı: ' + sheets.length);
  for (var s = 0; s < sheets.length; s++) {
    Logger.log('  Sekme ' + s + ': ' + sheets[s].getName());
  }
  // Tüm sekmeleri tara, TÜM kolonlarda SEYAHAT TARİHLERİ ara
  for (var s2 = 0; s2 < sheets.length; s2++) {
    var rows = sheets[s2].getDataRange().getValues();
    Logger.log('Sekme [' + sheets[s2].getName() + '] — ' + rows.length + ' satır, ' + (rows[0]||[]).length + ' kolon');
    for (var i = 0; i < rows.length; i++) {
      for (var col = 0; col < rows[i].length; col++) {
        var cv = String(rows[i][col] || '').trim();
        if (cv.toUpperCase().indexOf('SEYAHAT TAR') !== -1) {
          var nextVal = col + 1 < rows[i].length ? String(rows[i][col+1]||'').trim() : '';
          Logger.log('  ✅ SATIR ' + i + ' KOL ' + col + ': [' + cv + '] → sonraki=[' + nextVal + ']');
        }
      }
    }
  }
  Logger.log('Tam readSpreadsheet sonucu: ' + JSON.stringify(readSpreadsheet(sheetId, 'İşbaşı Öğrenme')));
}

// =============================================================================
// WEB APP ENDPOINTİ — Deploy ettikten sonra HTML buradan veri çeker
// ?action=sync  → arka planda syncTakip25 tetikler (~2 dk sürer)
// (parametre yok) → takip25_sync.json içeriğini döndürür
// =============================================================================
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;

  var output;
  if (action === 'sync') {
    // Eski syncTakip25 trigger'larını temizle (birikim önleme)
    var allTriggers = ScriptApp.getProjectTriggers();
    for (var ti = 0; ti < allTriggers.length; ti++) {
      if (allTriggers[ti].getHandlerFunction() === 'syncTakip25') {
        ScriptApp.deleteTrigger(allTriggers[ti]);
      }
    }
    ScriptApp.newTrigger('syncTakip25').timeBased().after(5000).create();
    output = ContentService.createTextOutput(
      JSON.stringify({status: 'sync_started', message: 'Sync tetiklendi. ~2 dakika sonra veri güncellenir.'})
    );

  } else if (action === 'saveNote') {
    // Kontrol listesine danışman notu yaz
    // Params: sheetId, row (0-based), note
    try {
      var sheetId = e.parameter.sheetId;
      var rowIdx = parseInt(e.parameter.row || '0');
      var note = e.parameter.note || '';
      var ss = SpreadsheetApp.openById(sheetId);
      var sheets = ss.getSheets();
      var targetSheet = null;
      for (var s = 0; s < sheets.length; s++) {
        var sName = sheets[s].getName().toLowerCase();
        if (sName.indexOf('kontrol') !== -1 || s === 0) {
          targetSheet = sheets[s];
          if (sName.indexOf('kontrol') !== -1) break;
        }
      }
      if (!targetSheet) throw new Error('Kontrol listesi sekmesi bulunamadı');
      // GAS 1-tabanlı; col D = 4
      targetSheet.getRange(rowIdx + 1, 4).setValue(note);
      output = ContentService.createTextOutput(JSON.stringify({status: 'ok', row: rowIdx, note: note}));
    } catch(err) {
      output = ContentService.createTextOutput(JSON.stringify({error: err.message}));
    }

  } else if (action === 'saveMobNote') {
    // Genel hareketlilik notu kaydet (Drive JSON dosyasına)
    // Params: mobId, okul, note
    try {
      var mobId = e.parameter.mobId || '';
      var okul = e.parameter.okul || '';
      var noteText = e.parameter.note || '';
      var tarih = Utilities.formatDate(new Date(), 'Europe/Istanbul', 'dd.MM.yyyy HH:mm');
      var folder = DriveApp.getFolderById(CONFIG.outputFolderId);
      var notesFileName = 'mob_notlari.json';
      var notesData = [];
      var nFiles = folder.getFilesByName(notesFileName);
      if (nFiles.hasNext()) {
        notesData = JSON.parse(nFiles.next().getBlob().getDataAsString('UTF-8'));
      }
      notesData.push({id: mobId, okul: okul, tarih: tarih, not: noteText});
      // Mevcut dosyayı sil ve yeniden yaz
      var nFiles2 = folder.getFilesByName(notesFileName);
      if (nFiles2.hasNext()) nFiles2.next().setTrashed(true);
      folder.createFile(notesFileName, JSON.stringify(notesData), MimeType.PLAIN_TEXT);
      output = ContentService.createTextOutput(JSON.stringify({status: 'ok', tarih: tarih}));
    } catch(err) {
      output = ContentService.createTextOutput(JSON.stringify({error: err.message}));
    }

  } else if (action === 'deleteMobNote') {
    // Genel hareketlilik notunu sil
    // Params: mobId, index (not dizisindeki sıra)
    try {
      var delMobId = e.parameter.mobId || '';
      var delIdx = parseInt(e.parameter.index || '-1');
      var folder = DriveApp.getFolderById(CONFIG.outputFolderId);
      var nFiles3 = folder.getFilesByName('mob_notlari.json');
      var nd = [];
      if (nFiles3.hasNext()) nd = JSON.parse(nFiles3.next().getBlob().getDataAsString('UTF-8'));
      // Sadece bu mob'un notlarını filtrele ve index'i çıkar
      var thisNotes = nd.filter(function(n){ return n.id === delMobId; });
      var otherNotes = nd.filter(function(n){ return n.id !== delMobId; });
      thisNotes.splice(delIdx, 1);
      nd = otherNotes.concat(thisNotes);
      var nFiles4 = folder.getFilesByName('mob_notlari.json');
      if (nFiles4.hasNext()) nFiles4.next().setTrashed(true);
      folder.createFile('mob_notlari.json', JSON.stringify(nd), MimeType.PLAIN_TEXT);
      output = ContentService.createTextOutput(JSON.stringify({status: 'ok'}));
    } catch(err) {
      output = ContentService.createTextOutput(JSON.stringify({error: err.message}));
    }

  } else if (action === 'saveApproval') {
    // Onay kutusu durumunu kaydet
    // Params: mobId, approved (1/0)
    try {
      var apMobId = e.parameter.mobId || '';
      var appr = e.parameter.approved === '1';
      var folder = DriveApp.getFolderById(CONFIG.outputFolderId);
      var apFiles = folder.getFilesByName('approvals.json');
      var approvals = [];
      if (apFiles.hasNext()) approvals = JSON.parse(apFiles.next().getBlob().getDataAsString('UTF-8'));
      if (appr) {
        if (approvals.indexOf(apMobId) === -1) approvals.push(apMobId);
      } else {
        approvals = approvals.filter(function(id){ return id !== apMobId; });
      }
      var apFiles2 = folder.getFilesByName('approvals.json');
      if (apFiles2.hasNext()) apFiles2.next().setTrashed(true);
      folder.createFile('approvals.json', JSON.stringify(approvals), MimeType.PLAIN_TEXT);
      output = ContentService.createTextOutput(JSON.stringify({status: 'ok'}));
    } catch(err) {
      output = ContentService.createTextOutput(JSON.stringify({error: err.message}));
    }

  } else if (action === 'getApprovals') {
    // Onaylı mob ID listesini döndür
    try {
      var folder = DriveApp.getFolderById(CONFIG.outputFolderId);
      var apf = folder.getFilesByName('approvals.json');
      output = apf.hasNext()
        ? ContentService.createTextOutput(apf.next().getBlob().getDataAsString('UTF-8'))
        : ContentService.createTextOutput('[]');
    } catch(err) {
      output = ContentService.createTextOutput(JSON.stringify({error: err.message}));
    }

  } else if (action === 'getMobNotes') {
    // Tüm genel mob notlarını getir
    try {
      var folder = DriveApp.getFolderById(CONFIG.outputFolderId);
      var nf = folder.getFilesByName('mob_notlari.json');
      output = nf.hasNext()
        ? ContentService.createTextOutput(nf.next().getBlob().getDataAsString('UTF-8'))
        : ContentService.createTextOutput('[]');
    } catch(err) {
      output = ContentService.createTextOutput(JSON.stringify({error: err.message}));
    }

  } else {
    // takip25_sync.json içeriğini döndür
    try {
      var folder = DriveApp.getFolderById(CONFIG.outputFolderId);
      var files = folder.getFilesByName(CONFIG.outputFileName);
      if (files.hasNext()) {
        output = ContentService.createTextOutput(files.next().getBlob().getDataAsString('UTF-8'));
      } else {
        output = ContentService.createTextOutput(JSON.stringify({error: 'JSON bulunamadı'}));
      }
    } catch(err) {
      output = ContentService.createTextOutput(JSON.stringify({error: err.message}));
    }
  }
  return output.setMimeType(ContentService.MimeType.JSON);
}

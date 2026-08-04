// =============================================================================
// ERASMUS+ 2025 SCH TAKİP - GOOGLE APPS SCRIPT
// Versiyon: 1.2 | Tarih: Temmuz 2026
// =============================================================================

// ── AYARLAR ──────────────────────────────────────────────────────────────────
var CONFIG = {
  sourceFileId: '1F-jVln4OAm4PXLAJV2Rrq5dZmb5UG963',
  outputFolderId: '1zXHr5XbFKMvgjLLj68xMtXbJjbzpsla-',
  outputFileName: 'takip25_sync.json',
  logFileName: 'takip25_sync_log.json',
};

// =============================================================================
// ANA FONKSİYON
// =============================================================================
function syncTakip25() {
  var startTime = new Date();
  Logger.log('=== Takip25 Sync Başladı: ' + startTime.toLocaleString('tr-TR') + ' ===');

  try {
    var schools = readSourceJson();
    if (!schools || !schools.length) {
      throw new Error('Kaynak JSON okunamadı veya boş');
    }
    Logger.log('Okul sayısı: ' + schools.length);

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

        Utilities.sleep(200);
      }

      var schoolDurum = computeSchoolDurum(updatedMobs);
      updated.push(Object.assign({}, school, {mobs: updatedMobs, durum: schoolDurum}));
    }

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

// Manuel "Şimdi Güncelle" tetikleyicisi için wrapper — günlük trigger'lardan ayrı tutulur
function syncTakip25Manual() {
  syncTakip25();
}

// =============================================================================
// SPREADSHEET OKUMA
// =============================================================================
function parseTravelDateGAS(str) {
  var s = str.replace(/\s+/g, ' ').trim();
  var m = s.match(/(\d{1,2})[\/\.](\d{2})[\/\.](\d{4})\s*[-–]\s*(\d{1,2})[\/\.](\d{2})[\/\.](\d{4})/);
  if (m) {
    return {
      gidis: m[3]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[1]).slice(-2),
      donus: m[6]+'-'+('0'+m[5]).slice(-2)+'-'+('0'+m[4]).slice(-2)
    };
  }
  var TR_MONTHS = {
    'ocak':'01','subat':'02','şubat':'02','mart':'03','nisan':'04',
    'mayıs':'05','haziran':'06','temmuz':'07','agustos':'08','ağustos':'08',
    'eylül':'09','ekim':'10','kasım':'11','aralik':'12','aralık':'12'
  };
  var sl = s.toLowerCase();
  var m2 = sl.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([a-zçğıöşü]+)\s+(\d{4})/);
  if (m2 && TR_MONTHS[m2[3]]) {
    var mon = TR_MONTHS[m2[3]];
    return {
      gidis: m2[4]+'-'+mon+'-'+('0'+m2[1]).slice(-2),
      donus: m2[4]+'-'+mon+'-'+('0'+m2[2]).slice(-2)
    };
  }
  var m3 = sl.match(/(\d{1,2})\s+([a-zçğıöşü]+)\s+(\d{4})\s*[-–]\s*(\d{1,2})\s+([a-zçğıöşü]+)\s+(\d{4})/);
  if (m3 && TR_MONTHS[m3[2]] && TR_MONTHS[m3[5]]) {
    return {
      gidis: m3[3]+'-'+TR_MONTHS[m3[2]]+'-'+('0'+m3[1]).slice(-2),
      donus: m3[6]+'-'+TR_MONTHS[m3[5]]+'-'+('0'+m3[4]).slice(-2)
    };
  }
  return null;
}

function parseSingleDateGAS(str) {
  var m = str.trim().match(/(\d{1,2})[\/\.](\d{2})[\/\.](\d{4})/);
  if (m) return m[3]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[1]).slice(-2);
  return null;
}

function readSpreadsheet(sheetId, mobTur) {
  var ss = SpreadsheetApp.openById(sheetId);
  var sheets = ss.getSheets();

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
  var inBilgiTable = false;

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var col0 = String(row[0] || '').trim();
    var col1 = String(row[1] || '').trim();

    if (col0.indexOf('Hareketlilik Öncesi') !== -1) {
      currentSection = 'oncesi'; inBilgiTable = false; continue;
    }
    if (col0.indexOf('Hareketlilik Sırası') !== -1) {
      currentSection = 'sirasi'; inBilgiTable = false; continue;
    }
    if (col0.indexOf('Hareketlilik Sonrası') !== -1) {
      currentSection = 'sonrasi'; inBilgiTable = false; continue;
    }
    if (col0.indexOf('SEYAHAT DETAYLARI') !== -1 || col0.indexOf('SEYAHAT DETAYI') !== -1 ||
        col0.indexOf('EV SAHİBİ') !== -1 || col0.indexOf('AKREDİTASYON') !== -1) {
      inBilgiTable = true;
    }

    if (currentSection && !inBilgiTable && col0.length > 3) {
      var isKursTask = col0.indexOf('YAPILANDIRILMIŞ KURS') !== -1 ||
                       col0.indexOf('YAPILANDIRILMİŞ KURS') !== -1;
      var isKursMob = mobTur && (mobTur.toLowerCase().indexOf('kurs') !== -1 ||
                                  mobTur.toLowerCase().indexOf('yapılandır') !== -1);
      if (isKursTask && !isKursMob) continue;

      var val = col1.toUpperCase();
      if (val === 'EVET') {
        result[currentSection].e++;
      } else if (val === 'HAYIR') {
        result[currentSection].h++;
        if (!result.firstHayir) result.firstHayir = col0.substring(0, 120);
      }
      result.tasks.push({
        row: i,
        section: currentSection,
        task: col0,
        durum: (val === 'EVET' || val === 'HAYIR') ? val : '',
        not: row.length > 3 ? String(row[3] || '').trim() : ''
      });
    }

    if (col0.toUpperCase().indexOf('SEYAHAT TAR') !== -1) {
      var parsed0 = parseTravelDateGAS(col1);
      if (parsed0) {
        result.gidis_tarihi = parsed0.gidis;
        result.donus_tarihi = parsed0.donus;
      }
    }

    if (col0.indexOf('Hibe sözleşmeleri imzalandı') !== -1) {
      result.hibe_teslim = (col1.toUpperCase() === 'EVET');
    }

    if (col0.indexOf('beyanı yüklendi') !== -1 ||
        (col0.indexOf('beyan') !== -1 && col0.indexOf('yüklendi') !== -1)) {
      result.beyan_yuklendi = (col1.toUpperCase() === 'EVET');
    }
  }

  if (!result.gidis_tarihi) {
    for (var s2 = 0; s2 < sheets.length; s2++) {
      if (sheets[s2] === targetSheet) continue;
      try {
        var otherData = sheets[s2].getDataRange().getValues();
        var foundDate = false;
        for (var i2 = 0; i2 < otherData.length; i2++) {
          var row2 = otherData[i2];
          for (var col2 = 0; col2 < row2.length; col2++) {
            var cv = String(row2[col2] || '').trim();
            if (cv.toUpperCase().indexOf('SEYAHAT TAR') === -1) continue;
            var inlineMatch = cv.match(/(\d{1,2}[\/\.]\d{2}[\/\.]\d{4})\s*[-–]\s*(\d{1,2}[\/\.]\d{2}[\/\.]\d{4})/);
            if (inlineMatch) {
              var parsedInline = parseTravelDateGAS(inlineMatch[0]);
              if (parsedInline) {
                result.gidis_tarihi = parsedInline.gidis;
                result.donus_tarihi = parsedInline.donus;
                foundDate = true; break;
              }
            }
            if (col2 + 1 < row2.length) {
              var nextVal = String(row2[col2 + 1] || '').trim();
              var parsedNext = parseTravelDateGAS(nextVal);
              if (parsedNext) {
                result.gidis_tarihi = parsedNext.gidis;
                result.donus_tarihi = parsedNext.donus;
                foundDate = true; break;
              }
            }
          }
          if (foundDate) break;
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
// AŞAMA HESAPLAMA
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
    if (stageOrder.indexOf(d) < stageOrder.indexOf(best)) best = d;
  }
  return best;
}

// =============================================================================
// DRIVE OKUMA / YAZMA
// =============================================================================
function readSourceJson() {
  if (!CONFIG.sourceFileId) throw new Error('sourceFileId boş.');
  var file = DriveApp.getFileById(CONFIG.sourceFileId);
  var content = file.getBlob().getDataAsString('UTF-8');
  return JSON.parse(content);
}

function writeJsonToDrive(folderId, fileName, data) {
  var folder = DriveApp.getFolderById(folderId);
  var jsonStr = JSON.stringify(data, null, 2);
  var files = folder.getFilesByName(fileName);
  if (files.hasNext()) {
    files.next().setContent(jsonStr);
  } else {
    folder.createFile(fileName, jsonStr, MimeType.PLAIN_TEXT);
  }
}

// =============================================================================
// KURULUM FONKSİYONLARI
// =============================================================================
function setupTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  // Sync: her 6 saatte bir (02, 08, 14, 20)
  ScriptApp.newTrigger('syncTakip25').timeBased().everyDays(1).atHour(2).create();
  ScriptApp.newTrigger('syncTakip25').timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger('syncTakip25').timeBased().everyDays(1).atHour(14).create();
  ScriptApp.newTrigger('syncTakip25').timeBased().everyDays(1).atHour(20).create();
  // Belge dosya kontrolü: gece 01:00'de
  ScriptApp.newTrigger('checkDocFiles').timeBased().everyDays(1).atHour(1).create();
  // Her 15 dakikada bir değişiklik kontrolü + GitHub push
  ScriptApp.newTrigger('autoPushToGitHub').timeBased().everyMinutes(15).create();
  Logger.log('Tetikleyiciler kuruldu: 02, 08, 14, 20 (sync) + 01:00 (checkDocFiles) + her 15 dakikada (github push)');
}

function autoPushToGitHub() {
  var HTML_FILE_ID = '1d7AWMFaHyEundSnGrb5cYnJB82i_5RMy';
  var props = PropertiesService.getScriptProperties();
  var lastPushTime = parseInt(props.getProperty('lastPushTime') || '0');

  // Drive dosyasının son değişiklik zamanını kontrol et
  var htmlFile = DriveApp.getFileById(HTML_FILE_ID);
  var fileModTime = htmlFile.getLastUpdated().getTime();

  // Değişiklik yoksa push etme
  if (fileModTime <= lastPushTime) {
    Logger.log('Değişiklik yok, atlandı. Son değişiklik: ' + new Date(fileModTime).toLocaleString('tr-TR'));
    return;
  }

  var GH_TOKEN  = PropertiesService.getScriptProperties().getProperty('GH_TOKEN');
  if (!GH_TOKEN) throw new Error('GH_TOKEN Script Properties\'de tanımlı değil. Project Settings > Script Properties\'e ekleyin.');
  var GH_REPO   = 'firatarslan-gif/erasmus-takip';
  var GH_FILE   = 'index.html';
  var GH_BRANCH = 'main';

  var htmlBytes = htmlFile.getBlob().getBytes();
  var encoded   = Utilities.base64Encode(htmlBytes);

  var headers = {
    'Authorization': 'token ' + GH_TOKEN,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  };

  var r1 = UrlFetchApp.fetch(
    'https://api.github.com/repos/' + GH_REPO + '/contents/' + GH_FILE + '?ref=' + GH_BRANCH,
    { headers: headers, muteHttpExceptions: true }
  );
  var sha = '';
  if (r1.getResponseCode() === 200) {
    sha = JSON.parse(r1.getContentText()).sha;
  }

  var payload = { message: 'Otomatik güncelleme', content: encoded, branch: GH_BRANCH };
  if (sha) payload.sha = sha;

  var r2 = UrlFetchApp.fetch(
    'https://api.github.com/repos/' + GH_REPO + '/contents/' + GH_FILE,
    { method: 'put', headers: headers, payload: JSON.stringify(payload), muteHttpExceptions: true }
  );

  var code = r2.getResponseCode();
  if (code === 200 || code === 201) {
    props.setProperty('lastPushTime', Date.now().toString());
    Logger.log('GitHub push başarılı: ' + new Date().toLocaleString('tr-TR'));
  } else {
    Logger.log('GitHub push hatası: ' + code + ' — ' + r2.getContentText().substring(0, 200));
  }
}

function testSingleSchool() {
  var schools = readSourceJson();
  var testMob = null, testSchool = null;
  for (var i = 0; i < schools.length; i++) {
    var mobs = schools[i].mobs || [];
    for (var j = 0; j < mobs.length; j++) {
      if (mobs[j].sheet_id) { testMob = mobs[j]; testSchool = schools[i]; break; }
    }
    if (testMob) break;
  }
  if (!testMob) { Logger.log('Test için mob bulunamadı.'); return; }
  Logger.log('Test: ' + testSchool.name + ' / ' + (testMob.tur || '?'));
  var data = readSpreadsheet(testMob.sheet_id, testMob.tur);
  Logger.log('Sonuç: ' + JSON.stringify(data));
}

// =============================================================================
// WEB APP ENDPOINTİ
// =============================================================================
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  var output;

  if (action === 'sync') {
    // Eski bekleyen MANUEL sync tetikleyicilerini temizle (birikmesini önle)
    var allTr = ScriptApp.getProjectTriggers();
    for (var ti = 0; ti < allTr.length; ti++) {
      if (allTr[ti].getHandlerFunction() === 'syncTakip25Manual') {
        ScriptApp.deleteTrigger(allTr[ti]);
      }
    }
    ScriptApp.newTrigger('syncTakip25Manual').timeBased().after(3000).create();
    output = ContentService.createTextOutput(
      JSON.stringify({status: 'sync_started', message: 'Sync tetiklendi. ~2 dakika sonra veri güncellenir.'})
    );

  } else if (action === 'saveNote') {
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
      targetSheet.getRange(rowIdx + 1, 4).setValue(note);
      output = ContentService.createTextOutput(JSON.stringify({status: 'ok', row: rowIdx, note: note}));
    } catch(err) {
      output = ContentService.createTextOutput(JSON.stringify({error: err.message}));
    }

  } else if (action === 'saveMobNote') {
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
      var nFiles2 = folder.getFilesByName(notesFileName);
      if (nFiles2.hasNext()) nFiles2.next().setTrashed(true);
      folder.createFile(notesFileName, JSON.stringify(notesData), MimeType.PLAIN_TEXT);
      output = ContentService.createTextOutput(JSON.stringify({status: 'ok', tarih: tarih}));
    } catch(err) {
      output = ContentService.createTextOutput(JSON.stringify({error: err.message}));
    }

  } else if (action === 'editMobNote') {
    try {
      var edMobId = e.parameter.mobId || '';
      var edIdx = parseInt(e.parameter.index || '-1');
      var edNote = e.parameter.note || '';
      var folder = DriveApp.getFolderById(CONFIG.outputFolderId);
      var nFiles = folder.getFilesByName('mob_notlari.json');
      var nd = [];
      if (nFiles.hasNext()) nd = JSON.parse(nFiles.next().getBlob().getDataAsString('UTF-8'));
      var thisNotes = nd.filter(function(n){ return n.id === edMobId; });
      var otherNotes = nd.filter(function(n){ return n.id !== edMobId; });
      if (edIdx >= 0 && edIdx < thisNotes.length) thisNotes[edIdx].not = edNote;
      nd = otherNotes.concat(thisNotes);
      var nFiles2 = folder.getFilesByName('mob_notlari.json');
      if (nFiles2.hasNext()) nFiles2.next().setTrashed(true);
      folder.createFile('mob_notlari.json', JSON.stringify(nd), MimeType.PLAIN_TEXT);
      output = ContentService.createTextOutput(JSON.stringify({status: 'ok'}));
    } catch(err) {
      output = ContentService.createTextOutput(JSON.stringify({error: err.message}));
    }

  } else if (action === 'deleteMobNote') {
    try {
      var delMobId = e.parameter.mobId || '';
      var delIdx = parseInt(e.parameter.index || '-1');
      var folder = DriveApp.getFolderById(CONFIG.outputFolderId);
      var nFiles3 = folder.getFilesByName('mob_notlari.json');
      var nd = [];
      if (nFiles3.hasNext()) nd = JSON.parse(nFiles3.next().getBlob().getDataAsString('UTF-8'));
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

  } else if (action === 'getAdminTasks') {
    try {
      var folder = DriveApp.getFolderById(CONFIG.outputFolderId);
      var f = folder.getFilesByName('admin_tasks.json');
      output = f.hasNext()
        ? ContentService.createTextOutput(f.next().getBlob().getDataAsString('UTF-8'))
        : ContentService.createTextOutput('{}');
    } catch(err) {
      output = ContentService.createTextOutput(JSON.stringify({error: err.message}));
    }

  } else if (action === 'saveAdminTask') {
    try {
      var mobId = e.parameter.mobId || '';
      var key   = e.parameter.key   || '';
      var val   = e.parameter.val   === '1';
      if (!mobId || !key) throw new Error('mobId ve key gerekli');
      var folder = DriveApp.getFolderById(CONFIG.outputFolderId);
      var f = folder.getFilesByName('admin_tasks.json');
      var data = {};
      if (f.hasNext()) data = JSON.parse(f.next().getBlob().getDataAsString('UTF-8'));
      if (!data[mobId]) data[mobId] = {};
      data[mobId][key] = val;
      var f2 = folder.getFilesByName('admin_tasks.json');
      if (f2.hasNext()) f2.next().setTrashed(true);
      folder.createFile('admin_tasks.json', JSON.stringify(data), MimeType.PLAIN_TEXT);
      output = ContentService.createTextOutput(JSON.stringify({status: 'ok'}));
    } catch(err) {
      output = ContentService.createTextOutput(JSON.stringify({error: err.message}));
    }

  } else if (action === 'getDocLinks') {
    try {
      var folder = DriveApp.getFolderById(CONFIG.outputFolderId);
      var f = folder.getFilesByName('mob_docs.json');
      output = f.hasNext()
        ? ContentService.createTextOutput(f.next().getBlob().getDataAsString('UTF-8'))
        : ContentService.createTextOutput('{}');
    } catch(err) {
      output = ContentService.createTextOutput(JSON.stringify({error: err.message}));
    }

  } else if (action === 'saveDocLink') {
    try {
      var mobId = e.parameter.mobId || '';
      var key   = e.parameter.key   || '';
      var link  = e.parameter.link  || '';
      if (!mobId || !key) throw new Error('mobId ve key gerekli');
      var folder = DriveApp.getFolderById(CONFIG.outputFolderId);
      var f = folder.getFilesByName('mob_docs.json');
      var data = {};
      if (f.hasNext()) data = JSON.parse(f.next().getBlob().getDataAsString('UTF-8'));
      if (!data[mobId]) data[mobId] = {};
      if (link) data[mobId][key] = link;
      else delete data[mobId][key];
      var f2 = folder.getFilesByName('mob_docs.json');
      if (f2.hasNext()) f2.next().setTrashed(true);
      folder.createFile('mob_docs.json', JSON.stringify(data), MimeType.PLAIN_TEXT);
      output = ContentService.createTextOutput(JSON.stringify({status: 'ok'}));
    } catch(err) {
      output = ContentService.createTextOutput(JSON.stringify({error: err.message}));
    }

  } else if (action === 'saveApproval') {
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
    try {
      var folder = DriveApp.getFolderById(CONFIG.outputFolderId);
      var nf = folder.getFilesByName('mob_notlari.json');
      output = nf.hasNext()
        ? ContentService.createTextOutput(nf.next().getBlob().getDataAsString('UTF-8'))
        : ContentService.createTextOutput('[]');
    } catch(err) {
      output = ContentService.createTextOutput(JSON.stringify({error: err.message}));
    }

  } else if (action === 'getTasksForSheet') {
    // Bir spreadsheet'in görev listesini canlı olarak döndür
    try {
      var sid = e.parameter.sheetId || '';
      var tur = e.parameter.tur || '';
      if(!sid) throw new Error('sheetId gerekli');
      var data = readSpreadsheet(sid, tur);
      output = ContentService.createTextOutput(JSON.stringify({
        status: 'ok',
        tasks: data ? data.tasks : []
      }));
    } catch(err) {
      output = ContentService.createTextOutput(JSON.stringify({error: err.message, tasks: []}));
    }

  } else if (action === 'pushToGitHub') {
    // Drive'daki HTML'yi GitHub Pages'a push et
    try {
      var GH_TOKEN = PropertiesService.getScriptProperties().getProperty('GH_TOKEN');
      if (!GH_TOKEN) throw new Error('GH_TOKEN Script Properties\'de tanımlı değil. Project Settings > Script Properties\'e ekleyin.');
      var GH_REPO  = 'firatarslan-gif/erasmus-takip';
      var GH_FILE  = 'index.html';
      var GH_BRANCH = 'main';
      var HTML_FILE_ID = '1d7AWMFaHyEundSnGrb5cYnJB82i_5RMy';

      var htmlBytes = DriveApp.getFileById(HTML_FILE_ID).getBlob().getBytes();
      var encoded = Utilities.base64Encode(htmlBytes);

      var headers = {
        'Authorization': 'token ' + GH_TOKEN,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      };

      var r1 = UrlFetchApp.fetch(
        'https://api.github.com/repos/' + GH_REPO + '/contents/' + GH_FILE + '?ref=' + GH_BRANCH,
        { headers: headers, muteHttpExceptions: true }
      );
      var sha = '';
      if (r1.getResponseCode() === 200) {
        sha = JSON.parse(r1.getContentText()).sha;
      }

      var payload = { message: 'Otomatik güncelleme', content: encoded, branch: GH_BRANCH };
      if (sha) payload.sha = sha;

      var r2 = UrlFetchApp.fetch(
        'https://api.github.com/repos/' + GH_REPO + '/contents/' + GH_FILE,
        { method: 'put', headers: headers, payload: JSON.stringify(payload), muteHttpExceptions: true }
      );
      var code = r2.getResponseCode();
      output = ContentService.createTextOutput(
        JSON.stringify({ status: code === 200 || code === 201 ? 'ok' : 'error', code: code })
      );
    } catch(err) {
      output = ContentService.createTextOutput(JSON.stringify({ error: err.message }));
    }

  } else {
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

// =============================================================================
// BELGELİNK OTOMATIK DOLDURMA (eski format — mob_folder_id olan okullar)
// Apps Script editöründe bu fonksiyonu çalıştır → mob_docs.json oluşur
// =============================================================================
function populateDocLinks() {
  Logger.log('=== populateDocLinks başladı ===');

  var outputFolder = DriveApp.getFolderById(CONFIG.outputFolderId);
  var syncFiles = outputFolder.getFilesByName(CONFIG.outputFileName);
  if (!syncFiles.hasNext()) throw new Error('takip25_sync.json bulunamadı');
  var syncData = JSON.parse(syncFiles.next().getBlob().getDataAsString('UTF-8'));
  var schools = syncData.schools || [];

  var existing = {};
  var exFiles = outputFolder.getFilesByName('mob_docs.json');
  if (exFiles.hasNext()) {
    try { existing = JSON.parse(exFiles.next().getBlob().getDataAsString('UTF-8')); } catch(e) {}
  }

  var totalLinks = 0;
  var totalMobs  = 0;

  schools.forEach(function(school) {
    (school.mobs || []).forEach(function(mob) {
      var mobId = mob.sheet_id || mob.mob_folder_id;
      if (!mobId) return;
      var fol = mob.folders || {};
      var links = existing[mobId] || {};

      if (fol.oncesi) {
        try {
          var oncesiF = DriveApp.getFolderById(fol.oncesi);
          if (!links['faaliyet']) {
            var f5id = _subfolderId(oncesiF, '5. Taslak Program');
            if (f5id) {
              var f5sId = _subfolderIdById(f5id, '2. İmzalı Dokümanlar_PDF');
              if (f5sId) links['faaliyet'] = 'https://drive.google.com/drive/folders/' + f5sId;
            }
          }
          if (!links['hibe_soz']) {
            var f3id = _subfolderId(oncesiF, '3. Hibe Sözleşmeleri');
            if (f3id) {
              var f3sId = _subfolderIdById(f3id, '2. İmzalı Dokümanlar_PDF');
              if (f3sId) links['hibe_soz'] = 'https://drive.google.com/drive/folders/' + f3sId;
            }
          }
          if (!links['ogrenme']) {
            var f7id = _subfolderId(oncesiF, '7. Öğrenme Sözleşmeleri');
            if (f7id) {
              var f7sId = _subfolderIdById(f7id, '2. İmzalı Dokümanlar_PDF');
              if (f7sId) links['ogrenme'] = 'https://drive.google.com/drive/folders/' + f7sId;
            }
          }
          if (!links['ulasim']) {
            var f11id = _subfolderId(oncesiF, '11. Ulaşım ve Seyahat Dokümanları');
            if (f11id) links['ulasim'] = 'https://drive.google.com/drive/folders/' + f11id;
          }
          if (!links['konaklama']) {
            var f10id = _subfolderId(oncesiF, '10. Konaklama Dokümanları');
            if (f10id) links['konaklama'] = 'https://drive.google.com/drive/folders/' + f10id;
          }
        } catch(e) {
          Logger.log('Öncesi hata [' + mobId + ']: ' + e.message);
        }
      }

      if (fol.sonrasi) {
        try {
          var sonrasiF = DriveApp.getFolderById(fol.sonrasi);
          if (!links['boarding']) {
            var fbId = _subfolderId(sonrasiF, '3. Boarding Pass');
            if (fbId) links['boarding'] = 'https://drive.google.com/drive/folders/' + fbId;
          }
          if (!links['europass']) {
            var feId = _subfolderId(sonrasiF, '2. Europass Hareketlilik Belgesi_İmzalı');
            if (feId) links['europass'] = 'https://drive.google.com/drive/folders/' + feId;
          }
          if (!links['anket']) {
            var faId = _subfolderId(sonrasiF, '5. Erasmus Katılımcı Anket Formları');
            if (faId) links['anket'] = 'https://drive.google.com/drive/folders/' + faId;
          }
        } catch(e) {
          Logger.log('Sonrası hata [' + mobId + ']: ' + e.message);
        }
      }

      if (Object.keys(links).length > 0) {
        existing[mobId] = links;
        totalLinks += Object.keys(links).length;
        totalMobs++;
      }

      Utilities.sleep(150);
    });
  });

  writeJsonToDrive(CONFIG.outputFolderId, 'mob_docs.json', existing);

  var msg = 'Tamamlandı: ' + totalMobs + ' hareketlilik, ' + totalLinks + ' link dolduruldu.';
  Logger.log('=== ' + msg + ' ===');
  return msg;
}

// Yardımcı: Klasör nesnesi içinde isimle alt klasör ID'si bul
function _subfolderId(parentFolder, name) {
  var it = parentFolder.getFoldersByName(name);
  return it.hasNext() ? it.next().getId() : null;
}

// Yardımcı: ID'ye göre parent klasör içinde isimle alt klasör ID'si bul
function _subfolderIdById(parentId, name) {
  try {
    var parent = DriveApp.getFolderById(parentId);
    var it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next().getId() : null;
  } catch(e) { return null; }
}

// =============================================================================
// YENİ FORMAT OKUL BELGELİNK KEŞİF (sheet_id olan, mob_folder_id olmayan okullar)
// Apps Script editöründe discoverMissingDocFolders() çalıştır
// =============================================================================
function discoverMissingDocFolders() {
  var outFolder = DriveApp.getFolderById('1zXHr5XbFKMvgjLLj68xMtXbJjbzpsla-');

  // Sync verisi
  var syncFiles = outFolder.getFilesByName('takip25_sync.json');
  if (!syncFiles.hasNext()) throw new Error('takip25_sync.json bulunamadı');
  var syncData = JSON.parse(syncFiles.next().getBlob().getDataAsString('UTF-8'));
  var schools = syncData.schools || [];

  // Mevcut mob_docs.json
  var existing = {};
  var exFiles = outFolder.getFilesByName('mob_docs.json');
  if (exFiles.hasNext()) {
    try { existing = JSON.parse(exFiles.next().getBlob().getDataAsString('UTF-8')); } catch(e2) {}
  }

  var DOC_KEYS = ['faaliyet','hibe_soz','ogrenme','ulasim','konaklama','boarding','europass','anket'];

  var missingMobs = [];
  schools.forEach(function(school) {
    if (!school.drive_id) return; // Sürücü ID'si olmayan okulları atla
    (school.mobs || []).forEach(function(mob) {
      var mobId = mob.sheet_id;
      if (!mobId) return; // Eski format mob
      var links = existing[mobId] || {};
      var hasAll = DOC_KEYS.every(function(k) { return !!links[k]; });
      if (!hasAll) missingMobs.push({school: school, mob: mob, mobId: mobId, links: links});
    });
  });

  Logger.log('Eksik link bulunan mob sayısı: ' + missingMobs.length);

  var totalLinks = 0;
  var totalMobs  = 0;

  missingMobs.forEach(function(item) {
    var school = item.school;
    var mob    = item.mob;
    var mobId  = item.mobId;
    var links  = item.links;

    try {
      var schoolF = DriveApp.getFolderById(school.drive_id);

      // 1. "4. Hareketlilikler" klasörünü bul
      var harF = null;
      var it = schoolF.getFolders();
      while (it.hasNext()) {
        var f = it.next();
        if (f.getName().toLowerCase().indexOf('hareketlilikler') !== -1) { harF = f; break; }
      }
      if (!harF) {
        Logger.log('Hareketlilikler klasörü bulunamadı: ' + school.name);
        return;
      }

      // 2. Tip alt klasörlerini al
      var typefolders = [];
      var hit = harF.getFolders();
      while (hit.hasNext()) {
        var hf = hit.next();
        typefolders.push({name: hf.getName(), obj: hf});
      }

      // 3. Mob tipini normalize et (boşluksuz, küçük harf, Türkçe karakter koru)
      var mobType = (mob.tur || '').toLowerCase().replace(/\s+/g, '');

      // Sync verisi sıkıştırılmış tip kodları kullanıyor → normalize et
      var TYPE_NORM = {
        'öğretmegörev': 'öğretme',
        'kısasüreli':   'kısa',
        'uzunsüreli':   'uzun',
        'gruphar':      'grup',
        'öğrencigrubu': 'grup',
        'öğrencigrup':  'grup',
        'öğrencigruplarınınhareketliliği': 'grup'
      };
      var matchKey = TYPE_NORM[mobType] || mobType;

      // 4. Eşleşen tip klasörünü bul
      var mobTypeF = null;
      typefolders.forEach(function(tf) {
        if (mobTypeF) return;
        var fn = tf.name.toLowerCase().replace(/\s+/g, '');
        if (fn.indexOf(matchKey) !== -1 || matchKey.indexOf(fn.slice(0, 6)) !== -1) {
          mobTypeF = tf.obj;
        }
      });

      if (!mobTypeF) {
        Logger.log('Eşleşen klasör bulunamadı: ' + school.name + ' / ' + mob.tur + ' (key: ' + matchKey + ')');
        return;
      }

      // 5. Öncesi / Sonrası alt klasörlerini bul
      var oncesiF = null; var sonrasiF = null;
      var subIt = mobTypeF.getFolders();
      while (subIt.hasNext()) {
        var sf = subIt.next();
        var sfn = sf.getName().toLowerCase();
        if (sfn.indexOf('ncesi') !== -1) oncesiF = sf;
        else if (sfn.indexOf('sonras') !== -1) sonrasiF = sf;
      }

      var newLinks = 0;

      // Öncesi belgeler — spesifik alt klasör bulunamazsa üst klasörü (oncesiF) fallback kullan
      if (oncesiF) {
        var oncesiUrl = 'https://drive.google.com/drive/folders/' + oncesiF.getId();
        if (!links['faaliyet']) {
          var fId = _findSubfolderByKeyword(oncesiF, ['taslak program', 'faaliyet program', 'faaliyet', 'program']);
          links['faaliyet'] = fId ? 'https://drive.google.com/drive/folders/' + fId : oncesiUrl;
          newLinks++;
        }
        if (!links['hibe_soz']) {
          var hId = _findSubfolderByKeyword(oncesiF, ['hibe sözleşme', 'hibe sozlesme', 'hibe s', 'hibe']);
          links['hibe_soz'] = hId ? 'https://drive.google.com/drive/folders/' + hId : oncesiUrl;
          newLinks++;
        }
        if (!links['ogrenme']) {
          var oId = _findSubfolderByKeyword(oncesiF, ['öğrenme anlaşma', 'öğrenme sozlesme', 'öğrenme', 'ogrenme', 'öğrenim', 'learning agreement']);
          links['ogrenme'] = oId ? 'https://drive.google.com/drive/folders/' + oId : oncesiUrl;
          newLinks++;
        }
        if (!links['ulasim']) {
          var uId = _findSubfolderByKeyword(oncesiF, ['ulaşım', 'ulasim', 'seyahat', 'bilet', 'transport']);
          links['ulasim'] = uId ? 'https://drive.google.com/drive/folders/' + uId : oncesiUrl;
          newLinks++;
        }
        if (!links['konaklama']) {
          var kId = _findSubfolderByKeyword(oncesiF, ['konaklama', 'accommodation', 'otel']);
          links['konaklama'] = kId ? 'https://drive.google.com/drive/folders/' + kId : oncesiUrl;
          newLinks++;
        }
      }

      // Sonrası belgeler — spesifik alt klasör bulunamazsa üst klasörü (sonrasiF) fallback kullan
      if (sonrasiF) {
        var sonrasiUrl = 'https://drive.google.com/drive/folders/' + sonrasiF.getId();
        if (!links['boarding']) {
          var bId = _findSubfolderByKeyword(sonrasiF, ['boarding', 'biniş', 'binis', 'pas']);
          links['boarding'] = bId ? 'https://drive.google.com/drive/folders/' + bId : sonrasiUrl;
          newLinks++;
        }
        if (!links['europass']) {
          var eId = _findSubfolderByKeyword(sonrasiF, ['europass', 'euro pass']);
          links['europass'] = eId ? 'https://drive.google.com/drive/folders/' + eId : sonrasiUrl;
          newLinks++;
        }
        if (!links['anket']) {
          var aId = _findSubfolderByKeyword(sonrasiF, ['anket', 'katılımcı', 'survey', 'questionnaire']);
          links['anket'] = aId ? 'https://drive.google.com/drive/folders/' + aId : sonrasiUrl;
          newLinks++;
        }
      }

      if (newLinks > 0) {
        existing[mobId] = links;
        totalLinks += newLinks;
        totalMobs++;
        Logger.log('✓ ' + school.name + ' / ' + mob.tur + ': ' + newLinks + ' link');
      }

    } catch(err) {
      Logger.log('HATA [' + school.name + ']: ' + err.message);
    }

    Utilities.sleep(100);
  });

  // mob_docs.json kaydet
  var ef2 = outFolder.getFilesByName('mob_docs.json');
  if (ef2.hasNext()) ef2.next().setTrashed(true);
  outFolder.createFile('mob_docs.json', JSON.stringify(existing), MimeType.PLAIN_TEXT);

  var msg = 'Tamamlandı: ' + totalMobs + ' hareketlilik, ' + totalLinks + ' yeni link bulundu.';
  Logger.log('=== ' + msg + ' ===');
  return msg;
}

// =============================================================================
// TANI: Gerçek klasör isimlerini logla — gri kutu sorununu analiz etmek için
// GAS editöründe diagDocFolders() çalıştır, Execution Log'a bak
// =============================================================================
function diagDocFolders() {
  var outFolder = DriveApp.getFolderById('1zXHr5XbFKMvgjLLj68xMtXbJjbzpsla-');
  var syncFiles = outFolder.getFilesByName('takip25_sync.json');
  var syncData = JSON.parse(syncFiles.next().getBlob().getDataAsString('UTF-8'));
  var schools = syncData.schools || [];

  // drive_id olan ve en az 1 sheet_id'li mob'u olan ilk 3 okulu incele
  var count = 0;
  for (var i = 0; i < schools.length && count < 3; i++) {
    var school = schools[i];
    if (!school.drive_id) continue;
    var hasMob = (school.mobs || []).some(function(m) { return m.sheet_id; });
    if (!hasMob) continue;
    count++;

    Logger.log('\n========== ' + school.name + ' ==========');
    try {
      var schoolF = DriveApp.getFolderById(school.drive_id);
      var it1 = schoolF.getFolders();
      while (it1.hasNext()) {
        var f1 = it1.next();
        Logger.log('[L1] ' + f1.getName());
        if (f1.getName().toLowerCase().indexOf('hareketlilikler') !== -1) {
          var it2 = f1.getFolders();
          while (it2.hasNext()) {
            var f2 = it2.next();
            Logger.log('  [L2-TİP] ' + f2.getName());
            var it3 = f2.getFolders();
            while (it3.hasNext()) {
              var f3 = it3.next();
              Logger.log('    [L3-DÖNEM] ' + f3.getName());
              var it4 = f3.getFolders();
              while (it4.hasNext()) {
                Logger.log('      [L4-BELGE] ' + it4.next().getName());
              }
            }
          }
        }
      }
    } catch(e) {
      Logger.log('HATA: ' + e.message);
    }
  }
  Logger.log('\nTanılama tamamlandı.');
}

// Yardımcı: anahtar kelimelerle alt klasör ID'si bul (büyük/küçük harf ve Türkçe toleranslı)
function _findSubfolderByKeyword(parentFolder, keywords) {
  var it = parentFolder.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    var fn = f.getName().toLowerCase();
    for (var ki = 0; ki < keywords.length; ki++) {
      if (fn.indexOf(keywords[ki].toLowerCase()) !== -1) return f.getId();
    }
  }
  return null;
}

// =============================================================================
// BELGE DOSYA VARLIĞI KONTROLÜ
// Apps Script editöründe checkDocFiles() çalıştır
// Klasörde gerçekten dosya var mı kontrol eder → mob_docs.json'a _file alanı ekler
// =============================================================================
function checkDocFiles() {
  var outFolder = DriveApp.getFolderById('1zXHr5XbFKMvgjLLj68xMtXbJjbzpsla-');

  // mob_docs.json oku
  var docFiles = outFolder.getFilesByName('mob_docs.json');
  if (!docFiles.hasNext()) { Logger.log('mob_docs.json bulunamadı'); return; }
  var existing = JSON.parse(docFiles.next().getBlob().getDataAsString('UTF-8'));

  var DOC_KEYS = ['faaliyet','hibe_soz','ogrenme','ulasim','konaklama','boarding','europass','anket'];

  // Klasörde doğrudan dosya var mı, yoksa 1 alt seviyede var mı kontrol et
  function folderHasFiles(folder) {
    if (folder.getFiles().hasNext()) return true;
    var subIt = folder.getFolders();
    while (subIt.hasNext()) {
      if (subIt.next().getFiles().hasNext()) return true;
    }
    return false;
  }

  var checked = 0;
  var withFiles = 0;

  Object.keys(existing).forEach(function(mobId) {
    var mobLinks = existing[mobId];
    DOC_KEYS.forEach(function(key) {
      var url = mobLinks[key] || '';
      if (!url || url === '1' || url === 'ok') return;

      // Drive klasör URL'sinden ID çıkar
      var idMatch = url.match(/[-\w]{25,}/);
      if (!idMatch) return;
      var folderId = idMatch[0];

      checked++;
      try {
        var folder = DriveApp.getFolderById(folderId);
        var hasFile = folderHasFiles(folder);
        mobLinks[key + '_file'] = hasFile;
        if (hasFile) withFiles++;
      } catch(e) {
        mobLinks[key + '_file'] = false;
        Logger.log('Klasör erişim hatası [' + mobId + '/' + key + ']: ' + e.message);
      }

      Utilities.sleep(50);
    });
    existing[mobId] = mobLinks;
  });

  // Güncellenmiş mob_docs.json kaydet
  var ef2 = outFolder.getFilesByName('mob_docs.json');
  if (ef2.hasNext()) ef2.next().setTrashed(true);
  outFolder.createFile('mob_docs.json', JSON.stringify(existing), MimeType.PLAIN_TEXT);

  var msg = 'Tamamlandı: ' + checked + ' klasör kontrol edildi, ' + withFiles + ' tanesinde dosya var.';
  Logger.log('=== ' + msg + ' ===');
  return msg;
}

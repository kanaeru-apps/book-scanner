// ── 定数 ─────────────────────────────────────────────
var SHEET_NAME  = "読書記録";
var ROOT_FOLDER = "書籍画像";
// 列構成（C列に「表紙画像」を追加した新レイアウト）
var HEADERS     = ["ジャンル", "タイトル", "表紙画像", "著者名", "評価", "要約", "読書メモ", "登録日", "📁画像フォルダ"];
// 旧レイアウト（表紙画像なし）— マイグレーション判定用
var OLD_HEADERS = ["ジャンル", "タイトル", "著者名", "評価", "要約", "読書メモ", "登録日", "📁画像フォルダ"];
// セル内表紙画像の表示サイズ（標準）
var COVER_COL_WIDTH  = 90;   // C列の幅(px)
var COVER_ROW_HEIGHT = 120;  // 画像を表示する行の高さ(px)

// ── ルーティング ──────────────────────────────────────
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'ping') return buildResponse({ success: true, ok: true, version: "5.0" });
  if (e && e.parameter && e.parameter.action === 'getBooks') return getBookList();
  return buildResponse({ status: "running", version: "5.0" });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error("リクエストボディが空です");
    const data = JSON.parse(e.postData.contents);
    const action = data.action || 'register';
    Logger.log("doPost 実行: action=" + action);
    if (data.action === 'uploadImage') return uploadImageToDrive(data);
    return writeToSheet(data);
  } catch (err) {
    Logger.log("doPost error: " + err.message);
    return buildResponse({ success: false, error: err.message });
  }
}

function doOptions(e) {
  return buildResponse({});
}

// ── keep-alive：スクリプトを「休眠」させないため定期実行する関数 ─
// 長期非アクセスでGAS Webアプリが403を返す事象の根本対策。
// setupKeepAliveTrigger() で毎日自動実行されるトリガーを設定する。
function keepAlive() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const folder = DriveApp.getRootFolder();
    Logger.log("keepAlive OK: " + ss.getName() + " / " + folder.getName() + " @ " + new Date().toISOString());
  } catch (err) {
    Logger.log("keepAlive error: " + err.message);
  }
}

// ── keep-alive トリガーのセットアップ（1回だけ実行すればOK）─
// GASエディタからこの関数を1回実行すると、毎日午前3時にkeepAliveが自動実行される。
function setupKeepAliveTrigger() {
  const existing = ScriptApp.getProjectTriggers();
  let removed = 0;
  existing.forEach(function(t) {
    if (t.getHandlerFunction() === 'keepAlive') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  Logger.log("既存のkeepAliveトリガーを削除: " + removed + "件");

  ScriptApp.newTrigger('keepAlive')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();
  Logger.log("✓ keepAlive トリガーをセットアップ完了（毎日午前3時に自動実行）");
}

// ── 認証テスト（初回実行時に PC で実行してください）─────
function testAuth() {
  try {
    Logger.log("=== 認証テスト開始 ===");
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    Logger.log("✓ スプレッドシート接続: " + ss.getName());
    const folder = DriveApp.getRootFolder();
    Logger.log("✓ Google Drive 接続: " + folder.getName());
    Logger.log("=== 認証完了！この後は iPhone からも使用できます ===");
    return ContentService.createTextOutput("認証完了");
  } catch (err) {
    Logger.log("認証エラー: " + err.message);
    return ContentService.createTextOutput("エラー: " + err.message);
  }
}

// ── 書評登録 ──────────────────────────────────────────
function writeToSheet(data) {
  if (!data.title || String(data.title).trim() === "") {
    return buildResponse({ success: false, error: "タイトルは必須です" });
  }

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss);

  const title      = String(data.title  || "").trim();
  const author     = String(data.author || "").trim();
  const rawName    = author ? title + "（" + author + "）" : title;
  const folderName = sanitizeFolderName(rawName);
  const folderUrl  = createBookFolder(folderName);

  // フォルダ作成失敗チェック（修正：握りつぶされていたエラーをここで検知）
  if (!folderUrl || folderUrl.trim() === "") {
    return buildResponse({ success: false, error: "フォルダ作成に失敗しました。タイトル名に使用可能な文字が含まれているか確認してください" });
  }

  const today  = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd");
  const rating = Number(data.rating);

  const row = [
    String(data.genre   || "").trim(),
    title,
    "",                                  // C列:表紙画像（この後 CellImage をセット）
    author,
    isNaN(rating) ? "" : rating,
    String(data.summary || "").trim(),
    String(data.memo    || "").trim(),
    String(data.date    || today).trim(),
    folderUrl
  ];

  sheet.appendRow(row);

  const lastRow = sheet.getLastRow();
  if (folderUrl) {
    const richText = SpreadsheetApp.newRichTextValue()
      .setText("📁 開く")
      .setLinkUrl(folderUrl)
      .build();
    sheet.getRange(lastRow, 9).setRichTextValue(richText);  // 📁画像フォルダはI列(9)に移動
  }

  // 表紙画像をC列のセル内に埋め込む（失敗しても登録自体は成功させる）
  if (data.coverImageBase64) {
    try {
      embedCoverImage(sheet, lastRow, folderUrl, data.coverImageBase64, data.coverImageMime, title);
    } catch (e) {
      Logger.log("表紙画像の埋め込みに失敗（登録は継続）: " + e.message);
    }
  }

  Logger.log("登録完了: " + title + " / フォルダ: " + folderUrl);
  return buildResponse({ success: true, folderUrl: folderUrl });
}

// ── 表紙画像をセル内に埋め込む ────────────────────────
// 1) 本のフォルダに表紙画像を保存
// 2) 「リンクを知る全員が閲覧可」に共有（セル内表示にはアクセス可能URLが必須）
// 3) CellImage を生成して C列にセットし、行の高さ・列幅を調整
function embedCoverImage(sheet, row, folderUrl, base64, mime, title) {
  // フォルダIDを抽出（uploadImageToDrive と同じ複数形式対応）
  let match = folderUrl.match(/folders\/([a-zA-Z0-9_\-]+)/);
  if (!match) match = folderUrl.match(/id=([a-zA-Z0-9_\-]+)/);
  if (!match) throw new Error("フォルダIDを抽出できません: " + folderUrl);
  const folder = DriveApp.getFolderById(match[1]);

  let decodedBytes;
  try {
    decodedBytes = Utilities.base64Decode(base64);
  } catch (e) {
    throw new Error("表紙画像のBase64デコード失敗: " + e.message);
  }

  const blob = Utilities.newBlob(decodedBytes, mime || 'image/jpeg', '_cover_' + Date.now() + '.jpg');
  const file = folder.createFile(blob);

  // セル内表示にはURLアクセスが必要なため、表紙画像のみリンク閲覧可にする
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // サムネイルURL方式でセル内画像を生成
  const url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w400';
  const cellImage = SpreadsheetApp.newCellImage()
    .setSourceUrl(url)
    .setAltTextTitle(title || '表紙')
    .build();

  sheet.getRange(row, 3).setValue(cellImage);
  sheet.setColumnWidth(3, COVER_COL_WIDTH);
  sheet.setRowHeight(row, COVER_ROW_HEIGHT);

  Logger.log("表紙画像を埋め込み: row=" + row + " / " + file.getName());
}

// ── 本一覧を返す ──────────────────────────────────────
function getBookList() {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return buildResponse({ success: true, books: [] });
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return buildResponse({ success: true, books: [] });

    const rows      = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
    const richTexts = sheet.getRange(2, 9, lastRow - 1, 1).getRichTextValues();

    const books = rows
      .filter(r => r[1])
      .map((r, i) => {
        const rt        = richTexts[i][0];
        const folderUrl = rt ? (rt.getLinkUrl() || '') : '';
        // 列構成: A0ジャンル B1タイトル C2表紙画像 D3著者名 E4評価 ... I8フォルダ
        return { genre: r[0], title: r[1], author: r[3], rating: r[4], folderUrl };
      });

    return buildResponse({ success: true, books });
  } catch(err) {
    Logger.log("getBookList error: " + err.message);
    return buildResponse({ success: false, error: err.message });
  }
}

// ── 画像をドライブにアップロード ─────────────────────
function uploadImageToDrive(data) {
  try {
    if (!data.folderUrl)   throw new Error("folderUrlが必要です");
    if (!data.imageBase64) throw new Error("imageBase64が必要です");

    // フォルダIDを複数の形式に対応
    let folderId = null;
    // 形式1: https://drive.google.com/drive/folders/ABC123...
    // 形式2: https://drive.google.com/open?id=ABC123...
    // 形式3: folders/ABC123
    let match = data.folderUrl.match(/folders\/([a-zA-Z0-9_\-]+)/);
    if (!match) match = data.folderUrl.match(/id=([a-zA-Z0-9_\-]+)/);
    if (match) folderId = match[1];

    if (!folderId) throw new Error("フォルダIDを抽出できません: " + data.folderUrl);
    if (folderId.length < 20) throw new Error("フォルダIDの形式が無効です（短すぎます）: " + folderId);

    const folder = DriveApp.getFolderById(folderId);

    // Base64デコード時のエラーハンドリング
    let decodedBytes;
    try {
      decodedBytes = Utilities.base64Decode(data.imageBase64);
    } catch(e) {
      throw new Error("Base64デコード失敗。無効な形式の可能性: " + e.message);
    }

    // クライアントから送られるMIMEタイプを使用（デフォルト: image/jpeg）
    const mimeType = data.imageMime || 'image/jpeg';
    const blob = Utilities.newBlob(
      decodedBytes,
      mimeType,
      data.fileName || ('page_' + Date.now() + '.jpg')
    );

    const file = folder.createFile(blob);
    Logger.log("画像保存成功: " + file.getName() + " (type: " + mimeType + ", size: " + decodedBytes.length + " bytes)");
    return buildResponse({ success: true, fileUrl: file.getUrl() });

  } catch(err) {
    Logger.log("画像アップロードエラー: " + err.message);
    return buildResponse({ success: false, error: err.message });
  }
}

// ── シート取得・初期化（旧レイアウトの自動マイグレーション付き）─
function getOrCreateSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  // 既存ヘッダーを十分な幅で読み取る（旧8列・新9列どちらにも対応）
  const readWidth      = Math.max(sheet.getLastColumn(), HEADERS.length);
  const existingHeader = sheet.getRange(1, 1, 1, readWidth).getValues()[0];

  // 既に新レイアウト（C列=表紙画像）なら何もしない
  if (matchHeaders(existingHeader, HEADERS)) return sheet;

  // 旧レイアウト（C列=著者名）を検知したら、実列を挿入してデータごと右へシフトする。
  // ※ヘッダー文字列だけ書き換えると既存データがズレるため、insertColumnAfter で実挿入する。
  const isOldLayout =
    String(existingHeader[1]) === "タイトル" && String(existingHeader[2]) === OLD_HEADERS[2];
  if (isOldLayout) {
    sheet.insertColumnAfter(2);  // C列を新規挿入（著者名以降が右へシフト、新C列は空）
    Logger.log("旧レイアウトを検知：C列に「表紙画像」列を挿入しました（既存データを保持してシフト）");
  }

  // ヘッダーを（再）設定
  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setValues([HEADERS]);
  headerRange
    .setFontWeight("bold")
    .setBackground("#1c3a5e")
    .setFontColor("#ffffff");
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(3, COVER_COL_WIDTH);  // 表紙画像列の幅
  sheet.autoResizeColumn(9);                 // 📁画像フォルダ列(I)
  Logger.log("ヘッダーを初期化/更新しました（9列レイアウト）");

  return sheet;
}

// ヘッダー比較（headers の要素数分だけ先頭を比較）
function matchHeaders(arr, headers) {
  for (let i = 0; i < headers.length; i++) {
    if (String(arr[i]) !== String(headers[i])) return false;
  }
  return true;
}

// ── Googleドライブフォルダ作成（CacheService で最適化） ─────
function createBookFolder(folderName) {
  try {
    const cache = CacheService.getScriptCache();
    let rootFolder;
    let cachedId = cache.get('rootFolderId');

    if (cachedId) {
      rootFolder = DriveApp.getFolderById(cachedId);
    } else {
      const rootSearch = DriveApp.getFoldersByName(ROOT_FOLDER);
      if (rootSearch.hasNext()) {
        rootFolder = rootSearch.next();
      } else {
        rootFolder = DriveApp.createFolder(ROOT_FOLDER);
        Logger.log("ルートフォルダ作成: " + ROOT_FOLDER);
      }
      cache.put('rootFolderId', rootFolder.getId(), 21600); // 6時間キャッシュ
    }

    const existing = rootFolder.getFoldersByName(folderName);
    if (existing.hasNext()) {
      const url = existing.next().getUrl();
      Logger.log("既存フォルダを使用: " + folderName);
      return url;
    }

    const newFolder = rootFolder.createFolder(folderName);
    const url = newFolder.getUrl();
    Logger.log("フォルダ作成成功: " + folderName + " (" + newFolder.getId() + ")");
    return url;

  } catch (err) {
    Logger.log("フォルダ作成エラー: " + err.message);
    return "";
  }
}

// ── フォルダ名サニタイズ ──────────────────────────────
function sanitizeFolderName(name) {
  return name
    .replace(/[\/\\:\*\?"<>\|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 100);
}

// ── レスポンス共通関数 ────────────────────────────────
function buildResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

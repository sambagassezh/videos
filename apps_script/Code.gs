/**
 * Sambagasse – recebe os vídeos do site (docs/index.html) e salva no Google Drive.
 *
 * Fica "dentro" da planilha Sambagasse – Vídeos (Extensões → Apps Script) e é publicado como
 * App da Web (executar como: eu · acesso: qualquer pessoa). Passo a passo no README.md.
 *
 * Segurança:
 * - Permissões mínimas (appsscript.json): só mexe nos arquivos que ELE criou (drive.file)
 *   e nesta planilha (spreadsheets.currentonly). O resto do Drive/Gmail fica fora de alcance.
 * - O token de acesso nunca sai daqui: o site manda pedaços do vídeo pra cá e este script
 *   repassa pro Drive. O endereço da sessão de upload também fica guardado aqui (cache).
 * - Só aceita vídeos, até MAX_MB cada, e no máximo MAX_PER_DAY vídeos por dia.
 * - Se uma mesma pessoa (uma visita ao site) passar de ALERT_GB no total, manda um email de aviso
 *   (pra ALERT_EMAIL nas Propriedades do script; o setup() preenche com o email desta conta).
 */

const FOLDER_NAME = "Sambagasse – Vídeos";
const MAX_MB = 50000; // na prática "aceita tudo"; só barra arquivo absurdo
const ALERT_GB = 5;
const MAX_PER_DAY = 300;
const CHUNK = 8 * 1024 * 1024; // múltiplo de 256 KB (exigência do Drive)
const FOLDER_MIME = "application/vnd.google-apps.folder";

const props = PropertiesService.getScriptProperties();
const cache = CacheService.getScriptCache();

// Rodar UMA vez pelo editor (▶ Executar): cria a pasta e o cabeçalho da planilha.
function setup() {
  let folderId = props.getProperty("FOLDER_ID");
  if (!folderId) {
    folderId = drive("post", "https://www.googleapis.com/drive/v3/files?fields=id", { name: FOLDER_NAME, mimeType: FOLDER_MIME }).id;
    props.setProperty("FOLDER_ID", folderId);
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Data", "Festa", "Nome / @", "Autorizou postar", "Arquivo", "Nome original", "MB", "Idioma", "Link"]);
    sheet.setFrozenRows(1);
  }
  if (!props.getProperty("ALERT_EMAIL")) props.setProperty("ALERT_EMAIL", Session.getEffectiveUser().getEmail());
  Logger.log("Pasta dos vídeos: https://drive.google.com/drive/folders/" + folderId);
  Logger.log("Avisos de upload grande vão pra: " + props.getProperty("ALERT_EMAIL") +
    " (pra trocar: ⚙️ Configurações do projeto → Propriedades do script → ALERT_EMAIL)");
}

// Abrir a URL do App da Web no navegador mostra isto: serve pra testar se a implantação funcionou.
function doGet() {
  return ContentService.createTextOutput("Sambagasse vídeos: ok");
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.action === "start") out = start(req);
    else if (req.action === "chunk") out = chunk(req);
    else if (req.action === "status") out = status(req);
    else throw fail("bad_request");
  } catch (x) {
    console.error(x);
    out = { error: x.code || "server", retry: !x.code };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// Abre uma sessão de upload "resumable" no Drive e devolve só um id (o endereço real fica no cache).
function start(req) {
  const size = Number(req.size);
  const type = String(req.type || "");
  if (!/^video\/[\w.+-]+$/.test(type)) throw fail("not_video");
  if (!(size > 0) || size > MAX_MB * 1024 * 1024) throw fail("too_big");
  countToday();

  const event = clean(req.event, 60) || "sem-festa";
  const credit = String(req.credit || "").trim().slice(0, 120);
  trackBatch(clean(req.batch, 20), size, event, credit);
  const original = String(req.name || "").slice(0, 200);
  const ext = (original.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "mp4";
  const stamp = Utilities.formatDate(new Date(), "Europe/Zurich", "yyyy-MM-dd_HH-mm-ss");
  const name = [stamp, clean(credit, 30), Utilities.getUuid().slice(0, 6)].filter(Boolean).join("_") + "." + ext;
  const description = `Enviado por: ${credit || "(sem nome)"}\nAutorizou postar: sim\nFesta: ${event}\nArquivo original: ${original}`;

  const res = UrlFetchApp.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name", {
    method: "post",
    contentType: "application/json; charset=UTF-8",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken(), "X-Upload-Content-Type": type, "X-Upload-Content-Length": String(size) },
    payload: JSON.stringify({ name, description, parents: [eventFolder(event)] }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error("start " + res.getResponseCode() + " " + res.getContentText());

  const id = Utilities.getUuid();
  const lang = clean(req.lang, 2);
  cache.put("u_" + id, JSON.stringify({ uri: header(res, "location"), size, type, name, original, event, credit, lang }), 21600);
  return { id, chunk: CHUNK };
}

// Recebe um pedaço (base64) e repassa pro Drive. Devolve até onde o Drive já tem, ou done.
function chunk(req) {
  const s = session(req.id);
  const offset = Number(req.offset);
  const bytes = Utilities.base64Decode(req.data);
  const end = offset + bytes.length - 1;
  if (!(offset >= 0) || !bytes.length || bytes.length > CHUNK || end >= s.size) throw fail("bad_request");
  return answer(req.id, s, UrlFetchApp.fetch(s.uri, {
    method: "put",
    contentType: s.type,
    headers: { "Content-Range": `bytes ${offset}-${end}/${s.size}` },
    payload: bytes,
    followRedirects: false, // o Drive responde 308 = "continua", não é redirecionamento
    muteHttpExceptions: true,
  }));
}

// Pergunta ao Drive até onde chegou (depois de uma queda de internet no meio de um pedaço).
function status(req) {
  const s = session(req.id);
  return answer(req.id, s, UrlFetchApp.fetch(s.uri, {
    method: "put",
    headers: { "Content-Range": `bytes */${s.size}` },
    followRedirects: false,
    muteHttpExceptions: true,
  }));
}

function answer(id, s, res) {
  const code = res.getResponseCode();
  if (code === 308) {
    const range = header(res, "range"); // "bytes=0-8388607"
    return { offset: range ? Number(range.split("-")[1]) + 1 : 0 };
  }
  if (code === 200 || code === 201) {
    cache.remove("u_" + id);
    logRow(s, JSON.parse(res.getContentText()).id);
    return { done: true };
  }
  if (code === 404 || code === 410) { cache.remove("u_" + id); throw fail("expired"); }
  throw new Error("drive " + code + " " + res.getContentText()); // 5xx etc.: o site tenta de novo
}

function logRow(s, fileId) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().getSheets()[0].appendRow([
      new Date(), s.event, s.credit, "sim", s.name, s.original,
      Math.round(s.size / 1e5) / 10, s.lang, "https://drive.google.com/file/d/" + fileId + "/view",
    ]);
  } catch (x) {
    console.error("planilha", x); // o vídeo já está salvo, e o crédito está na descrição do arquivo
  }
}

function session(id) {
  const raw = id && cache.get("u_" + id);
  if (!raw) throw fail("expired");
  return JSON.parse(raw);
}

// Uma subpasta por festa (?festa=outubro-2026), criada na primeira vez.
function eventFolder(event) {
  const k = "F_" + event;
  let id = props.getProperty(k);
  if (id) return id;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    id = props.getProperty(k);
    if (!id) {
      const root = props.getProperty("FOLDER_ID");
      if (!root) throw new Error("rode setup() primeiro");
      id = drive("post", "https://www.googleapis.com/drive/v3/files?fields=id", { name: event, mimeType: FOLDER_MIME, parents: [root] }).id;
      props.setProperty(k, id);
    }
    return id;
  } finally {
    lock.releaseLock();
  }
}

// Soma o que uma mesma visita ao site já mandou; ao passar de ALERT_GB, avisa por email (uma vez só).
// Conta pelo tamanho declarado no início de cada vídeo, então o aviso chega logo, não no fim.
function trackBatch(batch, size, event, credit) {
  if (!batch) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let b;
  try {
    b = JSON.parse(cache.get("B_" + batch) || '{"bytes":0,"n":0,"alerted":false}');
    b.bytes += size;
    b.n += 1;
    const cross = !b.alerted && b.bytes > ALERT_GB * 1e9;
    if (cross) b.alerted = true;
    cache.put("B_" + batch, JSON.stringify(b), 21600);
    if (!cross) return;
  } finally {
    lock.releaseLock();
  }
  const to = props.getProperty("ALERT_EMAIL");
  if (!to) return;
  try {
    MailApp.sendEmail(to, `Sambagasse vídeos: alguém já mandou ${(b.bytes / 1e9).toFixed(1)} GB`,
      `Uma mesma pessoa passou de ${ALERT_GB} GB de vídeos (o upload continua normalmente).\n\n` +
      `Festa: ${event}\nNome / @: ${credit || "(sem nome)"}\nVídeos até agora: ${b.n}\nTotal até agora: ${(b.bytes / 1e9).toFixed(1)} GB\n\n` +
      `Pasta: https://drive.google.com/drive/folders/${props.getProperty("FOLDER_ID")}\n` +
      `Planilha: ${SpreadsheetApp.getActiveSpreadsheet().getUrl()}`);
  } catch (x) {
    console.error("email", x);
  }
}

function countToday() {
  const k = "N_" + Utilities.formatDate(new Date(), "Europe/Zurich", "yyyy-MM-dd");
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const n = Number(props.getProperty(k) || 0);
    if (n >= MAX_PER_DAY) throw fail("limit");
    props.setProperty(k, String(n + 1));
  } finally {
    lock.releaseLock();
  }
}

function drive(method, url, body) {
  const res = UrlFetchApp.fetch(url, {
    method,
    contentType: "application/json; charset=UTF-8",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error("drive " + res.getResponseCode() + " " + res.getContentText());
  return JSON.parse(res.getContentText());
}

function header(res, name) {
  const all = res.getAllHeaders();
  for (const k in all) if (k.toLowerCase() === name) return Array.isArray(all[k]) ? all[k][0] : all[k];
  return null;
}

function clean(s, max) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max);
}

// Erros "conhecidos": o site mostra a mensagem certa e não fica tentando de novo.
function fail(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

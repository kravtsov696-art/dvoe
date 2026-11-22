// ROYAL TOOTH — приём заказов. Вставьте в Apps Script, привязанный к новой Google-таблице.
// Токен бота и ваш chat id хранятся в «Свойствах скрипта» (BOT_TOKEN, CHAT_ID), не в коде.

const ORDERS = "Заказы";
const CATALOG = "Каталог";

function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}

// Каталог: колонки code | цена | остаток | скрыть(да). Заполняйте — витрина подтянет.
function doGet(e) {
  if (e && e.parameter && e.parameter.api === "catalog") {
    const sh = sheet_(CATALOG, ["code", "price", "stock", "hidden"]);
    const v = sh.getDataRange().getValues().slice(1);
    const products = v.filter(r => r[0]).map(r => ({
      code: String(r[0]), price: Number(r[1]) || 0, stock: r[2] === "" ? "" : Number(r[2]), hidden: String(r[3]).toLowerCase() === "да"
    }));
    return json_({ ok: true, products });
  }
  return json_({ ok: true });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const d = JSON.parse(e.postData.contents);
    if (!d.name || !d.phone || !d.items || !d.items.length) return json_({ ok: false, error: "Пустой заказ" });
    const sh = sheet_(ORDERS, ["№", "Дата", "Имя", "Телефон", "Получение", "Адрес", "Состав", "Комментарий", "Telegram", "ID запроса", "Статус"]);
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {            // защита от дублей при повторной отправке
      if (data[i][9] === d.requestId) return json_({ ok: true, num: data[i][0] });
    }
    const num = data.length;                            // 1,2,3… (заголовок = 1 строка)
    const cat = {};
    sheet_(CATALOG, ["code", "price", "stock", "hidden"]).getDataRange().getValues().slice(1).forEach(r => cat[r[0]] = Number(r[1]) || 0);
    const text = d.items.map(it => it.code + " × " + it.qty + (cat[it.code] ? " (" + cat[it.code] + " ₽)" : "")).join("\n");
    sh.appendRow([num, new Date(), d.name, d.phone, d.delivery, d.address || "", text, d.comment || "",
      d.tgUsername ? "@" + d.tgUsername : (d.tgId || ""), d.requestId, "новый"]);
    notify_("🛒 Новый заказ №" + num + "\n" + d.name + ", " + d.phone + "\n" + d.delivery + (d.address ? ": " + d.address : "") + "\n\n" + text + (d.comment ? "\n\n💬 " + d.comment : ""));
    return json_({ ok: true, num: num });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally { lock.releaseLock(); }
}

function notify_(text) {
  const p = PropertiesService.getScriptProperties();
  const token = p.getProperty("BOT_TOKEN"), chat = p.getProperty("CHAT_ID");
  if (!token || !chat) return;
  try { UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", { method: "post", muteHttpExceptions: true, payload: { chat_id: chat, text: text } }); } catch (e) {}
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

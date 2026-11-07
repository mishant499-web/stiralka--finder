const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const positive = [
  "стиральн", "стиралка", "автомат", "washing machine"
];
const repairWords = [
  "не работает", "не включается", "не включ", "не отжимает", "не сливает",
  "не набирает", "не греет", "не крутит", "шумит", "стучит", "течет",
  "течёт", "ошибка", "неисправ", "под ремонт", "на запчасти", "под восстановление",
  "подшипник", "двигатель", "модуль", "плата", "сломана", "сломался", "бесплатно",
  "отдам", "даром"
];
const locationWords = [
  "екатеринбург", "верх-исет", "виз", "уралмаш", "эльмаш", "пионерский",
  "ботаника", "юго-запад", "автовокзал", "втузгородок", "уралмаш"
];

function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ").trim();
}

function getTag(block, names) {
  for (const name of names) {
    const re = new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + name + ">", "i");
    const match = block.match(re);
    if (match) return decode(match[1]);
  }
  return "";
}

function parseFeed(xml) {
  const blocks = xml.match(/<(item|entry)(?:\\s[^>]*)?>[\\s\\S]*?<\\/\\1>/gi) || [];
  return blocks.map(block => {
    let link = getTag(block, ["link"]);
    const linkAttr = block.match(/<link[^>]+href=["']([^"']+)["']/i);
    if (linkAttr) link = linkAttr[1];
    return {
      title: getTag(block, ["title"]),
      link,
      description: getTag(block, ["description", "summary", "content:encoded", "content"]),
      date: getTag(block, ["pubDate", "published", "updated"])
    };
  }).filter(item => item.title && item.link);
}

function priceOf(text) {
  const matches = [...text.matchAll(/(?:^|\\s)(\\d[\\d\\s]{0,5})\\s*(?:₽|руб(?:лей|ля)?|р\\.?)(?![а-я])/gi)];
  if (!matches.length) return null;
  const values = matches.map(m => Number(m[1].replace(/\\s/g, ""))).filter(n => Number.isFinite(n) && n >= 0);
  return values.length ? Math.min(...values) : null;
}

function isRelevant(item) {
  const text = (item.title + " " + item.description).toLowerCase();
  const hasMachine = positive.some(word => text.includes(word));
  const hasRepair = repairWords.some(word => text.includes(word));
  const hasLocation = locationWords.some(word => text.includes(word));
  const price = priceOf(text);
  const free = /бесплатно|даром|отдам\s+бесплатно|0\s*(?:₽|руб)/i.test(text);
  const cheap = price !== null && price <= 3000;
  return hasMachine && hasRepair && hasLocation && (free || cheap);
}

async function sendTelegram(text) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, disable_web_page_preview: false })
  });
  if (!r.ok) throw new Error("Telegram sendMessage failed: " + r.status);
}

async function isNew(url) {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    throw new Error("Для защиты от повторных уведомлений настрой UPSTASH_REDIS_REST_URL и UPSTASH_REDIS_REST_TOKEN");
  }
  const key = "listing:" + Buffer.from(url).toString("base64url");
  const r = await fetch(redisUrl.replace(/\/$/, "") + "/set/" + encodeURIComponent(key) + "/1/EX/2592000/NX", {
    headers: { Authorization: "Bearer " + redisToken }
  });
  const data = await r.json();
  return data.result === "OK";
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).send("Method Not Allowed");
  const secret = process.env.CRON_SECRET;
  const supplied = req.headers.authorization || "";
  if (!secret || supplied !== "Bearer " + secret) return res.status(401).send("Unauthorized");
  if (!BOT_TOKEN || !CHAT_ID) return res.status(500).send("Telegram environment variables are missing");

  const feeds = (process.env.RSS_FEEDS || "").split(/[;\n]/).map(s => s.trim()).filter(Boolean);
  if (!feeds.length) return res.status(200).json({ ok: true, message: "RSS_FEEDS is empty: add public RSS feed URLs in Vercel environment variables." });

  let checked = 0, sent = 0, errors = [];
  for (const url of feeds) {
    try {
      const response = await fetch(url, { headers: { "user-agent": "StiralkaFinder/1.0 (RSS reader)" } });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const xml = await response.text();
      for (const item of parseFeed(xml)) {
        checked++;
        if (!isRelevant(item)) continue;
        if (!(await isNew(item.link))) continue;
        const message = "🔧 Найдено объявление для проверки\n\n" +
          item.title + "\n\n" + item.description.slice(0, 700) +
          (item.date ? "\n\nДата: " + item.date : "") + "\n\n" + item.link +
          "\n\nПроверь цену, адрес и состояние по ссылке.";
        await sendTelegram(message);
        sent++;
      }
    } catch (e) {
      errors.push(url + ": " + e.message);
    }
  }
  return res.status(200).json({ ok: true, checked, sent, errors });
};

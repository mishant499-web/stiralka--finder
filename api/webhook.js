const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return response.json();
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  if (!BOT_TOKEN) return res.status(500).send("TELEGRAM_BOT_TOKEN is not configured");

  const message = req.body && (req.body.message || req.body.edited_message);
  if (!message || !message.chat) return res.status(200).json({ ok: true });

  const chatId = String(message.chat.id);
  const text = String(message.text || "").trim();

  if (text === "/start" || text.startsWith("/start ")) {
    await telegram("sendMessage", {
      chat_id: chatId,
      text: "Бот поиска стиральных машин запущен!\n\nТвой Telegram chat ID: " + chatId +
        "\n\nДобавь этот ID в переменную TELEGRAM_CHAT_ID в настройках проекта Vercel. " +
        "Токен бота никому не отправляй."
    });
  } else if (text === "/id") {
    await telegram("sendMessage", { chat_id: chatId, text: "Твой chat ID: " + chatId });
  } else if (text === "/help") {
    await telegram("sendMessage", {
      chat_id: chatId,
      text: "Команды:\n/start — подключить уведомления и узнать chat ID\n/id — показать chat ID\n/help — помощь"
    });
  }

  return res.status(200).json({ ok: true });
};

// Подключаем dotenv для чтения переменных среды
require("dotenv").config();

const { Bot, InputFile } = require("grammy");
const fs = require("fs");
const path = require("path");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);

if (!BOT_TOKEN) {
    console.error("❌ КРИТИЧЕСКАЯ ОШИБКА: Токен бота (BOT_TOKEN) не найден в файле .env!");
    process.exit(1);
}

// Создаем чистого бота на grammY
const bot = new Bot(BOT_TOKEN);
let botUsername = "";

// 1. ОБРАБОТКА КОМАНДЫ /START
bot.command("start", async (ctx) => {
    const userId = ctx.from.id;
    const args = ctx.match; // Параметр из ссылки (file_id)

    // Сценарий А: Пользователь перешел по ссылке (скачивание файла)
    if (args) {
        try {
            await ctx.replyWithChatAction("upload_document");
            // Отправляем файл (Telegram сам поймет тип файла по его file_id)
            await ctx.replyWithDocument(args, {
                caption: "✨ Ваш файл успешно найден и готов к скачиванию!"
            });
        } catch (error) {
            console.error("Ошибка при отправке файла по ссылке:", error);
            await ctx.reply("❌ Не удалось получить файл. Возможно, ссылка устарела или файл был удален.");
        }
        return;
    }

    // Сценарий Б: Вы (Администратор) зашли без ссылки
    if (userId === ADMIN_ID) {
        return ctx.reply(
            "👋 **Привет, Создатель!**\n\n" +
            "Я работаю в штатном режиме без VPN. Чтобы сгенерировать секретную ссылку, просто **отправь мне любой файл** (музыку в .mp3, архив .zip, документ и т.д.).",
            { parse_mode: "Markdown" }
        );
    }

    // Сценарий В: Обычный пользователь зашел без ссылки (Приветственное сообщение)
    const welcomeText = "Привет! Добро пожаловать в Bloom. Здесь ты можешь получить ресурсы с нашего телеграм канала. Перейди по ссылке-инвайту, чтобы получить нужный файл.";
    const imagePath = path.join(__dirname, "images", "welcome.jpg");

    try {
        if (fs.existsSync(imagePath)) {
            await ctx.replyWithPhoto(new InputFile(imagePath), { caption: welcomeText });
        } else {
            await ctx.reply(welcomeText);
        }
    } catch (error) {
        console.error("Ошибка при отправке приветствия:", error);
        await ctx.reply(welcomeText).catch(() => {});
    }
});

// 2. ОБРАБОТКА И ГЕНЕРАЦИЯ ССЫЛОК ДЛЯ АДМИНИСТРАТОРА (.mp3, .zip, .rar и любые документы)
bot.on([":audio", ":document"], async (ctx) => {
    const userId = ctx.from.id;

    // Игнорируем всех, кроме вас
    if (userId !== ADMIN_ID) return;

    // Извлекаем file_id и имя файла
    const fileId = ctx.message.audio ? ctx.message.audio.file_id : ctx.message.document.file_id;
    const fileName = ctx.message.audio ? (ctx.message.audio.title || "audio.mp3") : (ctx.message.document.file_name || "file");

    if (!fileId) {
        return ctx.reply("❌ Не удалось определить ID файла. Попробуйте загрузить его еще раз.");
    }

    // Формируем красивую deep-link ссылку
    const deepLink = "https://t.me" + botUsername + "?start=" + fileId;

    await ctx.reply(
        "📦 *Файл успешно обработан!*\n\n" +
        "📝 *Имя файла:* `" + fileName + "`\n" +
        "🔗 *Специальная ссылка:* `" + deepLink + "`\n\n" +
        "Скопируйте ссылку выше и вставьте её в свой пост.",
        { parse_mode: "Markdown" }
    );
});

// Запуск бота
(async () => {
    try {
        const botInfo = await bot.api.getMe();
        botUsername = botInfo.username;
        
        console.log("🤖 Бот @" + botUsername + " успешно запущен и готов к работе без VPN!");
        bot.start();
    } catch (error) {
        console.error("Критическая ошибка при запуске бота:", error);
    }
})();

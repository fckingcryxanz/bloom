require("dotenv").config();
const { Bot, InputFile, InlineKeyboard } = require("grammy");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg"); // Подключаем PostgreSQL драйвер

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const DATABASE_URL = process.env.DATABASE_URL;

if (!BOT_TOKEN) {
    console.error("❌ КРИТИЧЕСКАЯ ОШИБКА: Токен бота не найден в файле .env!");
    process.exit(1);
}

if (!DATABASE_URL) {
    console.error("❌ КРИТИЧЕСКАЯ ОШИБКА: Строка подключения DATABASE_URL не найдена в файле .env!");
    process.exit(1);
}

// 1. ИНИЦИАЛИЗАЦИЯ И ПОДКЛЮЧЕНИЕ К POSTGRESQL
const db = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Позволяет безопасно подключаться к облачным базам данных
});

const bot = new Bot(BOT_TOKEN);
let botUsername = "";

// Функция для генерации коротких уникальных кодов для ссылок
function generateShortId() {
    return Math.random().toString(36).substring(2, 8);
}

// 2. УЛАВЛИВАНИЕ АЙДИ КАСТOMНЫХ ЭМОДЗИ (ДЛЯ АДМИНИСТРАТОРА)
bot.on("message:text", async (ctx, next) => {
    if (ctx.from.id !== ADMIN_ID) return next();

    const entities = ctx.message.entities;
    if (entities) {
        const customEmojis = entities.filter(e => e.type === "custom_emoji");
        if (customEmojis.length > 0) {
            let report = "🎯 **Обнаружены ID кастомных эмодзи:**\n\n";
            customEmojis.forEach((emoji, index) => {
                report += `${index + 1}. Код: \`\${emoji.custom_emoji_id}\`\n`;
            });
            await ctx.reply(report, { parse_mode: "Markdown" });
            return; 
        }
    }
    await next();
});

// 3. ОБРАБОТКА КОМАНДЫ /START
bot.command("start", async (ctx) => {
    const userId = ctx.from.id;
    const args = ctx.match; // Короткий ID из ссылки (например, t.me/bot?start=abc123)

    // Сценарий А: Переход по короткой секретной ссылке (Скачивание файла)
    if (args) {
        try {
            const res = await db.query("SELECT * FROM resources WHERE short_id = \$1", [args]);
            const fileRow = res.rows[0];
            
            if (fileRow) {
                // Инкрементируем счетчик скачиваний в PostgreSQL
                await db.query("UPDATE resources SET clicks = clicks + 1 WHERE short_id = \$1", [args]);
                
                await ctx.replyWithChatAction("upload_document");
                
                // Кнопка-ссылка на твой канал под отправленным файлом
                const keyboard = new InlineKeyboard().url("📢 Перейти в Bloom", "https://t.me");

                await ctx.replyWithDocument(fileRow.file_id, {
                    caption: `✨ **Ваш файл найден!**\n📦 _Имя:_ ${fileRow.file_name}`,
                    parse_mode: "Markdown",
                    reply_markup: keyboard
                });
            } else {
                await ctx.reply("❌ Ссылка недействительна или файл больше не существует.");
            }
        } catch (error) {
            console.error("Ошибка при поиске файла в Postgres:", error);
            await ctx.reply("❌ Произошла ошибка базы данных при получении файла.");
        }
        return;
    }

    // Сценарий Б: Вы (Администратор) зашли без ссылки — выводим панель статистики из Postgres
    if (userId === ADMIN_ID) {
        try {
            const countRes = await db.query("SELECT COUNT(*) as count FROM resources");
            const totalFiles = countRes.rows[0].count;

            const clicksRes = await db.query("SELECT SUM(clicks) as clicks FROM resources");
            const totalClicks = clicksRes.rows[0].clicks || 0;

            const topRes = await db.query("SELECT * FROM resources ORDER BY clicks DESC LIMIT 5");
            const topFiles = topRes.rows;

            let adminMsg = `👋 **Привет, Создатель!**\n\n`;
            adminMsg += ` Bars **Статистика бота (PostgreSQL):**\n`;
            adminMsg += ` 📁 Всего загружено файлов: \`\${totalFiles}\`\n`;
            adminMsg += ` 📈 Всего скачиваний: \`\${totalClicks}\`\n\n`;
            
            if (topFiles.length > 0) {
                adminMsg += `🔝 **Топ-5 скачиваемых файлов:**\n`;
                topFiles.forEach(f => {
                    adminMsg += `• \`\${f.file_name}\` — скачан *${f.clicks}* раз(а)\n`;
                });
                adminMsg += `\n`;
            }
            
            adminMsg += `👉 Просто **отправь мне любой файл** (.zip, .mp3, документ), и я сделаю для него короткую ссылку со сбором статистики.`;

            const adminKeyboard = new InlineKeyboard().url("🛠 Настройки Bloom", "https://t.me");
            return ctx.reply(adminMsg, { parse_mode: "Markdown", reply_markup: adminKeyboard });
        } catch (error) {
            console.error("Ошибка при получении статистики из Postgres:", error);
            return ctx.reply("❌ Ошибка при формировании админ-статистики.");
        }
    }

    // Сценарий В: Обычный пользователь зашел без ссылки (Приветствие Bloom)
    const welcomeText = "Привет! Добро пожаловать в Bloom. Здесь ты можешь получить ресурсы с нашего телеграм канала. Перейди по ссылке-инвайту, чтобы получить нужный файл.";
    const imagePath = path.join(__dirname, "images", "welcome.jpg");

    try {
        if (fs.existsSync(imagePath)) {
            await ctx.replyWithPhoto(new InputFile(imagePath), { caption: welcomeText, parse_mode: "HTML" });
        } else {
            await ctx.reply(welcomeText, { parse_mode: "HTML" });
        }
    } catch (error) {
        console.error("Ошибка при отправке приветствия:", error);
        await ctx.reply(welcomeText).catch(() => {});
    }
});

// 4. ОБРАБОТКА И СОХРАНЕНИЕ ФАЙЛОВ ОТ АДМИНИСТРАТОРА
bot.on([":audio", ":document"], async (ctx) => {
    const userId = ctx.from.id;
    if (userId !== ADMIN_ID) return;

    const fileId = ctx.message.audio ? ctx.message.audio.file_id : ctx.message.document.file_id;
    const fileName = ctx.message.audio ? (ctx.message.audio.title || "audio.mp3") : (ctx.message.document.file_name || "file");

    if (!fileId) {
        return ctx.reply("❌ Не удалось определить ID файла.");
    }

    const shortId = generateShortId();

    try {
        // Сохраняем в таблицу базы данных PostgreSQL
        await db.query(
            "INSERT INTO resources (short_id, file_id, file_name) VALUES (\$1, \$2, \$3)", 
            [shortId, fileId, fileName]
        );

        const shortLink = `https://t.me{botUsername}?start=${shortId}`;

        await ctx.reply(
            `📦 **Файл успешно добавлен в PostgreSQL!**\n\n` +
            `📝 *Имя файла:* \`\${fileName}\`\n` +
            `🔗 *Короткая ссылка:* \`\${shortLink}\`\n\n` +
            `Статистика переходов запущена!`,
            { parse_mode: "Markdown" }
        );
    } catch (error) {
        console.error("Ошибка сохранения файла в Postgres:", error);
        await ctx.reply("❌ Ошибка: Не удалось сохранить файл в базу данных.");
    }
});

// Запуск базы данных и бота
(async () => {
    try {
        // Подключаемся к Postgres
        await db.connect();
        
        // Создаем таблицу, если её нет в базе данных хостинга
        await db.query(`
            CREATE TABLE IF NOT EXISTS resources (
                short_id VARCHAR(50) PRIMARY KEY,
                file_id TEXT NOT NULL,
                file_name TEXT NOT NULL,
                clicks INTEGER DEFAULT 0
            )
        `);
        
        const botInfo = await bot.api.getMe();
        botUsername = botInfo.username;
        console.log(`🤖 Бот @${botUsername} успешно подключен к PostgreSQL и запущен!`);
        
        bot.start();
    } catch (error) {
        console.error("Критическая ошибка при запуске проекта:", error);
    }
})();

const fs = require("fs");
const path = require("path");
const { InlineKeyboard, InputFile } = require("grammy");

const captchaWords = ["САМОЛЕТ", "МАШИНА", "BLOOM", "КОМПЬЮТЕР", "ТЕПЛОВОЗ", "ВЕЛОСИПЕД", "БЕГЕМОТ", "СОЛНЦЕ", "РАКЕТА", "ОБЛАКО"];

async function checkSubscription(ctx, userId) {
    try {
        const member = await ctx.api.getChatMember("@bloomhold", userId);
        return ["creator", "administrator", "member"].includes(member.status);
    } catch (e) {
        console.error("⚠️ ВНИМАНИЕ: Ошибка проверки подписки. Бот не админ в канале @bloomhold.");
        return true; 
    }
}

async function sendSubscriptionRequire(ctx) {
    // Переносим эмодзи спонсора (5258420634785947640) на кнопку проверки
    const keyboard = new InlineKeyboard()
        .url("📢 Перейти в Bloom", "https://t.me")
        .row()
        .text("<tg-emoji emoji-id=\"5258420634785947640\">✔️</tg-emoji> Я выполнил все условия - Проверить.", "check_sub");

    const msg = "Чтобы скачать этот ресурс — выполните условия спонсоров ниже и нажмите кнопку «Проверить».\n\n*(с премиум подпиской у вас не будет никакой рекламы)*";
    
    return ctx.reply(msg, { reply_markup: keyboard, parse_mode: "Markdown" });
}

async function sendWelcomeScreen(ctx) {
    const welcomeText = "Привет! Добро пожаловать в RoomDev.\n\nЗдесь ты можешь получить ресурсы с нашего Discord-сервера.\nПерейди по ссылке-инвайту, чтобы получить нужный файл.";
    const imagePath = path.join(__dirname, "images", "welcome.jpg");

    // Кастомный эмодзи приветствия (5406736391071635215) выносим на инлайн-кнопку под приветствием
    const welcomeKeyboard = new InlineKeyboard()
        .text("<tg-emoji emoji-id=\"5406736391071635215\">👋</tg-emoji> Добро пожаловать!", "welcome_click");

    try {
        if (fs.existsSync(imagePath)) {
            return ctx.replyWithPhoto(new InputFile(imagePath), { caption: welcomeText, reply_markup: welcomeKeyboard, parse_mode: "Markdown" });
        } else {
            return ctx.reply(welcomeText, { reply_markup: welcomeKeyboard, parse_mode: "Markdown" });
        }
    } catch (error) {
        return ctx.reply(welcomeText, { reply_markup: welcomeKeyboard, parse_mode: "Markdown" });
    }
}

async function sendCaptcha(ctx, db, userId, targetShortId) {
    const word = captchaWords[Math.floor(Math.random() * captchaWords.length)];
    
    await db.query(
        "INSERT INTO users_state (user_id, state, data) VALUES (\$1, 'WAITING_CAPTCHA', \$2) ON CONFLICT (user_id) DO UPDATE SET state = 'WAITING_CAPTCHA', data = \$2",
        [userId, word + "|" + targetShortId]
    );
    
    return ctx.reply("⏳ **Пройдите проверку на робота.**\n\nНапишите в ответ слово капчи: **" + word + "**", { parse_mode: "Markdown" });
}

async function handleFileDelivery(ctx, db, correctWord, targetShortId, userId) {
    try {
        const res = await db.query("SELECT * FROM resources WHERE short_id = \$1", [targetShortId]);
        
        if (res.rows && res.rows.length > 0) {
            const fileRow = res.rows[0]; 
            await db.query("UPDATE resources SET clicks = clicks + 1 WHERE short_id = \$1", [targetShortId]);
            await ctx.replyWithChatAction("upload_document");
            
            const rateRes = await db.query("SELECT COUNT(*) as count, AVG(stars) as avg_stars FROM ratings WHERE short_id = \$1", [targetShortId]);
            const count = rateRes.rows[0].count || 0; 
            const avg = rateRes.rows[0].avg_stars ? Number(rateRes.rows[0].avg_stars).toFixed(1) : "0.0";

            // Размещаем кастомные эмодзи СКАЧАТЬ (5404467901015037890) и ОЦЕНИТЬ (5404460960347890242) прямо на кнопках управления файлом
            const fileKeyboard = new InlineKeyboard()
                .text("<tg-emoji emoji-id=\"5404467901015037890\">📥</tg-emoji> Скачиваний: " + (Number(fileRow.clicks) + 1), "clicks_stat")
                .row()
                .text("<tg-emoji emoji-id=\"5404460960347890242\">⭐</tg-emoji> Оценить ресурс (" + avg + "/5)", "rate_" + targetShortId);

            const captionText = "📦 **Файл найден и готов к загрузке!**\n\n" +
                "📝 *Имя файла:* `" + fileRow.file_name + "`\n" +
                "💬 Количество отзывов: " + count + "\n\n" +
                "Спасибо, что выбираете RoomDev!";

            return ctx.replyWithDocument(fileRow.file_id, {
                caption: captionText,
                parse_mode: "Markdown",
                reply_markup: fileKeyboard
            });
        } else {
            return ctx.reply("❌ Ресурс не найден в базе данных.");
        }
    } catch (err) {
        console.error(err);
        return ctx.reply("❌ Ошибка при получении файла.");
    }
}

module.exports = { checkSubscription, sendSubscriptionRequire, sendWelcomeScreen, sendCaptcha, handleFileDelivery };

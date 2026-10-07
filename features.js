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
    // Чистые кнопки со стандартными красивыми эмодзи, которые не превратятся в цифры
    const keyboard = new InlineKeyboard()
        .url("📢 Перейти в Bloom", "https://t.me")
        .row()
        .text("✔️ Я выполнил все условия - Проверить.", "check_sub");

    // Кастомные эмодзи (6113862083017711187 и 5258420634785947640) выводим в текст сообщения через HTML-тег
    const msg = "<tg-emoji emoji-id=\"6113862083017711187\">📢</tg-emoji> <tg-emoji emoji-id=\"5258420634785947640\">⚠️</tg-emoji> <b>Чтобы скачать этот ресурс — выполните условия спонсоров ниже и нажмите кнопку «Проверить».</b>\n\n(с премиум подпиской у вас не будет никакой рекламы)";
    
    return ctx.reply(msg, { reply_markup: keyboard, parse_mode: "HTML" });
}

async function sendWelcomeScreen(ctx) {
    // Кастомный эмодзи приветствия (5406736391071635215) в тексте сообщения
    const welcomeText = "<tg-emoji emoji-id=\"5406736391071635215\">👋</tg-emoji> <b>Привет! Добро пожаловать в RoomDev.</b>\n\nЗдесь ты можешь получить ресурсы с нашего Discord-сервера.\nПерейди по ссылке-инвайту, чтобы получить нужный файл.";
    const imagePath = path.join(__dirname, "images", "welcome.jpg");

    const welcomeKeyboard = new InlineKeyboard()
        .text("👋 Войти в меню", "welcome_click");

    try {
        if (fs.existsSync(imagePath)) {
            return ctx.replyWithPhoto(new InputFile(imagePath), { caption: welcomeText, reply_markup: welcomeKeyboard, parse_mode: "HTML" });
        } else {
            return ctx.reply(welcomeText, { reply_markup: welcomeKeyboard, parse_mode: "HTML" });
        }
    } catch (error) {
        return ctx.reply(welcomeText, { reply_markup: welcomeKeyboard, parse_mode: "HTML" });
    }
}

async function sendCaptcha(ctx, db, userId, targetShortId) {
    const word = captchaWords[Math.floor(Math.random() * captchaWords.length)];
    
    await db.query(
        "INSERT INTO users_state (user_id, state, data) VALUES ($1, 'WAITING_CAPTCHA', $2) ON CONFLICT (user_id) DO UPDATE SET state = 'WAITING_CAPTCHA', data = $2",
        [userId, word + "|" + targetShortId]
    );
    
    return ctx.reply("⏳ <b>Пройдите проверку на робота.</b>\n\nНапишите в ответ слово капчи: <b>" + word + "</b>", { parse_mode: "HTML" });
}

async function handleFileDelivery(ctx, db, correctWord, targetShortId, userId) {
    try {
        const res = await db.query("SELECT * FROM resources WHERE short_id = $1", [targetShortId]);
        
        if (res.rows && res.rows.length > 0) {
            const fileRow = res.rows[0]; 
            await db.query("UPDATE resources SET clicks = clicks + 1 WHERE short_id = $1", [targetShortId]);
            await ctx.api.sendChatAction(ctx.chat.id, "upload_document");
            
            const rateRes = await db.query("SELECT COUNT(*) as count, AVG(stars) as avg_stars FROM ratings WHERE short_id = $1", [targetShortId]);
            const count = rateRes.rows[0].count || 0; 
            const avg = rateRes.rows[0].avg_stars ? Number(rateRes.rows[0].avg_stars).toFixed(1) : "0.0";

            const fileKeyboard = new InlineKeyboard()
                .text("⭐️ Оценить ресурс (" + avg + "/5)", "rate_" + targetShortId);

            // Выводим статус пройденной капчи с кастомным эмодзи 6113862083017711187 в тексте
            await ctx.reply("<tg-emoji emoji-id=\"6113862083017711187\">✅</tg-emoji> <b>Капча пройдена!</b>\nСлово: " + correctWord, { parse_mode: "HTML" });

            // Выводим информацию о файле с кастомными эмодзи скачивания и отзывов
            const captionText = "<tg-emoji emoji-id=\"5404467901015037890\">📥</tg-emoji> <b>RW " + fileRow.file_name + "</b>\n\n" +
                "<tg-emoji emoji-id=\"5406915890639835169\">🔝</tg-emoji> Скачиваний: " + (Number(fileRow.clicks) + 1) + "\n" +
                "<tg-emoji emoji-id=\"5407103881358380847\">💬</tg-emoji> Количество отзывов: " + count + "\n\n" +
                "Спасибо, что выбираете RoomDev!";

            return ctx.replyWithDocument(fileRow.file_id, {
                caption: captionText,
                parse_mode: "HTML",
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

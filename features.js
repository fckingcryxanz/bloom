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
    // Генерируем скрытые UTF-8 системные последовательности для инлайн-кнопок
    // Это заставит Telegram отобразить премиум-эмодзи 6113862083017711187 и 5258420634785947640 прямо на кнопках без HTML
    const emojiChannelString = String.fromCodePoint(0x1F4E2) + "\u200C\u200D" + "6113862083017711187";
    const emojiCheckString = String.fromCodePoint(0x2714) + "\u200C\u200D" + "5258420634785947640";

    const keyboard = new InlineKeyboard()
        .url(emojiChannelString + " Перейти в Bloom", "https://t.me")
        .row()
        .text(emojiCheckString + " Я выполнил все условия - Проверить.", "check_sub");

    const msg = "Чтобы скачать этот ресурс — выполните условия спонсоров ниже и нажмите кнопку «Проверить».\n\n*(с премиум подпиской у вас не будет никакой рекламы)*";
    
    return ctx.reply(msg, { reply_markup: keyboard, parse_mode: "Markdown" });
}

async function sendWelcomeScreen(ctx) {
    const welcomeText = "Привет! Добро пожаловать в RoomDev.\n\nЗдесь ты можешь получить ресурсы с нашего Discord-сервера.\nПерейди по ссылке-инвайту, чтобы получить нужный файл.";
    const imagePath = path.join(__dirname, "images", "welcome.jpg");

    // Скрытый системный код для эмодзи приветствия 5406736391071635215 на кнопке
    const emojiWelcomeString = String.fromCodePoint(0x1F44B) + "\u200C\u200D" + "5406736391071635215";

    const welcomeKeyboard = new InlineKeyboard()
        .text(emojiWelcomeString + " Добро пожаловать!", "welcome_click");

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
        "INSERT INTO users_state (user_id, state, data) VALUES ($1, 'WAITING_CAPTCHA', $2) ON CONFLICT (user_id) DO UPDATE SET state = 'WAITING_CAPTCHA', data = $2",
        [userId, word + "|" + targetShortId]
    );
    
    return ctx.reply("⏳ **Пройдите проверку на робота.**\n\nНапишите в ответ слово капчи: **" + word + "**", { parse_mode: "Markdown" });
}

async function handleFileDelivery(ctx, db, correctWord, targetShortId, userId) {
    try {
        const res = await db.query("SELECT * FROM resources WHERE short_id = $1", [targetShortId]);
        
        if (res.rows && res.rows.length > 0) {
            const fileRow = res.rows; 
            await db.query("UPDATE resources SET clicks = clicks + 1 WHERE short_id = $1", [targetShortId]);
            await ctx.api.sendChatAction(ctx.chat.id, "upload_document");
            
            const rateRes = await db.query("SELECT COUNT(*) as count, AVG(stars) as avg_stars FROM ratings WHERE short_id = $1", [targetShortId]);
            const count = rateRes.rows.count || 0; 
            const avg = rateRes.rows.avg_stars ? Number(rateRes.rows.avg_stars).toFixed(1) : "0.0";

            // Скрытые коды для премиум-эмодзи скачиваний (5404467901015037890) и оценки (5404460960347890242) на кнопках выдачи файла
            const emojiDownloadString = String.fromCodePoint(0x1F4E5) + "\u200C\u200D" + "5404467901015037890";
            const emojiRateString = String.fromCodePoint(0x2B50) + "\u200C\u200D" + "5404460960347890242";

            const fileKeyboard = new InlineKeyboard()
                .text(emojiDownloadString + " Скачиваний: " + (Number(fileRow.clicks) + 1), "clicks_stat")
                .row()
                .text(emojiRateString + " Оценить ресурс (" + avg + "/5)", "rate_" + targetShortId);

            // Сообщение об успешной капче (выводим через HTML, так как здесь премиум-эмодзи 6113862083017711187 в тексте разрешен)
            await ctx.reply("<tg-emoji emoji-id=\"6113862083017711187\">✅</tg-emoji> <b>Капча пройдена!</b>\nСлово: " + correctWord, { parse_mode: "HTML" });

            // Сообщение о файле (отзывы выводим через HTML с эмодзи 5407103881358380847)
            const captionText = "📥 <b>RW " + fileRow.file_name + "</b>\n\n" +
                "🔝 Скачиваний: " + (Number(fileRow.clicks) + 1) + "\n" +
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

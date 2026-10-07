const fs = require("fs");
const path = require("path");
const { InlineKeyboard } = require("grammy");

const captchaWords = ["САМОЛЕТ", "МАШИНА", "BLOOM", "КОМПЬЮТЕР", "ТЕПЛОВОЗ", "ВЕЛОСИПЕД", "БЕГЕМОТ", "СОЛНЦЕ", "РАКЕТА", "ОБЛАКО"];
const ADMIN_ID = Number(process.env.ADMIN_ID);

async function checkSubscription(ctx, userId) {
    try {
        const member = await ctx.api.getChatMember("@bloomhold", userId);
        return ["creator", "administrator", "member"].includes(member.status);
    } catch (e) {
        console.error("Ошибка при проверке подписки: ", e);
        return true; 
    }
}

async function sendSubscriptionRequire(ctx) {
    const keyboard = new InlineKeyboard()
        .url("📢 Перейти в Bloom", "https://t.me")
        .row()
        .text("Я выполнил все условия - Проверить.", "check_sub");

    const msg = "<tg-emoji emoji-id=\"5258420634785947640\"> Sponsor </tg-emoji> Чтобы скачать этот ресурс — выполните условия спонсоров ниже и нажмите «Проверить».\n(с премиум подпиской у вас не будет никакой рекламы)";
    await ctx.reply(msg, { reply_markup: keyboard, parse_mode: "HTML" });
}

async function sendWelcomeScreen(ctx) {
    const welcomeText = "<tg-emoji emoji-id=\"5406736391071635215\"> Welcome </tg-emoji> Привет! Добро пожаловать в RoomDev.\n\nЗдесь ты можешь получить ресурсы с нашего Discord-сервера.\nПерейди по ссылке-инвайту, чтобы получить нужный файл.";
    const imagePath = path.join(__dirname, "images", "welcome.jpg");

    try {
        if (fs.existsSync(imagePath)) {
            await ctx.replyWithPhoto(new new require("grammy").InputFile(imagePath), { caption: welcomeText, parse_mode: "HTML" });
        } else {
            await ctx.reply(welcomeText, { parse_mode: "HTML" });
        }
    } catch (error) {
        await ctx.reply(welcomeText, { parse_mode: "HTML" }).catch(() => {});
    }
}

async function sendCaptcha(ctx, db, userId, targetShortId) {
    const word = captchaWords[Math.floor(Math.random() * captchaWords.length)];
    await db.query(
        "INSERT INTO users_state (user_id, state, data) VALUES ($1, 'WAITING_CAPTCHA', $2) ON CONFLICT (user_id) DO UPDATE SET state = 'WAITING_CAPTCHA', data = $2",
        [userId, word + "|" + targetShortId]
    );
    await ctx.reply("⏳ **Пройдите проверку на робота.**\nНапишите в ответ слово капчи: **" + word + "**", { parse_mode: "Markdown" });
}

async function handleFileDelivery(ctx, db, correctWord, targetShortId, userId) {
    try {
        const res = await db.query("SELECT * FROM resources WHERE short_id = $1", [targetShortId]);
        const fileRow = res.rows[0];
        
        if (fileRow) {
            await db.query("UPDATE resources SET clicks = clicks + 1 WHERE short_id = $1", [targetShortId]);
            await ctx.replyWithChatAction("upload_document");
            
            const rateRes = await db.query("SELECT COUNT(*) as count, AVG(stars) as avg_stars FROM ratings WHERE short_id = $1", [targetShortId]);
            const count = rateRes.rows[0].count || 0;
            const avg = rateRes.rows[0].avg_stars ? Number(rateRes.rows[0].avg_stars).toFixed(1) : "0.0";

            const fileKeyboard = new InlineKeyboard()
                .text("<tg-emoji emoji-id=\"5404460960347890242\">⭐</tg-emoji> Оценить ресурс", "rate_" + targetShortId);

            const captionText = "<tg-emoji emoji-id=\"5404467901015037890\">📥</tg-emoji> **RW " + fileRow.file_name + "**\n\n" +
                "<tg-emoji emoji-id=\"5406915890639835169\">🔝</tg-emoji> Скачиваний: " + (fileRow.clicks + 1) + "\n" +
                "⚪ Оценка: " + avg + "/5 (оценок: " + count + ")\n\n" +
                "Спасибо, что выбираете RoomDev!";

            await ctx.replyWithDocument(fileRow.file_id, {
                caption: captionText,
                parse_mode: "Markdown",
                reply_markup: fileKeyboard
            });
        } else {
            await ctx.reply("❌ Ресурс не найден.");
        }
    } catch (err) {
        console.error(err);
        await ctx.reply("❌ Ошибка при получении файла.");
    }
}

module.exports = { checkSubscription, sendSubscriptionRequire, sendWelcomeScreen, sendCaptcha, handleFileDelivery, ADMIN_ID };

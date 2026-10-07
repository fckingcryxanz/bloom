require("dotenv").config();
const { Bot, InlineKeyboard } = require("grammy");
const { Client } = require("pg");

const { registerEmojiHandler } = require("./emojiHandler");
const { checkSubscription, sendSubscriptionRequire, sendWelcomeScreen, sendCaptcha, handleFileDelivery } = require("./features");
const { sendAdminPanel } = require("./adminPanel");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const DATABASE_URL = process.env.DATABASE_URL;

if (!BOT_TOKEN || !DATABASE_URL) {
    console.error("❌ КРИТИЧЕСКАЯ ОШИБКА: Проверьте переменные окружения BOT_TOKEN и DATABASE_URL!");
    process.exit(1);
}

const db = new Client({ connectionString: DATABASE_URL });
const bot = new Bot(BOT_TOKEN);
let botUsername = "";

registerEmojiHandler(bot);

bot.command("start", async (ctx) => {
    const userId = ctx.from.id;
    const args = ctx.match; 

    await db.query("DELETE FROM users_state WHERE user_id = \$1", [userId]);

    const isSubbed = await checkSubscription(ctx, userId);
    if (!isSubbed) {
        if (args) {
            await db.query("INSERT INTO users_state (user_id, state, data) VALUES (\$1, 'PENDING_SUB', \$2) ON CONFLICT (user_id) DO UPDATE SET state = 'PENDING_SUB', data = \$2", [userId, args]);
        }
        return sendSubscriptionRequire(ctx);
    }

    if (args) {
        return sendCaptcha(ctx, db, userId, args);
    }

    if (userId === ADMIN_ID) {
        return sendAdminPanel(ctx, db);
    }

    return sendWelcomeScreen(ctx);
});

bot.on("message:text", async (ctx) => {
    const userId = ctx.from.id;
    const stateRes = await db.query("SELECT * FROM users_state WHERE user_id = \$1", [userId]);
    if (stateRes.rows.length === 0) return;

    const userState = stateRes.rows[0].state; 
    const userData = stateRes.rows[0].data;   

    if (userState === "WAITING_CAPTCHA") {
        const parts = userData.split("|");
        const correctWord = parts[0];
        const targetShortId = parts[1];

        if (ctx.message.text.trim().toUpperCase() === correctWord.toUpperCase()) {
            await db.query("DELETE FROM users_state WHERE user_id = \$1", [userId]);
            await ctx.reply("✅ Капча пройдена!\nСлово: " + correctWord);
            await handleFileDelivery(ctx, db, correctWord, targetShortId, userId);
        } else {
            await ctx.reply("❌ Неверное слово. Попробуйте снова ввести: " + correctWord);
        }
        return;
    }

    if (userState.startsWith("WAITING_REVIEW_TEXT_")) {
        const ratingId = userState.replace("WAITING_REVIEW_TEXT_", "");
        const reviewText = ctx.message.text;

        await db.query("UPDATE ratings SET comment = \$1 WHERE id = \$2", [reviewText, ratingId]);
        await db.query("DELETE FROM users_state WHERE user_id = \$1", [userId]);
        await ctx.reply("✅ Спасибо! Ваш отзыв успешно записан.");

        try {
            const currentRating = await db.query("SELECT * FROM ratings WHERE id = \$1", [ratingId]);
            const stars = currentRating.rows[0].stars; 
            const resId = currentRating.rows[0].short_id; 
            
            let reportToAdmin = "💬 **Новый отзыв от пользователя!**\n\n";
            reportToAdmin += "👤 ID: `" + userId + "`\n";
            reportToAdmin += "📁 Ресурс (Код): `" + resId + "`\n";
            reportToAdmin += "⭐ Оценка: " + stars + "/5\n";
            reportToAdmin += "📝 Текст: _" + reviewText + "_";

            await ctx.api.sendMessage(ADMIN_ID, reportToAdmin, { parse_mode: "Markdown" });
        } catch (e) { console.error(e); }
        return;
    }

    if (userId === ADMIN_ID && userState === "BROADCAST_WAIT") {
        await db.query("DELETE FROM users_state WHERE user_id = \$1", [userId]);
        await ctx.reply("🔄 Запускаю рассылку сообщения...");

        const usersRes = await db.query("SELECT DISTINCT user_id FROM users_state UNION SELECT DISTINCT user_id FROM ratings");
        let successCount = 0;

        for (let row of usersRes.rows) {
            try {
                await ctx.api.copyMessage(row.user_id, ADMIN_ID, ctx.message.message_id);
                successCount++;
            } catch (err) {}
        }
        await ctx.reply("📢 Рассылка завершена! Доставлено: " + successCount + " пользователям.");
        return;
    }
});

bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;

    if (data === "clicks_stat" || data === "welcome_click") {
        return ctx.answerCallbackQuery();
    }

    if (data === "check_sub") {
        const isSubbed = await checkSubscription(ctx, userId);
        if (isSubbed) {
            await ctx.answerCallbackQuery("✅ Подписка подтверждена!");
            const pending = await db.query("SELECT * FROM users_state WHERE user_id = \$1 AND state = 'PENDING_SUB'", [userId]);
            if (pending.rows.length > 0) {
                const targetShortId = pending.rows[0].data; 
                await db.query("DELETE FROM users_state WHERE user_id = \$1", [userId]);
                return sendCaptcha(ctx, db, userId, targetShortId);
            }
            return sendWelcomeScreen(ctx);
        } else {
            await ctx.answerCallbackQuery({ text: "❌ Вы не подписались на канал @bloomhold или бот не админ!", show_alert: true });
        }
    }

    if (data === "admin_broadcast" && userId === ADMIN_ID) {
        await db.query("INSERT INTO users_state (user_id, state) VALUES (\$1, 'BROADCAST_WAIT') ON CONFLICT (user_id) DO UPDATE SET state = 'BROADCAST_WAIT'", [userId]);
        await ctx.reply("📥 Отправьте пост, и я перешлю его всем.");
        await ctx.answerCallbackQuery();
    }

    if (data === "admin_list_files" && userId === ADMIN_ID) {
        const filesRes = await db.query("SELECT * FROM resources LIMIT 20");
        let listMsg = "📁 **Список ресурсов:**\n\n";
        filesRes.rows.forEach(f => {
            listMsg += "• `" + f.file_name + "`\nСсылка: `https://t.me" + botUsername + "?start=" + f.short_id + "`\n\n";
        });
        await ctx.reply(listMsg, { parse_mode: "Markdown" });
        await ctx.answerCallbackQuery();
    }

    if (data === "admin_view_reviews" && userId === ADMIN_ID) {
        const reviews = await db.query("SELECT * FROM ratings WHERE comment IS NOT NULL ORDER BY id DESC LIMIT 5");
        let revMsg = "💬 **Последние отзывы:**\n\n";
        reviews.rows.forEach(r => {
            revMsg += "⭐ Оценка: " + r.stars + "/5\n📝: _" + r.comment + "_\n\n";
        });
        await ctx.reply(revMsg, { parse_mode: "Markdown" });
        await ctx.answerCallbackQuery();
    }

    if (data.startsWith("rate_")) {
        const targetShortId = data.replace("rate_", "");
        const starKeyboard = new InlineKeyboard()
            .text("1 ⭐️", "setstar_1_" + targetShortId)
            .text("2 ⭐️", "setstar_2_" + targetShortId)
            .text("3 ⭐️", "setstar_3_" + targetShortId)
            .text("4 ⭐️", "setstar_4_" + targetShortId)
            .text("5 ⭐️", "setstar_5_" + targetShortId);
        await ctx.reply("Выберите оценку ресурса:", { reply_markup: starKeyboard });
        await ctx.answerCallbackQuery();
    }


    if (data.startsWith("setstar_")) {
        const parts = data.split("_");
        const stars = Number(parts[1]);
        const targetShortId = parts[2];

        const insertRes = await db.query("INSERT INTO ratings (user_id, short_id, stars) VALUES (\$1, \$2, \$3) RETURNING id", [userId, targetShortId, stars]);
        const ratingId = insertRes.rows[0].id; 

        await db.query("INSERT INTO users_state (user_id, state) VALUES (\$1, \$2) ON CONFLICT (user_id) DO UPDATE SET state = \$2", [userId, "WAITING_REVIEW_TEXT_" + ratingId]);
        await ctx.reply("Вы поставили " + stars + " звезд(ы)! Напишите краткий отзыв в ответном сообщении:");
        await ctx.answerCallbackQuery();
    }
});

bot.on([":audio", ":document"], async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const fileId = ctx.message.audio ? ctx.message.audio.file_id : ctx.message.document.file_id;
    const fileName = ctx.message.audio ? (ctx.message.audio.title || "audio.mp3") : (ctx.message.document.file_name || "file");
    if (!fileId) return ctx.reply("❌ Ошибка ID файла.");

    const shortId = Math.random().toString(36).substring(2, 8);
    try {
        await db.query("INSERT INTO resources (short_id, file_id, file_name) VALUES (\$1, \$2, \$3)", [shortId, fileId, fileName]);
        await ctx.reply("📦 Файл добавлен!\nСсылка: `https://t.me" + botUsername + "?start=" + shortId + "`", { parse_mode: "Markdown" });
    } catch (e) { await ctx.reply("❌ Ошибка сохранения."); }
});

(async () => {
    try {
        await db.connect();
        await db.query(`CREATE TABLE IF NOT EXISTS resources (short_id VARCHAR(50) PRIMARY KEY, file_id TEXT NOT NULL, file_name TEXT NOT NULL, clicks INTEGER DEFAULT 0)`);
        await db.query(`CREATE TABLE IF NOT EXISTS ratings (id SERIAL PRIMARY KEY, user_id BIGINT NOT NULL, short_id VARCHAR(50) NOT NULL, stars INTEGER NOT NULL, comment TEXT)`);
        await db.query(`CREATE TABLE IF NOT EXISTS users_state (user_id BIGINT PRIMARY KEY, state TEXT NOT NULL, data TEXT)`);
        
        const botInfo = await bot.api.getMe();
        botUsername = botInfo.username;
        console.log("🤖 Модульный бот @" + botUsername + " запущен!");
        bot.start();
    } catch (e) { console.error(e); }
})();

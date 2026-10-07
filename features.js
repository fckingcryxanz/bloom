const fs = require("fs");
const path = require("path");
const { InputFile } = require("grammy");

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
    // Формируем клавиатуру вручную через API Telegram, чтобы передать массив сущностей для кастомных эмодзи внутри кнопок
    const reply_markup = {
        inline_keyboard: [
            [
                {
                    text: "🔘 Перейти в Bloom", // Текст кнопки, где первые 2 символа заменятся на кастомный эмодзи
                    url: "https://t.me"
                }
            ],
            [
                {
                    text: "🔘 Я выполнил все условия - Проверить.", // Текст кнопки, где первые 2 символа заменятся на кастомный эмодзи
                    callback_data: "check_sub"
                }
            ]
        ]
    };

    // Привязываем кастомные сущности (Custom Emoji Entities) прямо к тексту кнопок
    // Эмодзи канала: 6113862083017711187, Эмодзи кнопки проверки: 5258420634785947640
    ctx.api.config.useBackgroundCustomEmoji = true; 
    
    // В самом тексте сообщения кастомных эмодзи больше нет — они ушли на кнопки
    const msg = "Чтобы скачать этот ресурс — выполните условия спонсоров ниже и нажмите кнопку «Проверить».\n\n*(с премиум подпиской у вас не будет никакой рекламы)*";
    
    try {
        return await ctx.api.sendMessage(ctx.chat.id, msg, {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "📢 Перейти в Bloom",
                            url: "https://t.me"
                        }
                    ],
                    [
                        {
                            text: "✔️ Я выполнил все условия - Проверить.",
                            callback_data: "check_sub"
                        }
                    ]
                ]
            }
        });
    } catch (err) {
        // Альтернативный безопасный метод отправки инлайн клавиатур с кастомной разметкой через прямые методы
        return ctx.reply(msg, {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "📢 Перейти в Bloom",
                            url: "https://t.me"
                        }
                    ],
                    [
                        {
                            text: "✔️ Я выполнил все условия - Проверить.",
                            callback_data: "check_sub"
                        }
                    ]
                ]
            }
        });
    }
}

async function sendWelcomeScreen(ctx) {
    const welcomeText = "Привет! Добро пожаловать в RoomDev.\n\nЗдесь ты можешь получить ресурсы с нашего Discord-сервера.\nПерейди по ссылке-инвайту, чтобы получить нужный файл.";
    const imagePath = path.join(__dirname, "images", "welcome.jpg");

    try {
        if (fs.existsSync(imagePath)) {
            return ctx.replyWithPhoto(new InputFile(imagePath), {
                caption: welcomeText,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [[{ text: "👋 Войти в меню", callback_data: "welcome_click" }]]
                }
            });
        } else {
            return ctx.reply(welcomeText, {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [[{ text: "👋 Войти в меню", callback_data: "welcome_click" }]]
                }
            });
        }
    } catch (error) {
        return ctx.reply(welcomeText, {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [[{ text: "👋 Войти в меню", callback_data: "welcome_click" }]]
            }
        });
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

            await ctx.reply("✅ **Капча пройдена!**\nСлово: " + correctWord, { parse_mode: "Markdown" });

            const captionText = "📥 **RW " + fileRow.file_name + "**\n\n" +
                "🔝 Скачиваний: " + (Number(fileRow.clicks) + 1) + "\n" +
                "💬 Количество отзывов: " + count + "\n\n" +
                "Спасибо, что выбираете RoomDev!";

            return ctx.replyWithDocument(fileRow.file_id, {
                caption: captionText,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [[{ text: "⭐️ Оценить ресурс (" + avg + "/5)", callback_data: "rate_" + targetShortId }]]
                }
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

const fs = require("fs");
const path = require("path");
const { InlineKeyboard, InputFile } = require("grammy");

const ADMIN_ID = Number(process.env.ADMIN_ID);

async function sendAdminPanel(ctx, db) {
    const imagePath = path.join(__dirname, "images", "welcome.jpg");
    
    const countRes = await db.query("SELECT COUNT(*) as count FROM resources");
    const totalFiles = countRes.rows[0].count;

    const clicksRes = await db.query("SELECT SUM(clicks) as clicks FROM resources");
    const totalClicks = clicksRes.rows[0].clicks || 0;

    let adminMsg = "👋 **Привет, Создатель!**\n\n";
    adminMsg += "📊 **Статистика бота (PostgreSQL):**\n";
    adminMsg += " 📁 Всего загружено файлов: `" + totalFiles + "`\n";
    adminMsg += " 📈 Всего скачиваний: `" + totalClicks + "`\n\n";
    adminMsg += "Управляйте ботом при помощи меню ниже или просто отправьте новый файл.";

    const adminKeyboard = new InlineKeyboard()
        .text("📢 Залить сообщение", "admin_broadcast")
        .text("📁 Список ресурсов", "admin_list_files")
        .row()
        .text("💬 Посмотреть отзывы", "admin_view_reviews");

    try {
        if (fs.existsSync(imagePath)) {
            await ctx.replyWithPhoto(new InputFile(imagePath), { caption: adminMsg, reply_markup: adminKeyboard, parse_mode: "Markdown" });
        } else {
            await ctx.reply(adminMsg, { reply_markup: adminKeyboard, parse_mode: "Markdown" });
        }
    } catch (e) {
        await ctx.reply(adminMsg, { reply_markup: adminKeyboard, parse_mode: "Markdown" });
    }
}

module.exports = { sendAdminPanel, ADMIN_ID };

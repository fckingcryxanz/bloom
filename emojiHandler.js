const ADMIN_ID = Number(process.env.ADMIN_ID);

function registerEmojiHandler(bot) {
    bot.on("message:text", async (ctx, next) => {
        if (ctx.from.id !== ADMIN_ID) return next();

        const entities = ctx.message.entities;
        if (entities) {
            const customEmojis = entities.filter(e => e.type === "custom_emoji");
            if (customEmojis.length > 0) {
                let report = "🎯 **Обнаружены ID кастомных эмодзи:**\n\n";
                customEmojis.forEach((emoji, index) => {
                    report += (index + 1) + ". Код: `" + emoji.custom_emoji_id + "`\n";
                });
                await ctx.reply(report, { parse_mode: "Markdown" });
                return; 
            }
        }
        await next();
    });
}

module.exports = { registerEmojiHandler };

const User = require('./models/user');
const BotConfig = require('./models/botConfig');
const sequelize = require('./db');

async function checkBot() {
    try {
        const botUser = await User.findOne({ where: { is_bot: true, role: 'middleman' }});
        if (botUser) {
            console.log(`FOUND BOT: ID=${botUser.id}, Username=${botUser.username}, Role=${botUser.role}, is_bot=${botUser.is_bot}`);
        } else {
            console.log('NO BOT FOUND with is_bot=true and role=middleman');
            const anyBot = await User.findOne({ where: { is_bot: true }});
            if (anyBot) {
                console.log(`FOUND BOT (BUT WRONG ROLE): ID=${anyBot.id}, Username=${anyBot.username}, Role=${anyBot.role}`);
            }
        }

        const config = await BotConfig.findOne();
        console.log('CONFIG:', JSON.stringify(config, null, 2));
        
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkBot();

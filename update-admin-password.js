
require('dotenv').config();
const sequelize = require('./db');
const User = require('./models/user');

async function updateAdminPassword() {
    try {
        console.log('🔄 Connecting to database...');
        await sequelize.authenticate();
        console.log('✅ Connected.');

        const adminUser = await User.findOne({ where: { username: 'Admin' } });

        if (!adminUser) {
            console.error('❌ Admin user NOT found!');
            return;
        }

        console.log('👤 Admin user found.');

        // Update password (User model hooks will hash it automatically)
        adminUser.password = 'Lu4373212';
        await adminUser.save();

        console.log('✅ Admin password successfully updated to: Lu4373212');

    } catch (error) {
        console.error('❌ Error updating password:', error);
    } finally {
        await sequelize.close();
    }
}

updateAdminPassword();

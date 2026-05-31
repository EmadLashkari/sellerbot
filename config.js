require('dotenv').config();

module.exports = {
    accounts: JSON.parse(process.env.ACCOUNTS),
    searchUrl: process.env.SEARCH_URL,
    maxPostsPerAccount: parseInt(process.env.MAX_POSTS_PER_ACCOUNT) || 10,
    delayMs: parseInt(process.env.DELAY_MS) || 3000,
    storageDir: './storage',
};
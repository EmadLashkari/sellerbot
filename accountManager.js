const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config');

class AccountManager {
    constructor() {
        this.accounts = config.accounts;
        this.currentIndex = 0;
        this.accountUsage = new Map();
        this.activeContexts = new Map(); // phone -> persistent context
    }

    async initStorage() {
        await fs.mkdir(config.storageDir, { recursive: true });
    }

    // Get or create a persistent context for this account
    async getContextForAccount(account) {
        if (this.activeContexts.has(account.phone)) {
            return this.activeContexts.get(account.phone);
        }

        const profileDir = path.join(config.storageDir, `profile_${account.phone}`);
        await fs.mkdir(profileDir, { recursive: true });

        const userDataDir = `./profiles/${account.phone}`;
        const context = await chromium.launchPersistentContext(userDataDir, {
            headless: false, // Or true, depending on your scraping needs
            channel: 'chrome',
            // No storageState option needed here!
        });

        this.activeContexts.set(account.phone, context);
        return context;
    }

    // Check if the current context is logged in, if not, perform login
    async ensureLoggedIn(account) {
        const context = await this.getContextForAccount(account);
        const page = await context.newPage();

        try {
            await page.goto('https://divar.ir/my-divar/my-posts', { waitUntil: 'networkidle', timeout: 50000 });


            if (await page.locator('button:has-text("ورود به حساب کاربری")').isVisible()) {
                console.log(`Account ${account.phone} is NOT logged in. Logging in now...`);
                await this.performLogin(context, account);
            } else {
                console.log(`Account ${account.phone} is already logged in.`);
                console.log(await page.locator('button:has-text("ورود به حساب کاربری")').isVisible())
            }
        } catch (err) {
            console.log(`Check failed, trying login for ${account.phone}`);
            await this.performLogin(context, account);
        } finally {
            await page.close();
        }
    }

    async performLogin(context, account) {
        const page = await context.newPage();
        try {
            await page.goto('https://divar.ir/s/mashhad');

            // Click on "ورود" button
            await page.click('button:has-text("دیوار من")');
            await page.click('button:has-text("ورود")');
            await page.waitForSelector('input[type="tel"]');

            // Enter phone number
            await page.fill('input[type="tel"]', account.phone);
            // await page.click('button:has-text("تایید")');

            // Wait for OTP input field
            await page.waitForSelector('input', { timeout: 3000 });

            // Ask user to enter OTP manually (since SMS arrives on the phone)
            console.log(`\nEnter OTP sent to ${account.phone}: `);
            const otp = await new Promise(resolve => process.stdin.once('data', d => resolve(d.toString().trim())));

            await page.fill('input', otp);
            // await page.click('button:has-text("ورود")');

            // Wait for navigation to home page after successful login
            // await page.waitForURL('https://divar.ir/', { timeout: 15000 });

            // Save storage state (cookies + localStorage)
            const statePath = path.join(config.storageDir, `${account.phone}.json`);
            await context.storageState({ path: statePath });


            console.log(`Logged in and saved session for ${account.phone}`);

        } catch (err) {
            console.error(`Login failed for ${account.phone}:`, err);
            throw err;
        } finally {
            await page.close();
        }
    }

    // Get next account with available quota
    async getNextAccount() {
        const startIndex = this.currentIndex;
        for (let i = 0; i < this.accounts.length; i++) {
            const idx = (startIndex + i) % this.accounts.length;
            const acc = this.accounts[idx];
            const used = this.accountUsage.get(acc.phone) || 0;
            if (used < config.maxPostsPerAccount) {
                this.currentIndex = (idx + 1) % this.accounts.length;
                await this.ensureLoggedIn(acc);
                return acc;
            }
        }
        throw new Error('All accounts reached their post limit');
    }

    markAccountUsed(account) {
        const used = this.accountUsage.get(account.phone) || 0;
        this.accountUsage.set(account.phone, used + 1);
    }

    // Optional: close all contexts when done
    async closeAllContexts() {
        for (const context of this.activeContexts.values()) {
            await context.close();
        }
    }
}

module.exports = AccountManager;

// const { chromium } = require('playwright');
// const fs = require('fs').promises;
// const path = require('path');
// const config = require('./config');

// class AccountManager {
//     constructor() {
//         this.accounts = config.accounts;
//         this.currentIndex = 0;
//         this.accountUsage = new Map(); // account -> posts extracted
//     }

//     async initStorage() {
//         await fs.mkdir(config.storageDir, { recursive: true });
//     }

//     // First time login: enter phone, then ask for OTP, then save storage state
//     async loginAndSaveState(account) {
//         const browser = await chromium.launch({ headless: false, channel: "chrome" }); // headless=false to avoid detection
//         const context = await browser.newContext({

//             viewport: { width: 1280, height: 720 },
//         });
//         const page = await context.newPage();

//         await page.goto('https://divar.ir/s/mashhad');

//         // Click on "ورود" button
//         await page.click('button:has-text("دیوار من")');
//         await page.click('button:has-text("ورود")');
//         await page.waitForSelector('input[type="tel"]');

//         // Enter phone number
//         await page.fill('input[type="tel"]', account.phone);
//         // await page.click('button:has-text("تایید")');

//         // Wait for OTP input field
//         await page.waitForSelector('input', { timeout: 3000 });

//         // Ask user to enter OTP manually (since SMS arrives on the phone)
//         console.log(`\nEnter OTP sent to ${account.phone}: `);
//         const otp = await new Promise(resolve => process.stdin.once('data', d => resolve(d.toString().trim())));

//         await page.fill('input', otp);
//         // await page.click('button:has-text("ورود")');

//         // Wait for navigation to home page after successful login
//         // await page.waitForURL('https://divar.ir/', { timeout: 15000 });

//         // Save storage state (cookies + localStorage)
//         const statePath = path.join(config.storageDir, `${account.phone}.json`);
//         await context.storageState({ path: statePath });

//         await browser.close();
//         console.log(`Logged in and saved session for ${account.phone}`);
//     }

//     async ensureLoggedIn(account) {
//         const statePath = path.join(config.storageDir, `${account.phone}.json`);
//         try {
//             await fs.access(statePath);
//             return true;
//         } catch {
//             await this.loginAndSaveState(account);
//             return true;
//         }
//     }

//     // Get next account that still has available posts quota
//     async getNextAccount() {
//         const startIndex = this.currentIndex;
//         for (let i = 0; i < this.accounts.length; i++) {
//             const idx = (startIndex + i) % this.accounts.length;
//             const acc = this.accounts[idx];
//             const used = this.accountUsage.get(acc.phone) || 0;
//             if (used < config.maxPostsPerAccount) {
//                 this.currentIndex = (idx + 1) % this.accounts.length;
//                 await this.ensureLoggedIn(acc);
//                 return acc;
//             }
//         }
//         throw new Error('All accounts reached their post limit');
//     }

//     markAccountUsed(account) {
//         const used = this.accountUsage.get(account.phone) || 0;
//         this.accountUsage.set(account.phone, used + 1);
//     }

//     async getPersistentContext(account) {
//         const profileDir = path.join(config.storageDir, `profile_${account.phone}`);
//         // Ensure profile exists
//         await fs.mkdir(profileDir, { recursive: true });
//         const context = await chromium.launchPersistentContext(profileDir, {
//             headless: false,
//             channel: 'chrome',
//             // No need for storageState - everything persists automatically
//         });
//         return context;
//     }
// }

// module.exports = AccountManager;
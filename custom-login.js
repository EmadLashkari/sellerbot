const { chromium } = require('playwright');

(async () => {
    // Define a unique profile path for each account
    console.log(`\nEnter phone number for account: `);
    const phonenumberforaccount = await new Promise(resolve => process.stdin.once('data', d => resolve(d.toString().trim())));
    const userDataDir = `./profiles/${phonenumberforaccount}`;

    // Launch a persistent context in a VISIBLE browser
    const browserContext = await chromium.launchPersistentContext(userDataDir, {
        headless: false, // MUST be false for manual login
        channel: 'chrome', // Use your installed Chrome
    });

    const page = await browserContext.newPage();
    await page.goto('https://divar.ir');

    console.log("👉 Please log in manually in the browser window that opened.");
    console.log("👉 Solve any CAPTCHAs and complete 2FA.");
    console.log("👉 Once you are successfully logged in, press ENTER in this terminal.");

    // Wait for user input before closing the browser
    await new Promise(resolve => process.stdin.once('data', resolve));

    // Close the browser. The session data is now saved to './profiles/account_1'
    await browserContext.close();
    console.log("✅ Session saved! You can now run your scraper.");
})();
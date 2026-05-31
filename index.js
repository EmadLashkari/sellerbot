// #!/usr/bin/env node

const AccountManager = require('./accountManager');
const DivarScraper = require('./scraper');
const ExcelWriter = require('./excelWriter');
const config = require('./config');
const EfficientScraper = require('./efficientScraper')

async function main() {
    const accountManager = new AccountManager();
    await accountManager.initStorage();

    const scraper = new DivarScraper(accountManager);
    console.log(`Starting scrape of: ${config.searchUrl}`);
    const results = await scraper.scrapeSearchUrl(config.searchUrl);

    // if (results.length) {
    //     await ExcelWriter.writeToFile(results);
    // } else {
    //     console.log('No phone numbers found.');
    // }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});


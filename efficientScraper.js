// scraper.js
const { chromium } = require('playwright');
const fs = require('fs').promises;
const ExcelJS = require('exceljs');
const config = require('./config');

class EfficientScraper {
    constructor(accountManager) {
        this.accountManager = accountManager;
        this.allPostUrls = [];
        this.results = [];
        this.processedUrls = new Set();
        this.stateFile = 'scraper_state.json';
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async randomDelay(minMs, maxMs) {
        const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
        await this.delay(delay);
    }

    async scrollToLoadAllPosts(page) {
        let previousPostCount = 0;
        let noNewPostsCount = 0;
        const maxNoNewAttempts = 3;

        while (noNewPostsCount < maxNoNewAttempts) {
            const currentLinks = await page.locator('a[href*="/v/"]').all();
            const currentCount = currentLinks.length;

            if (currentCount === previousPostCount) {
                noNewPostsCount++;
            } else {
                noNewPostsCount = 0;
                previousPostCount = currentCount;
            }

            await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
            await this.delay(config.delayMs);

            await page.waitForFunction(
                (prevCount) => document.querySelectorAll('a[href*="/v/"]').length > prevCount,
                previousPostCount,
                { timeout: 5000 }
            ).catch(() => { });
        }
        console.log(`Loaded ${previousPostCount} posts total.`);
    }

    async getAllPostUrls(page) {
        const postLinks = await page.locator('a[href*="/v/"]').evaluateAll(elements =>
            elements
                .map(el => el.href)
                .filter(href => href && href.includes('/v/') && !href.includes('?search'))
        );
        return [...new Set(postLinks)];
    }

    async getPhoneFromPost(page, postUrl) {
        await page.goto(postUrl, { waitUntil: 'networkidle' });
        await this.randomDelay(1000, 2000);

        const showBtn = page.locator('span:has-text("اطلاعات تماس")');
        if (await showBtn.count() === 0) return null;

        await showBtn.click();
        await this.randomDelay(500, 1000);

        try {
            await page.waitForSelector('a[href*="tel:"]', { timeout: 3000 });
            const phone = await page.locator('a[href*="tel:"]').textContent();
            return phone?.trim();
        } catch {
            return null;
        }
    }

    async loadState() {
        try {
            const data = await fs.readFile(this.stateFile, 'utf8');
            const state = JSON.parse(data);
            this.allPostUrls = state.allPostUrls || [];
            this.results = state.results || [];
            this.processedUrls = new Set(state.processedUrls || []);
            console.log(`📂 Loaded previous state:`);
            console.log(`   - Total URLs: ${this.allPostUrls.length}`);
            console.log(`   - Already processed: ${this.processedUrls.size}`);
            console.log(`   - Numbers found: ${this.results.length}`);
            return true;
        } catch (err) {
            console.log(`📂 No previous state found`);
            return false;
        }
    }

    async saveState() {
        const state = {
            allPostUrls: this.allPostUrls,
            results: this.results,
            processedUrls: Array.from(this.processedUrls),
            lastUpdated: new Date().toISOString()
        };
        await fs.writeFile(this.stateFile, JSON.stringify(state, null, 2));
    }

    async extractAllPostUrlsOnce(searchUrl) {
        if (this.allPostUrls.length > 0) {
            console.log(`\n📚 Using existing ${this.allPostUrls.length} URLs from previous run`);
            return;
        }

        console.log(`\n🔍 Extracting all post URLs from ${searchUrl}...`);

        const browser = await chromium.launch({ headless: false, channel: 'chrome' });
        const page = await browser.newPage();

        await page.goto(searchUrl, { waitUntil: 'networkidle' });
        await this.scrollToLoadAllPosts(page);
        this.allPostUrls = await this.getAllPostUrls(page);

        await browser.close();

        console.log(`✅ Extracted ${this.allPostUrls.length} unique URLs`);
        await this.saveState();
    }

    async processUrlsWithSmartRotation() {
        console.log(`\n🚀 Processing ${this.allPostUrls.length} URLs...`);
        console.log(`📊 Already processed: ${this.processedUrls.size}`);

        const remainingUrls = this.allPostUrls.filter(url => !this.processedUrls.has(url));
        console.log(`📋 Remaining to process: ${remainingUrls.length}`);

        if (remainingUrls.length === 0) {
            console.log(`✅ All URLs already processed!`);
            return;
        }

        let currentAccount = null;
        let currentContext = null;
        let currentPage = null;
        let processedWithCurrentAccount = 0;

        for (let i = 0; i < remainingUrls.length; i++) {
            const url = remainingUrls[i];
            const globalIndex = this.allPostUrls.findIndex(u => u === url) + 1;

            if (!currentAccount || processedWithCurrentAccount >= config.maxPostsPerAccount) {
                if (currentPage) await currentPage.close();
                if (currentContext) await currentContext.close();

                currentAccount = await this.accountManager.getNextAccount();
                currentContext = await this.accountManager.getContextForAccount(currentAccount);
                currentPage = await currentContext.newPage();
                processedWithCurrentAccount = 0;

                console.log(`\n${'='.repeat(60)}`);
                console.log(`🔄 Using account: ${currentAccount.phone}`);
                console.log(`📊 Progress: ${this.processedUrls.size}/${this.allPostUrls.length} (${Math.round(this.processedUrls.size / this.allPostUrls.length * 100)}%)`);
                console.log(`${'='.repeat(60)}`);
            }

            console.log(`\n[${globalIndex}/${this.allPostUrls.length}] Processing with ${currentAccount.phone}...`);

            try {
                const phone = await this.getPhoneFromPost(currentPage, url);

                if (phone) {
                    this.results.push({
                        url,
                        phone,
                        account: currentAccount.phone,
                        extractedAt: new Date().toISOString()
                    });
                    console.log(`✅ PHONE FOUND: ${phone}`);
                } else {
                    console.log(`❌ No phone number available`);
                }

                this.processedUrls.add(url);
                processedWithCurrentAccount++;
                await this.saveState();

                if (this.results.length % 3 === 0) {
                    await this.saveToExcel();
                }

                await this.randomDelay(2000, 5000);

            } catch (err) {
                console.error(`❌ Error: ${err.message}`);
                await this.delay(5000);
            }
        }

        if (currentPage) await currentPage.close();
        if (currentContext) await currentContext.close();

        console.log(`\n🎉 Processing complete!`);
        console.log(`   - Total URLs: ${this.allPostUrls.length}`);
        console.log(`   - Processed: ${this.processedUrls.size}`);
        console.log(`   - Numbers found: ${this.results.length}`);
    }

    async saveToExcel() {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Phone Numbers');

        worksheet.columns = [
            { header: '#', key: 'index', width: 8 },
            { header: 'Phone Number', key: 'phone', width: 20 },
            { header: 'Account Used', key: 'account', width: 15 },
            { header: 'Extracted At', key: 'extractedAt', width: 25 },
            { header: 'Post URL', key: 'url', width: 60 }
        ];

        this.results.forEach((row, idx) => {
            worksheet.addRow({
                index: idx + 1,
                phone: row.phone,
                account: row.account,
                extractedAt: row.extractedAt,
                url: row.url
            });
        });

        await workbook.xlsx.writeFile('results.xlsx');
        console.log(`💾 Excel file updated with ${this.results.length} numbers`);
    }

    async scrape(searchUrl) {
        await this.loadState();
        await this.extractAllPostUrlsOnce(searchUrl);
        await this.processUrlsWithSmartRotation();
        await this.saveToExcel();
        return this.results;
    }
}

module.exports = EfficientScraper;
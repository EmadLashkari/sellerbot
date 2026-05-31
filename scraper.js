const config = require('./config');
const ExcelWriter = require('./excelWriter');
const fs = require('fs').promises;


class DivarScraper {
    constructor(accountManager) {
        this.accountManager = accountManager;
        this.processedUrls = new Set()
        this.processedFile = './proccess_url.json'
        this.loadProcessedUrls()
    }

    async loadProcessedUrls() {
        try {
            const data = await fs.readFile(this.processedFile, 'utf8');
            const urls = JSON.parse(data);
            this.processedUrls = new Set(urls);
            console.log(`📂 Loaded ${this.processedUrls.size} previously processed URLs`);
        } catch (err) {
            console.log('No previous record found, starting fresh...');
            this.processedUrls = new Set();
        }
    }

    async saveProcessedUrls() {
        const urlsArray = Array.from(this.processedUrls);
        await fs.writeFile(this.processedFile, JSON.stringify(urlsArray, null, 2));
        console.log(`💾 Saved ${urlsArray.length} processed URLs to disk`);
    }

    async markAsProcessed(url) {
        this.processedUrls.add(url);
        // Save after every 10 URLs to avoid too many writes
        if (this.processedUrls.size % 5 === 0) {
            await this.saveProcessedUrls();
        }
    }

    isProcessed(url) {
        return this.processedUrls.has(url);
    }

    async randomDelay(minMs = 1000, maxMs = 3000) {
        const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
        return await new Promise(resolve => setTimeout(resolve, delay));;
    }

    async handleChallengeIfPresent(page) {
        const challengeSelectors = [
            'text=/برای دیدن اطلاعات آگهی‌گذار، چالش زیر را حل کنید/',
            'iframe[src*="challenges.cloudflare.com"]',
            'div[id*="cf-turnstile"]',
            'text=/تعداد درخواست‌های شما بیش از حد مجاز است/'
        ];

        for (const selector of challengeSelectors) {
            // استفاده از count به جای isVisible برای بازدهی سریع‌تر در آی‌فریم‌ها
            const count = await page.locator(selector).count().catch(() => 0);

            if (count > 0) {
                console.log('\n🚨 [Cloudflare] CHALLENGE DETECTED!');
                console.log('👉 Please solve the Cloudflare Turnstile manually in the browser window.');
                console.log('👉 After the modal closes and the phone number appears, press ENTER to continue...');

                // بوق زدن سیستم (اختیاری - برای اینکه متوجه شوید اسکریپت منتظر شماست)
                process.stdout.write('\x07');

                // توقف اسکریپت و انتظار برای اینتر کاربر
                await new Promise(resolve => process.stdin.once('data', resolve));

                console.log('✅ Continuing execution...\n');
                return true; // چالش پیدا و مدیریت شد
            }
        }
        return false; // صفحه عادی است
    }

    async getPhoneFromPost(page, postUrl) {
        await page.goto(postUrl, { waitUntil: 'networkidle' });

        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');

        await this.randomDelay(10000, 20000);
        await this.handleChallengeIfPresent(page);
        const showBtn = page.locator('span:has-text("اطلاعات تماس")');

        // if (page.locator('span:has-text("برای دیدن اطلاعات آگهی‌گذار، چالش زیر را حل کنید")').isVisible()) {
        //     console.log("this is visible");
        //     await this.randomDelay(50000, 51000)
        //     page.waitForSelector('span:has-text("برای دیدن اطلاعات آگهی‌گذار، چالش زیر را حل کنید")', { timeout: 100000 })
        // }

        if (await showBtn.count() === 0) return null;

        await showBtn.click();

        await page.waitForTimeout(1500);
        const isChallengeHandled = await this.handleChallengeIfPresent(page);

        if (isChallengeHandled) {
            console.log("🔄 Re-checking phone element after challenge resolution...");
        }

        // Wait only 1 second for the phone number element.
        // If it doesn't appear, assume number is hidden and skip.
        try {
            await page.waitForSelector('a[href*="tel:"]', { timeout: 1000 });
            const phone = await page.locator('a[href*="tel:"]').textContent();
            return phone?.trim();
        } catch {
            // Phone number not revealed (hidden by seller)
            await this.handleChallengeIfPresent(page);
            return null;
        }
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
            await page.waitForTimeout(config.delayMs);

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

    async scrapeSearchUrl(searchUrl) {
        const results = [];


        console.log('🔄 Step 1: Initializing browser to collect ALL post URLs...');
        // ۱. ابتدا با یک اکانت یا یک صفحه موقت تمام لینک‌های صفحه سرچ را جمع‌آوری می‌کنیم
        const initialAccount = await this.accountManager.getNextAccount();
        const initialContext = await this.accountManager.getContextForAccount(initialAccount);
        const initialPage = await initialContext.newPage();

        await initialPage.goto(searchUrl, { waitUntil: 'networkidle' });
        await this.scrollToLoadAllPosts(initialPage);
        const allPostUrls = await this.getAllPostUrls(initialPage);
        await initialPage.close();

        console.log(`📂 Total unique posts found in search: ${allPostUrls.length}`);

        // ۲. حالا آرایه لینک‌ها را به یک "صف" (Queue) تبدیل می‌کنیم
        let urlQueue = allPostUrls.filter(url => !this.isProcessed(url));
        console.log(`📥 Posts left to process after filtering duplicates: ${urlQueue.length}`);

        // ۳. ورود به حلقه اکانت‌ها برای پردازش صف لینک‌ها
        while (urlQueue.length > 0) {
            try {
                const account = await this.accountManager.getNextAccount();
                console.log(`\n👤 Using account: ${account.phone}`);

                const context = await this.accountManager.getContextForAccount(account);
                const page = await context.newPage();

                let extractedForThisAccount = 0;

                // تا زمانی که این اکانت سهمیه دارد و صفی از لینک‌ها وجود دارد، ادامه بده
                while (urlQueue.length > 0 && extractedForThisAccount < config.maxPostsPerAccount) {
                    // بیرون کشیدن اولین لینک از ابتدای صف (با این کار لینک از آرایه حذف می‌شود)
                    const url = urlQueue.shift();

                    const phone = await this.getPhoneFromPost(page, url);
                    if (phone) {
                        results.push({ url, phone });
                        await this.markAsProcessed(url);

                        // چون دیتای ورودی اکسل شما طبق سوال قبل فقط شماره است:

                        await ExcelWriter.writeToFile(phone);

                        console.log(`[${account.phone}] Extracted: ${phone}`);
                    } else {
                        // اگر شماره‌ای پیدا نشد (یا هیدن بود)، باز هم آن را پردازش شده علامت می‌زنیم تا تکرار نشود
                        await this.markAsProcessed(url);
                    }

                    extractedForThisAccount++;
                    this.accountManager.markAccountUsed(account);
                    await page.waitForTimeout(config.delayMs);
                }

                await page.close();

                // بررسی اینکه آیا اکانت معتبر دیگری باقی مانده است یا خیر
                let hasMoreAccounts = false;
                for (const acc of this.accountManager.accounts) {
                    const used = this.accountManager.accountUsage.get(acc.phone) || 0;
                    if (used < config.maxPostsPerAccount) {
                        hasMoreAccounts = true;
                        break;
                    }
                }

                if (!hasMoreAccounts && urlQueue.length > 0) {
                    console.log('🚨 No more accounts with available quota, but some URLs are still in queue.');
                    break;
                }

            } catch (err) {
                console.error('Scraping error inside account loop:', err);
                await new Promise(r => setTimeout(r, 10000));
            }
        }

        return results;
    }
}

module.exports = DivarScraper;

// const { chromium } = require('playwright');
// const config = require('./config');

// class DivarScraper {
//     constructor(accountManager) {
//         this.accountManager = accountManager;
//     }

//     // Extract phone number from a single post page
//     async getPhoneFromPost(page, postUrl) {
//         await page.goto(postUrl, { waitUntil: 'networkidle' });
//         const showBtn = page.locator('span:has-text("اطلاعات تماس")');
//         if (await showBtn.count() === 0) return null;
//         await showBtn.click();
//         await page.waitForSelector('a[href*="tel:"]', { timeout: 5000 });
//         const phone = await page.locator('a[href*="tel:"]').textContent();
//         return phone?.trim();
//     }

//     // Scroll the search results page until no new posts load
//     async scrollToLoadAllPosts(page) {
//         let previousPostCount = 0;
//         let noNewPostsCount = 0;
//         const maxNoNewAttempts = 3; // stop if no new posts after 3 scrolls

//         while (noNewPostsCount < maxNoNewAttempts) {
//             // Get current post links count
//             const currentLinks = await page.locator('a[href*="/v/"]').all();
//             const currentCount = currentLinks.length;

//             if (currentCount === previousPostCount) {
//                 noNewPostsCount++;
//             } else {
//                 noNewPostsCount = 0;
//                 previousPostCount = currentCount;
//             }

//             // Scroll down
//             await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
//             await page.waitForTimeout(config.delayMs);

//             // Wait for any new content to load
//             await page.waitForFunction(
//                 (prevCount) => document.querySelectorAll('a[href*="/v/"]').length > prevCount,
//                 previousPostCount,
//                 { timeout: 5000 }
//             ).catch(() => { }); // ignore timeout if no new posts
//         }

//         console.log(`Finished scrolling. Total posts loaded: ${previousPostCount}`);
//     }

//     // Extract all unique post URLs from the fully loaded search page
//     async getAllPostUrls(page) {
//         const postLinks = await page.locator('a[href*="/v/"]').evaluateAll(elements =>
//             elements
//                 .map(el => el.href)
//                 .filter(href => href && href.includes('/v/') && !href.includes('?search'))
//         );
//         return [...new Set(postLinks)];
//     }

//     // Main scraping logic
//     async scrapeSearchUrl(searchUrl) {
//         const results = [];

//         while (true) {
//             try {
//                 const account = await this.accountManager.getNextAccount();
//                 console.log(`\nUsing account: ${account.phone}`);

//                 const browser = await chromium.launch({ headless: false, channel: "chrome" });
//                 const context = await this.accountManager.getPersistentContext(account);
//                 const page = await context.newPage();

//                 await page.goto(searchUrl, { waitUntil: 'networkidle' });

//                 // 1. Scroll infinitely to load all posts
//                 await this.scrollToLoadAllPosts(page);

//                 // 2. Collect all unique post URLs
//                 const allPostUrls = await this.getAllPostUrls(page);
//                 console.log(`Found ${allPostUrls.length} unique posts.`);

//                 // 3. Process each post URL one by one
//                 let extractedForThisAccount = 0;
//                 for (const url of allPostUrls) {
//                     if (extractedForThisAccount >= config.maxPostsPerAccount) {
//                         console.log(`Account limit reached (${config.maxPostsPerAccount}), switching account.`);
//                         break;
//                     }

//                     const phone = await this.getPhoneFromPost(page, url);
//                     if (phone) {
//                         results.push({ url, phone });
//                         console.log(`[${account.phone}] Extracted: ${phone}`);
//                     }

//                     extractedForThisAccount++;
//                     this.accountManager.markAccountUsed(account);
//                     await page.waitForTimeout(config.delayMs);
//                 }

//                 await browser.close();

//                 // Optional: if you want to continue scraping more posts beyond the first batch
//                 // you would need to implement pagination or next page logic.
//                 // For now we stop after processing all links from the first search page.
//                 break;

//             } catch (err) {
//                 console.error('Scraping error:', err);
//                 await new Promise(r => setTimeout(r, 10000));
//             }
//         }
//         return results;
//     }
// }

// module.exports = DivarScraper;
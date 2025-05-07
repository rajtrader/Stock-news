const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

puppeteer.use(StealthPlugin());

const linksFilePath = path.join(__dirname, 'links.csv');
const outputDir = path.join(__dirname, 'scraped_data');

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
}

// Function to read links from CSV
function getLinksFromCSV(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            console.error(`Error: Links file not found at "${filePath}"`);
            return [];
        }
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const requiredBasePath = 'https://simplywall.st/stocks/in/';

        return fileContent
            .split(/\r?\n/)
            .slice(1) // Skip header row
            .map(line => {
                const parts = line.match(/(?:[^\s",]+|"[^"]*")+/g);
                if (parts && parts.length >= 2) {
                    const symbol = parts[0].replace(/"/g, '').trim();
                    let link = parts[1].replace(/"/g, '').trim();

                    if (link && link !== 'Not Found' && link.startsWith(requiredBasePath)) {
                        link = link.replace(/\/information$/, '')
                                   .replace(/\/news.*$/, '')
                                   .replace(/\/management$/, '')
                                   .replace(/\/health$/, '')
                                   .replace(/\/valuation$/, '')
                                   .replace(/\/future$/, '')
                                   .replace(/\/past$/, '')
                                   .replace(/\/dividend$/, '')
                                   .replace(/\/ownership$/, '');

                        return { symbol, link };
                    }
                }
                return null;
            })
            .filter(item => item !== null);
    } catch (error) {
        console.error(`Error reading links file "${filePath}": ${error.message}`);
        return [];
    }
}

// Function to send data to WordPress API
async function sendToWordPress(scrapedData, symbol, link) {
    const apiUrl = 'https://profitbooking.in/wp-json/scraper/v1/simplywallst_data';
    
    const postData = {
        title: `${symbol} - Simply Wall St Analysis`,
        content: `
            <h2>Risk/Reward Analysis</h2>
            ${scrapedData.riskReward}
            <br/>
            <h2>Snowflake Score</h2>
            ${scrapedData.snowflakeTable}
            <hr/>
            <p><em>Source: <a href="${link}" target="_blank" rel="noopener noreferrer">${link}</a></em></p>
        `,
        symbol: symbol,
        simplywallst_link: link,
        risk_reward: scrapedData.riskReward,
        snowflake_data: scrapedData.snowflakeTable,
        status: 'publish'
    };

    try {
        console.log(`Sending data for ${symbol} to WordPress...`);
        const response = await axios.post(apiUrl, postData);
        
        if (response.data && response.data.success) {
            console.log(`Successfully sent data for ${symbol}. Response: ${response.data.message || 'Success'}`);
            return response.data.post_id || true;
        } else {
            console.warn(`API response for ${symbol} indicates potential issue: ${JSON.stringify(response.data)}`);
            return null;
        }
    } catch (error) {
        console.error(`Error sending data for ${symbol}:`, error.message);
        if (error.response?.data) {
            console.error('API Error Details:', error.response.data);
        }
        return null;
    }
}

async function scrapeData() {
    const linksToScrape = getLinksFromCSV(linksFilePath);
    if (linksToScrape.length === 0) {
        console.log('No valid links found in links.csv. Exiting.');
        return;
    }

    let browser;
    console.log(`Found ${linksToScrape.length} links. Starting browser...`);

    try {
        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            args: [
                '--start-maximized',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--window-size=1920,1080',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-extensions'
            ],
            ignoreHTTPSErrors: true
        });

        const page = await browser.newPage();
        
        // Set a more realistic viewport
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Set a more realistic user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Set extra headers
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        });

        // Enable request interception
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            if (request.resourceType() === 'image' || request.resourceType() === 'stylesheet' || request.resourceType() === 'font') {
                request.abort();
            } else {
                request.continue();
            }
        });

        // Direct login process with retry
        console.log('Attempting direct login...');
        let loginSuccess = false;
        let retryCount = 0;
        const maxRetries = 3;

        while (!loginSuccess && retryCount < maxRetries) {
            try {
                await page.goto('https://simplywall.st/stocks/in/materials/nse-20microns/20-microns-shares', {
                    waitUntil: 'networkidle0',
                    timeout: 60000
                });

                // Click Login/Sign Up button
                await page.waitForSelector('button[data-cy-id="login-signup"]', { timeout: 10000 });
                await page.click('button[data-cy-id="login-signup"]');

                // Click Sign in link
                await page.waitForFunction(() => 
                    Array.from(document.querySelectorAll('button, a')).some(el => 
                        el.textContent.trim().toLowerCase() === 'sign in'
                    ), 
                    { timeout: 10000 }
                );
                await page.evaluate(() => {
                    const signIn = Array.from(document.querySelectorAll('button, a')).find(el => 
                        el.textContent.trim().toLowerCase() === 'sign in'
                    );
                    if (signIn) signIn.click();
                });

                // Enter credentials and submit
                await page.waitForSelector('input[data-cy-id="username"]', { timeout: 10000 });
                const email = 'tekpai.121@gmail.com';
                const password = 'tekpai@129025';
                
                await page.type('input[data-cy-id="username"]', email);
                await page.type('input[data-cy-id="password"]', password);
                await page.click('button[data-cy-id="button-submit-login"]');
                
                // Wait for login to complete
                await page.waitForTimeout(5000);
                
                // Verify login success
                const isLoggedIn = await page.evaluate(() => {
                    return !document.querySelector('button[data-cy-id="login-signup"]');
                });

                if (isLoggedIn) {
                    console.log('Login successful. Proceeding with data scraping...');
                    loginSuccess = true;
                } else {
                    throw new Error('Login verification failed');
                }

            } catch (error) {
                retryCount++;
                console.log(`Login attempt ${retryCount} failed: ${error.message}`);
                if (retryCount < maxRetries) {
                    console.log('Retrying login...');
                    await page.waitForTimeout(5000 * retryCount);
                } else {
                    throw new Error(`Failed to login after ${maxRetries} attempts`);
                }
            }
        }

        // Process each company
        for (let i = 0; i < linksToScrape.length; i++) {
            const { symbol, link } = linksToScrape[i];
            console.log(`\n(${i + 1}/${linksToScrape.length}) Processing: ${symbol} - ${link}`);

            try {
                await page.goto(link, {
                    waitUntil: 'networkidle0',
                    timeout: 60000
                });

                // Scrape Risk/Reward Data
                let riskRewardData = '';
                try {
                    await page.waitForSelector('div[data-cy-id="risk-reward-wrapper"]', { timeout: 25000 });
                    riskRewardData = await page.evaluate(() => {
                        const wrapper = document.querySelector('div[data-cy-id="risk-reward-wrapper"]');
                        if (!wrapper) return 'Risk/Reward section not found';
                        let text = '';
                        wrapper.childNodes.forEach(node => {
                            if (node.nodeName === 'H3') {
                                text += `\n${node.innerText.trim()}\n`;
                            } else if (node.nodeName === 'BLOCKQUOTE') {
                                const p = node.querySelector('p');
                                if (p) {
                                    text += `- ${p.innerText.trim()}\n`;
                                }
                            }
                        });
                        return text.trim();
                    });
                } catch (error) {
                    riskRewardData = `Error scraping Risk/Reward: ${error.message}`;
                }

                // Scrape Snowflake Table
                let snowflakeData = '';
                try {
                    await page.waitForSelector('button[data-cy-id="chart-action-toggle-data-overview-summary-snowflake"]', { timeout: 15000 });
                    await page.click('button[data-cy-id="chart-action-toggle-data-overview-summary-snowflake"]');
                    await page.waitForSelector('table[data-cy-id="overview-snowflake-table"]', { timeout: 15000 });

                    snowflakeData = await page.evaluate(() => {
                        const table = document.querySelector('table[data-cy-id="overview-snowflake-table"]');
                        if (!table) return 'Snowflake table not found';
                        return table.innerText;
                    });

                    await page.click('button[data-cy-id="chart-action-toggle-data-overview-summary-snowflake"]');
                } catch (error) {
                    snowflakeData = `Error scraping Snowflake table: ${error.message}`;
                }

                // Save data to file
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const outputFile = path.join(outputDir, `${symbol}_${timestamp}.txt`);
                
                const outputContent = `
Stock Analysis Data
==================
Symbol: ${symbol}
Timestamp: ${new Date().toISOString()}
URL: ${link}

Risk/Reward Analysis
-------------------
${riskRewardData}

Snowflake Score
--------------
${snowflakeData}
`;

                fs.writeFileSync(outputFile, outputContent, 'utf8');
                console.log(`Data saved to: ${outputFile}`);

                // Send data to WordPress API
                const scrapedData = {
                    riskReward: riskRewardData,
                    snowflakeTable: snowflakeData
                };

                if (scrapedData.riskReward && scrapedData.snowflakeTable) {
                    const result = await sendToWordPress(scrapedData, symbol, link);
                    if (result) {
                        console.log(`Successfully processed ${symbol}`);
                    } else {
                        console.warn(`Failed to send data for ${symbol}`);
                    }
                } else {
                    console.warn(`No data scraped for ${symbol}. Skipping API submission.`);
                }

                // Short delay between requests
                await page.waitForTimeout(1000);

            } catch (error) {
                console.error(`Error processing ${symbol}: ${error.message}`);
            }
        }

    } catch (error) {
        console.error('A critical error occurred:', error);
    } finally {
        if (browser) {
            await browser.close();
            console.log('Browser closed.');
        }
    }
}

// Run the scraping function
scrapeData();

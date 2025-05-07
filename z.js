const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path'); // Required for path handling
const axios = require('axios'); // <-- Require axios

puppeteer.use(StealthPlugin());

const linksFilePath = path.join(__dirname, 'links.csv');
const logFilePath = path.join(__dirname, 'scraped_data_log.txt'); // New log file path
// const outputFilePath = path.join(__dirname, 'all_scraped_data.txt'); // Comment out or remove if only using WP

// --- WordPress Configuration (!!! IMPORTANT: Fill these in !!!) ---
const WP_CONFIG = {
    apiUrl: 'https://profitbooking.in/wp-json/scraper/v1/simplywallst_data', // Example: https://yourdomain.com/wp-json/wp/v2/posts
    // Authentication: Use Application Passwords (recommended) or other methods
    // Example using Application Password:
    
    // Or uncomment below for Basic Auth (less secure, needs .htaccess config sometimes)
    // auth: {
    //     username: 'YOUR_WP_USERNAME',
    //     password: 'YOUR_WP_PASSWORD'
    // },
    // If using JWT or other token methods, adjust axios headers accordingly
    // headers: { 'Authorization': 'Bearer YOUR_JWT_TOKEN' }

    // Optional: Define custom fields if you set them up in WordPress
    // customFieldSlugs: {
    //     symbol: 'stock_symbol',
    //     link: 'simplywallst_link',
    //     riskReward: 'risk_reward_analysis',
    //     snowflakeTable: 'snowflake_score_table'
    // }
};
// --------------------------------------------------------------------

// Function to log data to file
function logToFile(data) {
    const timestamp = new Date().toISOString();
    const logEntry = `\n\n[${timestamp}]\n${data}\n----------------------------------------\n`;
    fs.appendFileSync(logFilePath, logEntry, 'utf8');
}

// --- Function to read links from CSV ---
function getLinksFromCSV(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            console.error(`Error: Links file not found at "${filePath}"`);
            return [];
        }
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const requiredBasePath = 'https://simplywall.st/stocks/in/'; // Define the required path start

        return fileContent
            .split(/\r?\n/)
            .slice(1) // Skip header row
            .map(line => {
                const parts = line.match(/(?:[^\s",]+|"[^"]*")+/g); // Handle commas within quotes
                if (parts && parts.length >= 2) {
                    const symbol = parts[0].replace(/"/g, '').trim();
                    let link = parts[1].replace(/"/g, '').trim();

                    // Basic validation and **NEW check for required base path**
                    if (link && link !== 'Not Found' && link.startsWith(requiredBasePath)) {
                        // Optional: Clean up extra path segments like /information or /news if desired
                        // Example: remove known trailing segments
                        link = link.replace(/\/information$/, '')
                                   .replace(/\/news.*$/, '') // Remove /news and anything after
                                   .replace(/\/management$/, '')
                                   .replace(/\/health$/, '')
                                   .replace(/\/valuation$/, '')
                                   .replace(/\/future$/, '')
                                   .replace(/\/past$/, '')
                                   .replace(/\/dividend$/, '')
                                   .replace(/\/ownership$/, '');

                        return { symbol, link };
                    } else if (link && link !== 'Not Found' && !link.startsWith(requiredBasePath)) {
                         console.log(`Skipping link for ${symbol}: Does not match required path (${link})`);
                    }
                }
                return null; // Return null for invalid lines, "Not Found", or non-matching links
            })
            .filter(item => item !== null); // Filter out invalid entries
    } catch (error) {
        console.error(`Error reading links file "${filePath}": ${error.message}`);
        return [];
    }
}

// --- Function to scrape data for a single page ---
async function scrapePageData(page) {
    let riskRewardDataText = 'Risk/Reward section not found.';
    let tableDataText = 'Snowflake table not found.';

    try {
        // --- 1. Scrape Risk/Reward Section ---
        await page.waitForSelector('div[data-cy-id="risk-reward-wrapper"]', { timeout: 20000 });
        riskRewardDataText = await page.evaluate(() => {
            const wrapper = document.querySelector('div[data-cy-id="risk-reward-wrapper"]');
            if (!wrapper) return 'Risk/Reward section not found within page evaluate.';
            let text = '';
            wrapper.childNodes.forEach(node => {
                if (node.nodeName === 'H3') {
                    text += `\n<h3>${node.innerText.trim()}</h3>\n`; // Use HTML tags for WP
                } else if (node.nodeName === 'BLOCKQUOTE') {
                    const p = node.querySelector('p');
                    if (p) {
                        let itemText = p.innerText.replace(/\s+/g, ' ').trim();
                        text += `<li>${itemText}</li>\n`; // Use HTML list tags
                    }
                }
            });
             // Wrap blockquote content in lists
             text = text.replace(/<\/h3>\n<li>/g, '</h3>\n<ul>\n<li>'); // Start list after heading
             text = text.replace(/<\/li>\n<h3>/g, '</li>\n</ul>\n<h3>'); // End list before next heading
             text = text.replace(/<\/li>\n$/g, '</li>\n</ul>\n'); // End last list
            return text.trim(); // Keep HTML formatting
        });

        // Log Risk/Reward data
        logToFile(`Risk/Reward Data:\n${riskRewardDataText}`);

    } catch (error) {
        console.warn(`Could not scrape Risk/Reward section: ${error.message}`);
        riskRewardDataText = `<p><strong>Error:</strong> Could not scrape Risk/Reward section: ${error.message}</p>`;
        logToFile(`Error in Risk/Reward section: ${error.message}`);
    }

    try {
        // --- 2. Scrape Snowflake Score Table ---
        await page.waitForSelector('button[data-cy-id="chart-action-toggle-data-overview-summary-snowflake"]', { timeout: 15000 });
        await page.click('button[data-cy-id="chart-action-toggle-data-overview-summary-snowflake"]');
        await page.waitForSelector('table[data-cy-id="overview-snowflake-table"]', { timeout: 15000 });

        tableDataText = await page.evaluate(() => {
            const table = document.querySelector('table[data-cy-id="overview-snowflake-table"]');
            if (!table) return '<p><strong>Error:</strong> Snowflake table not found within page evaluate.</p>';

            // Keep table HTML structure for WordPress
            let tableHTML = '<table>';
            const caption = table.querySelector('caption');
             if (caption) tableHTML += `<caption>${caption.innerText.trim()}</caption>`;

             const thead = table.querySelector('thead');
             if (thead) tableHTML += thead.outerHTML;

             const tbody = table.querySelector('tbody');
             if (tbody) tableHTML += tbody.outerHTML;

            tableHTML += '</table>';
            return tableHTML;
        });

        // Log Snowflake table data
        logToFile(`Snowflake Table Data:\n${tableDataText}`);

         // Close the data table after scraping
         await page.click('button[data-cy-id="chart-action-toggle-data-overview-summary-snowflake"]');

    } catch (error) {
        console.warn(`Could not scrape Snowflake table: ${error.message}`);
        tableDataText = `<p><strong>Error:</strong> Could not scrape Snowflake table: ${error.message}</p>`;
        logToFile(`Error in Snowflake table: ${error.message}`);
         try {
            if (await page.$('table[data-cy-id="overview-snowflake-table"]')) {
                await page.click('button[data-cy-id="chart-action-toggle-data-overview-summary-snowflake"]');
            }
        } catch (closeError) {}
    }

    // Return structured data instead of just combined text
    return {
        riskReward: riskRewardDataText,
        snowflakeTable: tableDataText
    };
}

// --- Function to store data in WordPress ---
async function storeInWordPress(scrapedData, symbol, link) {
    if (!WP_CONFIG.apiUrl) {
        const errorMsg = 'WordPress API URL missing in WP_CONFIG. Skipping storage.';
        logToFile(`Error for ${symbol}: ${errorMsg}`);
        return null;
    }

    const postTitle = `${symbol} - Simply Wall St Analysis`;
    const postContent = `
        <h2>Risk/Reward Analysis</h2>
        ${scrapedData.riskReward}
        <br/>
        <h2>Snowflake Score</h2>
        ${scrapedData.snowflakeTable}
        <hr/>
        <p><em>Source: <a href="${link}" target="_blank" rel="noopener noreferrer">${link}</a></em></p>
    `;

    // Add symbol and link to the main data payload
    const postData = {
        title: postTitle,
        content: postContent,
        symbol: symbol,         // <-- Add symbol here
        simplywallst_link: link, // <-- Add link here (use a suitable key name)
        risk_reward: scrapedData.riskReward, // <-- Add risk/reward data
        snowflake_data: scrapedData.snowflakeTable, // <-- Add snowflake data
        status: 'publish'       // Or 'draft', 'pending'
    };

    try {
        logToFile(`Attempting to store data for ${symbol}:\n${JSON.stringify(postData, null, 2)}`);
        
        console.log(`Attempting to create/update post for ${symbol}...`);
        // No need for separate auth object if not using Basic/Application Password auth for THIS endpoint
        const response = await axios.post(WP_CONFIG.apiUrl, postData);

        // Check the structure of the response from your custom endpoint
        // It might not return an 'id' like the standard WP REST API
        if (response.data && response.data.success) { // Example: Check for a success flag from your endpoint
             const successMsg = `Successfully stored ${symbol} via custom endpoint. Response: ${response.data.message || 'Success'}`;
             logToFile(successMsg);
             return response.data.post_id || true; // Return post_id if available, otherwise true
        } else {
             const warningMsg = `Custom endpoint response for ${symbol} indicates potential issue: ${JSON.stringify(response.data)}`;
             logToFile(warningMsg);
             return null;
        }

    } catch (error) {
        const errorMessage = error.response?.data?.message || error.response?.data || error.message;
        const errorLog = `WP API Error for ${symbol}: ${errorMessage}`;
        logToFile(errorLog);
        
        if(error.response?.data?.data?.details) {
            logToFile(`WP Error Details: ${JSON.stringify(error.response.data.data.details)}`);
        }
        return null; // Return null on failure
    }
}

// --- Main Scraping Function ---
async function runScraper() {
    const linksToScrape = getLinksFromCSV(linksFilePath);
    if (linksToScrape.length === 0) {
        console.log('No valid links found in links.csv. Exiting.');
        return;
    }

    // // Clear the output file at the start of a run - No longer needed if only using WP
    // fs.writeFileSync(outputFilePath, '', 'utf8');
    // console.log(`Cleared ${outputFilePath} for new run.`);


    let browser;
    console.log(`Found ${linksToScrape.length} links. Starting browser...`);

    try {
        browser = await puppeteer.launch({
            headless: false, // Set back to false for login/CAPTCHA
            defaultViewport: null,
            args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        // --- Login Step (Re-enabled) ---
        console.log('Attempting login...');
        // Go to a known page first or homepage
        await page.goto('https://simplywall.st/stocks/in/materials/nse-20microns/20-microns-shares', { waitUntil: 'networkidle0', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000)); // Small delay

        // Click Login/Sign Up button
        try {
            await page.waitForSelector('button[data-cy-id="login-signup"]', { timeout: 20000 });
            await page.click('button[data-cy-id="login-signup"]');
        } catch (e) {
             console.log("Login button not found or couldn't be clicked. Assuming already logged in or page structure changed.");
             // Consider adding a check here to verify login status if the button isn't found
        }

        // Click the "Sign in" link within the modal
        try {
            await page.waitForFunction(() => Array.from(document.querySelectorAll('button, a')).some(el => el.textContent.trim() === 'Sign in'), { timeout: 10000 });
            await page.evaluate(() => {
                const signIn = Array.from(document.querySelectorAll('button, a')).find(el => el.textContent.trim() === 'Sign in');
                if (signIn) signIn.click();
            });
        } catch (e) {
            console.log("Sign in link within modal not found. Maybe already on login form?");
        }

        // Enter credentials and submit
        try {
            await page.waitForSelector('input[data-cy-id="username"]', { timeout: 10000 });
            const email = 'tekpai.121@gmail.com'; // IMPORTANT: Use your actual email
            const password = 'tekpai@129025'; // IMPORTANT: Use your actual password
            await page.type('input[data-cy-id="username"]', email, { delay: Math.random() * 100 + 50 });
            await page.type('input[data-cy-id="password"]', password, { delay: Math.random() * 100 + 50 });

            // Click the submit button
            await page.click('button[data-cy-id="button-submit-login"]');
            console.log('Login submitted. Waiting for post-login element...');

            // Wait for a specific element visible only after login:
            // await page.waitForSelector('YOUR_POST_LOGIN_ELEMENT_SELECTOR', { visible: true, timeout: 30000 }); // Replace with actual selector

            console.log('Login successful / Post-login element found.');

        } catch(e) {
             console.error("Failed during login process:", e.message);
             console.log("Cannot proceed without login. Exiting.");
             await browser.close(); // Close browser if login fails
             return; // Exit the function
        }
        // --- End Login Step ---


        // --- Loop Through Links ---
        for (let i = 0; i < linksToScrape.length; i++) {
            const { symbol, link } = linksToScrape[i];
            console.log(`\n(${i + 1}/${linksToScrape.length}) Scraping: ${symbol} - ${link}`);

            let wpPostId = null; // To store the post ID

            try {
                await page.goto(link, {
                    waitUntil: 'networkidle0',
                    timeout: 60000
                });

                const scrapedData = await scrapePageData(page); // Gets { riskReward, snowflakeTable }

                // --- Store in WordPress ---
                if (scrapedData) { // Only store if scraping was somewhat successful
                     wpPostId = await storeInWordPress(scrapedData, symbol, link);
                } else {
                     console.warn(`No data scraped for ${symbol}. Skipping WordPress storage.`);
                }

                 // Optionally write to local DB here, including wpPostId
                 // await storeInLocalDB(symbol, link, scrapedData.riskReward, scrapedData.snowflakeTable, wpPostId);

                 // // Append data to the output file (Optional backup)
                 // const outputContent = `\n\n===== ${symbol} =====\n${link}\nWP Post ID: ${wpPostId || 'Failed'}\n\n${scrapedData.riskReward}\n\n${scrapedData.snowflakeTable}\n===== END ${symbol} =====\n`;
                 // fs.appendFileSync(outputFilePath, outputContent, 'utf8');
                 // console.log(`Successfully processed ${symbol}.`);


            } catch (error) {
                console.error(`Failed to process ${symbol} (${link}): ${error.message}`);
                // // Log error to file (Optional backup)
                // const errorContent = `\n\n===== ${symbol} =====\n${link}\n\nERROR: Failed to scrape/store - ${error.message}\n===== END ${symbol} =====\n`;
                // fs.appendFileSync(outputFilePath, errorContent, 'utf8');
            }

            // Add a delay between requests
            await new Promise(resolve => setTimeout(resolve, Math.random() * 1500 + 500)); // Small delay
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
runScraper();

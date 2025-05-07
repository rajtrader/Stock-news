const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path'); // To handle file paths correctly

puppeteer.use(StealthPlugin());

const symbolFilePath = path.join(__dirname, 'Symbol.csv');
const outputFilePath = path.join(__dirname, 'links.csv');

// Function to read symbols from CSV
function getSymbolsFromCSV(filePath) {
    try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        // Split by newline, remove header, filter empty lines, trim whitespace
        return fileContent
            .split(/\r?\n/)
            .slice(1) // Skip header row
            .filter(line => line.trim() !== '')
            .map(line => line.trim());
    } catch (error) {
        console.error(`Error reading symbol file "${filePath}": ${error.message}`);
        return [];
    }
}

// Function to search DuckDuckGo and get the first Simply Wall St link
async function searchAndGetLink(page, symbol, retries = 3) {
    const searchQuery = `simply wall street ${symbol}`;
    console.log(`Searching for: ${searchQuery}`);

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            // Go to DuckDuckGo
            await page.goto('https://duckduckgo.com/', {
                waitUntil: 'networkidle2',
                timeout: 60000
            });

            // Type the search query
            await page.waitForSelector('#searchbox_input', { timeout: 10000 });
            await page.type('#searchbox_input', searchQuery);

            // Submit the search and wait for navigation
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
                page.keyboard.press('Enter')
            ]);

            // Wait for the first result link's anchor tag
            const linkSelector = '[data-testid="mainline"] li[data-layout="organic"] a[data-testid="result-title-a"]'; // Target the link directly
            await page.waitForSelector(linkSelector, { timeout: 15000 });

            // Extract the href from the anchor tag
            const link = await page.$eval(linkSelector, a => a.href); // Evaluate the link selector

            // Basic check if it looks like a Simply Wall St link
            if (link && link.includes('simplywall.st')) {
                console.log(`Found link for ${symbol}: ${link}`);
                return link;
            } else {
                // If the first link isn't simplywall.st, we might want to log it or try the next one,
                // but for now, we'll consider it not found for this simple approach.
                console.warn(`First link for ${symbol} (${link}) doesn't seem to be Simply Wall St. Skipping.`);
                return null; // Indicate not found or invalid
            }

        } catch (error) {
            console.error(`Attempt ${attempt} failed for "${searchQuery}": ${error.message}`);
            if (attempt === retries) {
                console.error(`Could not retrieve link for ${symbol} after ${retries} attempts.`);
                return null; // Indicate failure
            }
            await new Promise(resolve => setTimeout(resolve, 3000 * attempt)); // Wait longer on retries
        }
    }
    return null; // Should not be reached, but return null if loop finishes unexpectedly
}

// Main async function to orchestrate the process
async function generateLinks() {
    const symbols = getSymbolsFromCSV(symbolFilePath);
    if (symbols.length === 0) {
        console.log('No symbols found or error reading CSV. Exiting.');
        return;
    }

    console.log(`Found ${symbols.length} symbols. Starting browser...`);
    let browser;

    // --- Write CSV Header ---
    // Check if file exists, if not, write header. If it exists, we'll just append.
    if (!fs.existsSync(outputFilePath)) {
        fs.writeFileSync(outputFilePath, `"Symbol","Link"\n`, 'utf8');
        console.log(`Created ${outputFilePath} with header.`);
    } else {
        console.log(`${outputFilePath} already exists. Appending new results.`);
        // Optional: You could add logic here to clear the file if you always want a fresh run
        // fs.writeFileSync(outputFilePath, `"Symbol","Link"\n`, 'utf8');
    }

    try {
        browser = await puppeteer.launch({
            headless: true, // Run headless for speed, set to false to debug
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // Common args for compatibility
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        for (const symbol of symbols) {
            const link = await searchAndGetLink(page, symbol);
            let linkToWrite = 'Not Found'; // Default if link is null

            if (link) {
                linkToWrite = link; // Use the found link
            }

            // --- Append result to CSV immediately ---
            const csvRow = `"${symbol}","${linkToWrite}"\n`;
            fs.appendFileSync(outputFilePath, csvRow, 'utf8');
            // console.log(`Appended: ${symbol}`); // Optional: Log each appended row

            // Optional: Add a small random delay between searches to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
        }

        console.log('Finished searching and writing results.');

    } catch (error) {
        console.error('An overall error occurred:', error);
    } finally {
        if (browser) {
            await browser.close();
            console.log('Browser closed.');
        }
    }
}

// Run the main function
generateLinks();

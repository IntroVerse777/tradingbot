// Import the required modules
const TelegramBot = require('node-telegram-bot-api');
const { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL, clusterApiUrl, SystemProgram, Transaction } = require('@solana/web3.js');

// Create a new Telegram bot instance (Replace with your bot token)
const bot = new TelegramBot('7802476691:AAHFzjNvf1ZqLhj7ARqfkf64RFTuitMFU7k', { polling: true });

// Set up a connection to the Solana Testnet (use 'mainnet-beta' if needed)
const connection = new Connection(clusterApiUrl('testnet'), 'confirmed');

// Store wallets, withdrawal data, and fees collected
const userWallets = {};
const withdrawalData = {};
let feesCollected = 0; // Store the total fees collected

// Define the fee percentage (e.g., 0.2%)
const FEE_PERCENTAGE = 0.02; // 0.2% fee

// Define rent-exemption minimum (adjust as necessary based on actual rent-exempt minimum)
const RENT_EXEMPT_MINIMUM = 0.002 * LAMPORTS_PER_SOL;

// Define fee collection address (Replace with your actual address)
const FEE_COLLECTION_ADDRESS = new PublicKey('EdJZHvMzhP4BsseuTgFMwNorwS8NURT4Ry8Mh5YYF7wS');

// Handle the /start command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    // Check if the user already has a wallet
    if (!userWallets[chatId]) {
        // Generate a new Solana wallet for the user
        const wallet = Keypair.generate();
        const publicKey = wallet.publicKey.toString();

        // Store the user's wallet in memory using their chat ID
        userWallets[chatId] = { wallet, publicKey };

        // Send a welcome message and display the wallet address
        bot.sendMessage(chatId, `🎉 Welcome to the Solana Bot! A new wallet has been created for you:\n\n💼 **Wallet Address**: \`${publicKey}\``, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📥 Deposit Address', callback_data: 'deposit_address' },
                        { text: '💰 Check Balance', callback_data: 'check_balance' },
                    ],
                    [{ text: '💸 Withdraw', callback_data: 'withdraw' }],
                    [{ text: '🌟 Premium Calls', url: 'https://your-premium-calls-link.com' }] // New button with URL link
                ],
            },
        });
    } else {
        // If the user already has a wallet, show the main menu with the new "Premium Calls" button
        bot.sendMessage(chatId, '💼 Welcome back! Choose an option below:', {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📥 Deposit Address', callback_data: 'deposit_address' },
                        { text: '💰 Check Balance', callback_data: 'check_balance' },
                    ],
                    [{ text: '💸 Withdraw', callback_data: 'withdraw' }],
                    [{ text: '🌟 Premium Calls', url: 'https://your-premium-calls-link.com' }] // New button with URL link
                ],
            },
        });
    }
});

// Handle button clicks using callback queries (previous button interactions are still handled)
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data === 'check_balance') {
        if (userWallets[chatId]) {
            const publicKey = new PublicKey(userWallets[chatId].publicKey);

            try {
                // Get the balance in lamports
                const balance = await connection.getBalance(publicKey);
                const balanceInSOL = (balance / LAMPORTS_PER_SOL).toFixed(6);

                // Convert lamports to SOL and send the balance to the user
                bot.sendMessage(chatId, `💰 **Your Current Balance**: \`${balanceInSOL} SOL\``, {
                    parse_mode: 'Markdown',
                });
            } catch (error) {
                bot.sendMessage(chatId, `⚠️ Failed to fetch balance: ${error.message}`);
                console.error("Error fetching balance:", error);
            }
        } else {
            bot.sendMessage(chatId, `🚫 You don't have a wallet yet. Use the "Create Wallet" button to create one.`);
        }
    }

    if (data === 'deposit_address') {
        if (userWallets[chatId]) {
            const depositAddress = userWallets[chatId].publicKey;
            bot.sendMessage(chatId, `📥 **Deposit Address**:\n\`${depositAddress}\``, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `🚫 You don't have a wallet yet. Use the "Create Wallet" button to create one.`);
        }
    }

    if (data === 'withdraw') {
        if (userWallets[chatId]) {
            // Ask for the recipient address
            bot.sendMessage(chatId, `💸 Please enter the **withdrawal address** you want to send your SOL to:`, {
                parse_mode: 'Markdown',
                reply_markup: { force_reply: true },
            });
            // Save state to know we are waiting for an address
            withdrawalData[chatId] = { step: 1 };
        } else {
            bot.sendMessage(chatId, `🚫 You don't have a wallet yet. Use the "Create Wallet" button to create one.`);
        }
    }
});

// Listen for user replies for withdrawal address and amount
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    if (withdrawalData[chatId] && withdrawalData[chatId].step === 1) {
        // Step 1: Collect withdrawal address
        const recipientAddress = text;

        try {
            new PublicKey(recipientAddress); // Validates the address
            withdrawalData[chatId].recipientAddress = recipientAddress;
            withdrawalData[chatId].step = 2;
            bot.sendMessage(chatId, `💸 **Step 2**: Please enter the **amount of SOL** you want to withdraw or type "full" to withdraw the maximum amount:`, {
                parse_mode: 'Markdown',
                reply_markup: { force_reply: true },
            });
        } catch (error) {
            bot.sendMessage(chatId, `🚫 Invalid address. Please enter a valid Solana address.`);
        }
    } else if (withdrawalData[chatId] && withdrawalData[chatId].step === 2) {
        // Step 2: Collect withdrawal amount
        const recipientAddress = withdrawalData[chatId].recipientAddress;
        const fromWallet = userWallets[chatId].wallet;

        try {
            // Get the current balance of the user's wallet
            const balance = await connection.getBalance(fromWallet.publicKey);

            let amountInLamports;
            if (text.toLowerCase() === 'full') {
                // Calculate the maximum amount user can withdraw, considering fee and rent-exempt minimum
                const maxWithdrawableLamports = balance - RENT_EXEMPT_MINIMUM;

                if (maxWithdrawableLamports <= 0) {
                    bot.sendMessage(chatId, `🚫 Insufficient funds to withdraw after leaving the rent-exempt minimum.`);
                    return;
                }

                const feeInLamports = Math.floor(maxWithdrawableLamports * FEE_PERCENTAGE);
                amountInLamports = maxWithdrawableLamports - feeInLamports;

                if (amountInLamports <= 0) {
                    bot.sendMessage(chatId, `🚫 Insufficient funds. Unable to withdraw the full amount due to fees.`);
                    return;
                }
            } else {
                const amountInSOL = parseFloat(text);
                if (isNaN(amountInSOL) || amountInSOL <= 0) {
                    bot.sendMessage(chatId, `🚫 Invalid amount. Please enter a valid number.`);
                    return;
                }

                // Convert SOL to lamports
                amountInLamports = Math.floor(amountInSOL * LAMPORTS_PER_SOL);
                const feeInLamports = Math.floor(amountInLamports * FEE_PERCENTAGE);

                if (balance - amountInLamports - feeInLamports < RENT_EXEMPT_MINIMUM) {
                    bot.sendMessage(chatId, `⚠️ Insufficient funds. After withdrawal, your account balance would be less than the required rent-exempt minimum of ${(RENT_EXEMPT_MINIMUM / LAMPORTS_PER_SOL).toFixed(6)} SOL.`);
                    return;
                }
            }

            const feeInLamports = Math.floor(amountInLamports * FEE_PERCENTAGE);

            // Create and send transaction to transfer SOL and collect fee
            const transaction = new Transaction().add(
                // Transfer the amount to the recipient address
                SystemProgram.transfer({
                    fromPubkey: fromWallet.publicKey,
                    toPubkey: new PublicKey(recipientAddress),
                    lamports: amountInLamports,
                }),
                // Transfer the fee to the fee collection address
                SystemProgram.transfer({
                    fromPubkey: fromWallet.publicKey,
                    toPubkey: FEE_COLLECTION_ADDRESS,
                    lamports: feeInLamports,
                })
            );

            const signature = await connection.sendTransaction(transaction, [fromWallet]);
            await connection.confirmTransaction(signature);

            // Update the total fees collected
            feesCollected += feeInLamports / LAMPORTS_PER_SOL; // Convert lamports to SOL for display

            bot.sendMessage(chatId, `✅ Withdrawal successful! \nTransaction signature: \`${signature}\`\nFee collected: \`${(feeInLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL\``, { parse_mode: 'Markdown' });
        } catch (error) {
            bot.sendMessage(chatId, `⚠️ Withdrawal failed: ${error.message}`);
            console.error("Withdrawal error:", error);
        }

        // Clear withdrawal data after completing the transaction
        delete withdrawalData[chatId];
    }
});


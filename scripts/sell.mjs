import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import path from "path";
import fs from "fs";

// Load config to get MCP URL
const CONFIG_PATH = path.join(process.cwd(), "agent-config.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
const MCP_URL = config.mcp_url || "http://localhost:8787/mcp";

async function main() {
    // Parse Arguments
    const args = process.argv.slice(2);
    let rawSymbol = args[0];
    const rawAmount = args[1];

    if (!rawSymbol) {
        console.error("Usage: node scripts/sell.mjs <SYMBOL> [AMOUNT]");
        console.error("Example: node scripts/sell.mjs BTC 1000");
        console.error("Example: node scripts/sell.mjs BTC all");
        console.error("Example: node scripts/sell.mjs ALL");
        process.exit(1);
    }

    rawSymbol = rawSymbol.toUpperCase();
    const isLiquidateAll = rawSymbol === "ALL";
    const isSellMax = rawAmount && rawAmount.toLowerCase() === "all";

    // Default amount to 1000 if not specified (and not selling max)
    const notional = (!isSellMax && rawAmount) ? parseFloat(rawAmount) : (isSellMax ? 0 : 1000);

    console.log(`Connecting to MCP server at ${MCP_URL}...`);

    const transport = new SSEClientTransport(new URL(MCP_URL));
    const client = new Client({ name: "manual-trader", version: "1.0" }, { capabilities: {} });

    try {
        await client.connect(transport);
        console.log("Connected!");

        // Fetch positions
        const positionsResult = await client.callTool({
            name: "positions-list",
            arguments: {}
        });
        const positionsData = JSON.parse(positionsResult.content[0].text);

        if (!positionsData.ok) {
            console.error("Failed to fetch positions");
            process.exit(1);
        }

        let targets = [];

        if (isLiquidateAll) {
            targets = positionsData.data.positions;
            if (targets.length === 0) {
                console.log("No positions to liquidate.");
                process.exit(0);
            }
            console.log(`\n!!! LIQUIDATING ALL ${targets.length} POSITIONS !!!\n`);
        } else {
            // Resolve single symbol
            const cryptoTickers = ['BTC', 'ETH', 'SOL', 'LTC', 'BCH', 'DOGE', 'SHIB', 'AVAX', 'LINK', 'UNI', 'MATIC'];
            let symbol = (cryptoTickers.includes(rawSymbol) && !rawSymbol.includes('/')) ? `${rawSymbol}/USD` : rawSymbol;
            const held = positionsData.data.positions.find(p =>
                p.symbol === rawSymbol ||
                p.symbol === symbol ||
                p.symbol === rawSymbol + "USD" ||
                p.symbol.replace("/", "") === rawSymbol
            );

            if (held) {
                targets.push(held);
            } else {
                // If not held, try to sell generic (will likely fail Policy if shorting blocked but we try)
                targets.push({ symbol: symbol, qty: 0, current_price: 0 });
            }
        }

        for (const target of targets) {
            let symbol = target.symbol;
            let qty = undefined;
            let currentNotional = notional;

            if (target.qty > 0) {
                console.log(`Processing ${symbol} (Held: ${target.qty}, Price: $${target.current_price})`);

                if (isSellMax || isLiquidateAll) {
                    qty = target.qty;
                    console.log(`Selling MAX quantity: ${qty}`);
                } else {
                    // Calculate qty for dollar amount to avoid notional mismatches
                    if (target.current_price > 0 && currentNotional > 0) {
                        let calculatedQty = currentNotional / target.current_price;
                        // specific rounding or just use high precision? Alpaca handles up to 9 decimals for crypto
                        // but let's be safe with 6
                        calculatedQty = Math.floor(calculatedQty * 1000000) / 1000000;

                        if (calculatedQty > target.qty) {
                            console.log(`Requested $${currentNotional} exceeds holding ($${target.market_value}). Capping at max.`);
                            qty = target.qty;
                        } else {
                            qty = calculatedQty;
                            console.log(`Calculated sell qty: ${qty} ($${currentNotional})`);
                        }
                    }
                }
            } else {
                console.log(`Position not found for ${symbol}. Attempting short/sell...`);
            }

            console.log(`\n--- Step 1: Preview Sell Order for ${qty ? qty + " shares" : "$" + currentNotional} of ${symbol} ---`);

            const isCrypto = symbol.includes('/');
            const orderArgs = {
                symbol,
                side: "sell",
                order_type: "market",
                time_in_force: isCrypto ? "gtc" : "day" // Alpaca: notional stock orders must be DAY
            };

            if (qty) {
                orderArgs.qty = qty;
            } else {
                orderArgs.notional = currentNotional;
            }

            const previewResult = await client.callTool({
                name: "orders-preview",
                arguments: orderArgs
            });

            const previewData = JSON.parse(previewResult.content[0].text);

            if (!previewData.ok) {
                console.error(`Preview failed for ${symbol}:`, JSON.stringify(previewData, null, 2));
                continue;
            }

            const { policy } = previewData.data;

            if (!policy.allowed) {
                console.error(`Policy rejected trade for ${symbol}:`, JSON.stringify(policy.violations, null, 2));
                continue;
            }

            const token = policy.approval_token;
            console.log("Order Approved!");

            console.log(`\n--- Step 2: Submit Sell Order for ${symbol} ---`);
            const submitResult = await client.callTool({
                name: "orders-submit",
                arguments: { approval_token: token }
            });

            const submitData = JSON.parse(submitResult.content[0].text);

            if (submitData.ok) {
                console.log(`SUCCESS! Sold ${symbol}. Order ID: ${submitData.data.order.id}`);
            } else {
                console.error(`Submission failed for ${symbol}:`, JSON.stringify(submitData, null, 2));
            }
            console.log("---------------------------------------------------");
        }

    } catch (error) {
        console.error("Error:", error);
    } finally {
        process.exit(0);
    }
}

main();

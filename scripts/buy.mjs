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
        console.error("Usage: node scripts/buy.mjs <SYMBOL> [AMOUNT]");
        console.error("Example: node scripts/buy.mjs BTC 1000");
        process.exit(1);
    }

    // Normalize Symbol
    rawSymbol = rawSymbol.toUpperCase();
    const cryptoTickers = ['BTC', 'ETH', 'SOL', 'LTC', 'BCH', 'DOGE', 'SHIB', 'AVAX', 'LINK', 'UNI', 'MATIC'];
    const symbol = (cryptoTickers.includes(rawSymbol) && !rawSymbol.includes('/')) ? `${rawSymbol}/USD` : rawSymbol;

    // Default amount to 1000 if not specified
    const notional = rawAmount ? parseFloat(rawAmount) : 1000;

    console.log(`Connecting to MCP server at ${MCP_URL}...`);

    const transport = new SSEClientTransport(new URL(MCP_URL));
    const client = new Client({ name: "manual-trader", version: "1.0" }, { capabilities: {} });

    try {
        await client.connect(transport);
        console.log("Connected!");

        console.log(`\n--- Step 1: Preview Order for $${notional} of ${symbol} ---`);

    const isCrypto = symbol.includes('/');
    const timeInForce = isCrypto ? "gtc" : "day"; // Alpaca: notional stock orders must be DAY

        // 1. Preview the order to get an approval token
        const previewResult = await client.callTool({
            name: "orders-preview",
            arguments: {
                symbol,
                side: "buy",
                notional,
                order_type: "market",
                time_in_force: timeInForce
            }
        });

        const previewData = JSON.parse(previewResult.content[0].text);

        if (!previewData.ok) {
            console.error("Preview failed:", JSON.stringify(previewData, null, 2));
            process.exit(1);
        }

        const { policy } = previewData.data;

        if (!policy.allowed) {
            console.error("Policy rejected trade:", JSON.stringify(policy.violations, null, 2));
            process.exit(1);
        }

        const token = policy.approval_token;
        console.log("Order Approved! Token:", token.slice(0, 10) + "...");
        console.log(`Estimated Quantity: ${previewData.data.preview.qty || "N/A"}`);
        console.log(`Estimated Price: $${previewData.data.preview.estimated_price}`);

        console.log(`\n--- Step 2: Submit Order ---`);

        // 2. Submit the order with the token
        const submitResult = await client.callTool({
            name: "orders-submit",
            arguments: {
                approval_token: token
            }
        });

        const submitData = JSON.parse(submitResult.content[0].text);

        if (submitData.ok) {
            console.log("SUCCESS! Trade execution confirmed.");
            console.log("Order ID:", submitData.data.order.id);
            console.log("Status:", submitData.data.order.status);
        } else {
            console.error("Submission failed:", JSON.stringify(submitData, null, 2));
        }

    } catch (error) {
        console.error("Error:", error);
    } finally {
        // Force exit since SSE transport might keep connection open
        process.exit(0);
    }
}

main();

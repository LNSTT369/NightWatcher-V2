import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

// Load config to get MCP URL
const CONFIG_PATH = path.join(process.cwd(), "agent-config.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
const MCP_URL = config.mcp_url || "http://localhost:8787/mcp";

async function main() {
    console.log(`Connecting to MCP server at ${MCP_URL}...`);

    const transport = new SSEClientTransport(new URL(MCP_URL));
    const client = new Client({ name: "manual-trader", version: "1.0" }, { capabilities: {} });

    try {
        await client.connect(transport);
        console.log("Connected!");

        const symbol = "ETH/USD";
        const args = process.argv.slice(2);
        const notional = args.length > 0 ? parseFloat(args[0]) : 100; // Default to $100 if not specified

        console.log(`\n--- Step 1: Preview Order for $${notional} of ${symbol} ---`);

        // 1. Preview the order to get an approval token
        const previewResult = await client.callTool({
            name: "orders-preview",
            arguments: {
                symbol,
                side: "buy",
                notional,
                order_type: "market",
                time_in_force: "gtc" // Crypto trades 24/7
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

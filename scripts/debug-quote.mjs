import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import path from "path";
import fs from "fs";

const CONFIG_PATH = path.join(process.cwd(), "agent-config.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
const MCP_URL = config.mcp_url || "http://localhost:8787/mcp";

async function main() {
    console.log(`Connecting to ${MCP_URL}...`);
    const transport = new SSEClientTransport(new URL(MCP_URL));
    const client = new Client({ name: "debug-quote", version: "1.0" }, { capabilities: {} });

    try {
        await client.connect(transport);
        console.log("Connected. Calling market-quote for BTC/USD...");

        const result = await client.callTool({
            name: "market-quote",
            arguments: { symbol: "BTC/USD" }
        });

        console.log("\n--- Raw Result ---");
        console.log(JSON.stringify(result, null, 2));

        if (result.content && result.content[0] && result.content[0].text) {
            console.log("\n--- Content Text ---");
            console.log(result.content[0].text);
            try {
                const parsed = JSON.parse(result.content[0].text);
                console.log("\n--- Parsed JSON ---");
                console.log(parsed);
            } catch (e) {
                console.error("\n--- JSON Parse Error ---");
                console.error(e.message);
            }
        }

    } catch (error) {
        console.error("Error calling tool:", error);
    }
    process.exit(0);
}

main();

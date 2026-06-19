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
    const client = new Client({ name: "debug-overview", version: "1.0" }, { capabilities: {} });

    try {
        await client.connect(transport);
        console.log("Connected. Calling symbol-overview for BTC/USD...");

        const result = await client.callTool({
            name: "symbol-overview",
            arguments: { symbol: "BTC/USD" }
        });

        const text = result.content[0].text;
        console.log("\n--- Result Text ---");
        // console.log(text);

        try {
            const data = JSON.parse(text);
            console.log("\n--- Parsed JSON ---");
            console.log(JSON.stringify(data, null, 2));
        } catch (e) {
            console.log("Not JSON:", text);
        }

    } catch (error) {
        console.error("Error calling tool:", error);
    }
    process.exit(0);
}

main();

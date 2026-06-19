import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import fs from "fs";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), "agent-config.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
const MCP_URL = config.mcp_url || "http://localhost:8787/mcp";

async function main() {
    console.log(`Connecting to ${MCP_URL}...`);
    const transport = new SSEClientTransport(new URL(MCP_URL));
    const client = new Client({ name: "test-client", version: "1.0" }, { capabilities: {} });

    await client.connect(transport);
    console.log("Connected.");

    const symbol = "AAPL";
    console.log(`Analyzing ${symbol}...`);

    try {
        const result = await client.callTool({
            name: "symbol-analyze",
            arguments: { symbol }
        });

        if (result.isError) {
            console.error("Tool Failed:", JSON.parse(result.content[0].text));
        } else {
            const data = JSON.parse(result.content[0].text);
            console.log("Success!");
            console.log(JSON.stringify(data, null, 2));
        }
    } catch (e) {
        console.error("Error calling tool:", e);
    }

    process.exit(0);
}

main();

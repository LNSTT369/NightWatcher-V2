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
    const client = new Client({ name: "list-tools", version: "1.0" }, { capabilities: {} });

    try {
        await client.connect(transport);
        console.log("Connected. Listing tools...");

        const result = await client.listTools();

        console.log("\n--- Available Tools ---");
        result.tools.forEach(tool => {
            console.log(`- ${tool.name}: ${tool.description || "No description"}`);
        });

    } catch (error) {
        console.error("Error calling tool:", error);
    }
    process.exit(0);
}

main();

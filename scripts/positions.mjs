#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { EventSource } from "eventsource";

global.EventSource = EventSource;

async function main() {
    const transport = new SSEClientTransport(
        new URL("http://localhost:8787/mcp"),
    );
    const client = new Client(
        {
            name: "manual-positions-client",
            version: "1.0.0",
        },
        {
            capabilities: {},
        }
    );

    try {
        console.log("Connecting to MCP server at http://localhost:8787/mcp...");
        await client.connect(transport);
        console.log("Connected!");

        console.log("\n--- Fetching Positions ---");
        const result = await client.callTool({
            name: "positions-list",
            arguments: {}
        });

        const text = result.content[0].text;
        console.log("Raw response:", text);
        const data = JSON.parse(text);

        if (data.ok) {
            const positions = data.data.positions;
            if (positions.length === 0) {
                console.log("No open positions.");
            } else {
                console.log(`${positions.length} open position(s):`);
                console.table(positions.map(p => ({
                    Symbol: p.symbol,
                    Qty: p.qty,
                    Side: p.side,
                    "Market Value": `$${p.market_value.toFixed(2)}`,
                    "Unrealized P&L": `$${p.unrealized_pl.toFixed(2)}`
                })));
            }
        } else {
            console.error("Failed to fetch positions:", data.error);
        }

    } catch (error) {
        console.error("Error:", error);
    } finally {
        await client.close();
    }
}

main();

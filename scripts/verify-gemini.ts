import fs from 'fs';
import { createGeminiProvider } from './src/providers/llm/gemini';

const env = fs.readFileSync('.dev.vars', 'utf8')
    .split('\n')
    .reduce((acc, line) => {
        const [key, val] = line.split('=');
        if (key && val) acc[key.trim()] = val.trim();
        return acc;
    }, {});

const apiKey = env.GEMINI_API_KEY;

if (!apiKey) {
    console.error("GEMINI_API_KEY not found in .dev.vars");
    process.exit(1);
}

console.log("Testing Gemini Provider with key ending in: ..." + apiKey.slice(-4));

async function testModel(modelName: string) {
    console.log(`\nTesting model: ${modelName}`);
    const provider = createGeminiProvider({ apiKey, model: modelName });
    try {
        console.log("Sending request...");
        const result = await provider.complete({
            messages: [{ role: 'user', content: 'Hello! Just say "Gemini is working".' }]
        });
        console.log("Response:", result.content);
        console.log("Usage:", result.usage);
        return true;
    } catch (e: any) {
        console.error(`Error with ${modelName}:`, e.message || e);
        return false;
    }
}

async function run() {
    let success = await testModel("gemini-2.0-flash");
    if (!success) {
        success = await testModel("gemini-2.0-flash-001");
    }
}
run();

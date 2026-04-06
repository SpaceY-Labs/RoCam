/**
 * Author: Jianqing Liu
 * Date: 2026-01-27
 * Purpose: Script to run the labelling API contract check tests.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

await import(path.resolve(__dirname, "..", "..", "test", "labelling_api_contract_check.mjs"));

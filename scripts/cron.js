// scripts/cron.js
import { indexAllTags } from "./index-tags.js";

console.log("✅ Tag indexing cron started. Running every 1 minute.");

const run = async () => {
  console.log(`⏰ [${new Date().toISOString()}] Starting index job...`);
  try {
    await indexAllTags();
    console.log(`✅ [${new Date().toISOString()}] Index job done.`);
  } catch (e) {
    console.error(`❌ [${new Date().toISOString()}] Index job failed:`, e);
  }
};

run(); // run immediately
setInterval(run, 60 * 1000); // run every 60 seconds

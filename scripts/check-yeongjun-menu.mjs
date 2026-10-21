import { parseYeongjunMenu } from "../supabase/functions/_shared/yeongjun-parser.js";

const sourceUrl = process.env.BABFULL_MENU_URL || "https://yeongjun.com/babfullmenu";
const response = await fetch(sourceUrl, {
  headers: { "User-Agent": "Mozilla/5.0 (compatible; BabfullMania/1.0)" },
  signal: AbortSignal.timeout(20000),
});
if (!response.ok) throw new Error(`영준닷컴 HTTP ${response.status}`);
const parsed = parseYeongjunMenu(await response.text());
console.log(JSON.stringify({ sourceUrl, headers: parsed.headers, dates: parsed.dates, meals: parsed.meals }, null, 2));

// Claude API proxy — routes browser requests to api.anthropic.com to avoid CORS
// Key is stored in Netlify env var CLAUDE_API_KEY — never sent from browser
// POST / with JSON body {prompt, maxTokens?, mode?}
// mode "research" enables web_search tool for halachic source lookup

const ALLOWED_ORIGINS = [
  "https://onetaskfocuser.netlify.app",
  "http://localhost:5173",
  "http://localhost:4173",
];

// Yeshivish-aware system context — injected into every Claude call so all AI
// features understand Torah/halacha terminology without needing it in every prompt.
const YESHIVISH_SYSTEM = `You are assisting a rabbi and Orthodox Jewish community. You understand "Yeshivish" — a dialect blending English with Hebrew, Aramaic, and Yiddish Torah terms.

Key vocabulary:
- shaila/shaylos = halachic question(s)  |  psak/paskening = halachic ruling
- halacha = Jewish law  |  gemara = Talmud  |  mishnah = Mishna  |  chumash = Pentateuch
- Rashi/Tosafos = classic Talmud commentators  |  Rambam/Ramban = medieval authorities
- Shabbos = Sabbath  |  Yom Tov = Jewish holiday  |  davening = prayer
- shiur = Torah class  |  kollel = full-time Torah study institution
- beis medrash = Torah study hall  |  rosh yeshiva = yeshiva head
- chavrusa = study partner  |  machlokes = halachic dispute  |  svara = logical argument
- mutar/assur = permitted/forbidden  |  kashrus = dietary laws  |  treif = non-kosher
- fleishig/milchig/pareve = meat / dairy / neutral  |  mikvah = ritual bath
- mezuzah = doorpost parchment  |  tefillin = phylacteries  |  bracha = blessing
- kiddush = Shabbos wine sanctification  |  teshuvah = repentance
- tzaddik = righteous person  |  tzedakah = charity  |  chasuna = wedding
- mazel tov = congratulations  |  Baruch Hashem / B"H = thank God / with God's help
- pshat = simple meaning  |  tachlis = bottom line / practical point

Interpret all content in this Torah, halachic, and Orthodox Jewish community context. When processing voice transcripts or tasks, recognize and correctly interpret these terms even when phonetically transcribed (e.g. "shyla" = shaila, "hollaka" = halacha, "shah bus" = Shabbos).`;

exports.handler = async (event) => {
  const origin = (event.headers.origin || event.headers.Origin || "").trim();
  const isAllowed = !origin || ALLOWED_ORIGINS.includes(origin);

  const cors = {
    "Access-Control-Allow-Origin":  isAllowed ? (origin || ALLOWED_ORIGINS[0]) : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (!isAllowed) {
    return { statusCode: 403, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Origin not allowed" }) };
  }

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: "CLAUDE_API_KEY not configured in Netlify env vars" }) };
  }

  try {
    const { prompt, maxTokens, mode } = JSON.parse(event.body);
    const isResearch = mode === "research";

    const body = {
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens || 3000,
      system: YESHIVISH_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      ...(isResearch && {
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
      }),
    };

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    if (data.error) {
      return { statusCode: r.status, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: data.error.message || "Claude API error" }) };
    }

    // Extract text from potentially multi-block response (web search returns tool_use + text blocks)
    const text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n\n");

    return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ text }) };
  } catch (e) {
    return { statusCode: 502, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Proxy error: " + e.message }) };
  }
};

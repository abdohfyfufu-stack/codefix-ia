
const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({
    name: "CodeFix AI",
    status: "online",
    message: "CodeFix AI backend is running"
  });
});

app.post("/api/fix", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Gemini API key is not configured on the server."
      });
    }

    const { code, language } = req.body || {};

    if (typeof code !== "string" || !code.trim()) {
      return res.status(400).json({
        error: "Please provide code to fix."
      });
    }

    if (code.length > 20000) {
      return res.status(413).json({
        error: "Code is too long. Maximum is 20000 characters."
      });
    }

    const safeLanguage =
      typeof language === "string"
        ? language.slice(0, 50)
        : "not specified";

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text:
                    "Fix the following code. Preserve its intended behavior. " +
                    "Return only the complete corrected code, without Markdown fences. " +
                    "If the code is already correct, return it unchanged.\n" +
                    "Language: " + safeLanguage + "\n\n" +
                    "Code:\n" + code
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192
          }
        }),
        signal: AbortSignal.timeout(60000)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error status:", response.status);

      if (response.status === 400 || response.status === 403) {
        return res.status(502).json({
          error: "Gemini rejected the request. Check the API key and API access."
        });
      }

      if (response.status === 429) {
        return res.status(429).json({
          error: "Gemini usage limit reached. Please try again later."
        });
      }

      return res.status(502).json({
        error: "Gemini service request failed."
      });
    }

    const fixedCode = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!fixedCode) {
      return res.status(502).json({
        error: "Gemini returned no corrected code."
      });
    }

    return res.json({
      success: true,
      language: safeLanguage,
      fixedCode
    });
  } catch (error) {
    console.error("Fix request failed:", error.name);

    if (error.name === "TimeoutError" ||
        error.name === "AbortError") {
      return res.status(504).json({
        error: "Gemini request timed out. Please try again."
      });
    }

    return res.status(500).json({
      error: "An unexpected server error occurred."
    });
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`CodeFix AI server running on port ${PORT}`);
});

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 10000;
const DATA_DIR = process.env.CODEFIX_DATA_DIR || path.join(os.tmpdir(), "codefix-ai-data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
const MAX_CODE_LENGTH = 20000;
const AI_TASKS = new Set([
  "fix",
  "complete",
  "explain",
  "bugs",
  "performance",
  "comments",
  "refactor",
  "security",
  "documentation"
]);

let writeQueue = Promise.resolve();

app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "1mb" }));

function getSessionId(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)codefix_session=([a-f0-9]{64})(?:;|$)/);
  return match ? match[1] : null;
}

function setSessionCookie(req, res, sessionId) {
  const secure = req.secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `codefix_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`
  );
}

async function readStore() {
  try {
    const content = await fs.readFile(DATA_FILE, "utf8");
    const store = JSON.parse(content);
    if (!store || typeof store.sessions !== "object") {
      throw new Error("Stored data has an invalid format.");
    }
    return store;
  } catch (error) {
    if (error.code === "ENOENT") return { sessions: {} };
    throw error;
  }
}

async function updateStore(update) {
  const operation = writeQueue.then(async () => {
    const store = await readStore();
    const result = await update(store);
    await fs.mkdir(DATA_DIR, { recursive: true });
    const temporaryFile = `${DATA_FILE}.${process.pid}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(store, null, 2), { mode: 0o600 });
    await fs.rename(temporaryFile, DATA_FILE);
    return result;
  });

  writeQueue = operation.catch(() => {});
  return operation;
}

app.use("/api", async (req, res, next) => {
  try {
    let sessionId = getSessionId(req);
    if (!sessionId) {
      sessionId = crypto.randomBytes(32).toString("hex");
      setSessionCookie(req, res, sessionId);
      await updateStore(store => {
        store.sessions[sessionId] = { projects: [], history: [], settings: {} };
      });
    } else {
      const store = await readStore();
      if (!store.sessions[sessionId]) {
        await updateStore(current => {
          current.sessions[sessionId] = { projects: [], history: [], settings: {} };
        });
      }
    }
    req.sessionId = sessionId;
    next();
  } catch (error) {
    next(error);
  }
});

function getSession(store, sessionId) {
  if (!store.sessions[sessionId]) {
    store.sessions[sessionId] = { projects: [], history: [], settings: {} };
  }
  return store.sessions[sessionId];
}

function validateCode(code) {
  return typeof code === "string" && code.length <= MAX_CODE_LENGTH;
}

function respondWithError(res, status, error) {
  return res.status(status).json({ error });
}

app.get("/api/session", (req, res) => {
  res.json({ guest: true, authenticated: false });
});

app.get("/api/projects", async (req, res, next) => {
  try {
    const store = await readStore();
    const projects = getSession(store, req.sessionId).projects;
    res.json({ projects });
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects", async (req, res, next) => {
  try {
    const { name, language = "plaintext", code = "" } = req.body || {};
    if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
      return respondWithError(res, 400, "Project name must contain 1 to 100 characters.");
    }
    if (!validateCode(code)) {
      return respondWithError(res, 400, "Project code must be a string of at most 20000 characters.");
    }

    const project = {
      id: crypto.randomUUID(),
      name: name.trim(),
      language: typeof language === "string" ? language.slice(0, 50) : "plaintext",
      code,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await updateStore(store => {
      getSession(store, req.sessionId).projects.unshift(project);
    });
    res.status(201).json({ project });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId", async (req, res, next) => {
  try {
    const store = await readStore();
    const project = getSession(store, req.sessionId).projects.find(item => item.id === req.params.projectId);
    if (!project) return respondWithError(res, 404, "Project not found.");
    res.json({ project });
  } catch (error) {
    next(error);
  }
});

app.put("/api/projects/:projectId", async (req, res, next) => {
  try {
    const { name, language, code } = req.body || {};
    if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
      return respondWithError(res, 400, "Project name must contain 1 to 100 characters.");
    }
    if (typeof language !== "string" || !validateCode(code)) {
      return respondWithError(res, 400, "A language and code of at most 20000 characters are required.");
    }
    const project = await updateStore(store => {
      const item = getSession(store, req.sessionId).projects.find(entry => entry.id === req.params.projectId);
      if (!item) return null;
      item.name = name.trim();
      item.language = language.slice(0, 50);
      item.code = code;
      item.updatedAt = new Date().toISOString();
      return item;
    });
    if (!project) return respondWithError(res, 404, "Project not found.");
    res.json({ project });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/projects/:projectId", async (req, res, next) => {
  try {
    const removed = await updateStore(store => {
      const session = getSession(store, req.sessionId);
      const originalLength = session.projects.length;
      session.projects = session.projects.filter(item => item.id !== req.params.projectId);
      return session.projects.length !== originalLength;
    });
    if (!removed) return respondWithError(res, 404, "Project not found.");
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/history", async (req, res, next) => {
  try {
    const store = await readStore();
    res.json({ history: getSession(store, req.sessionId).history });
  } catch (error) {
    next(error);
  }
});

app.get("/api/history/:entryId", async (req, res, next) => {
  try {
    const store = await readStore();
    const entry = getSession(store, req.sessionId).history.find(item => item.id === req.params.entryId);
    if (!entry) return respondWithError(res, 404, "History entry not found.");
    res.json({ entry });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/history/:entryId", async (req, res, next) => {
  try {
    const removed = await updateStore(store => {
      const session = getSession(store, req.sessionId);
      const originalLength = session.history.length;
      session.history = session.history.filter(item => item.id !== req.params.entryId);
      return session.history.length !== originalLength;
    });
    if (!removed) return respondWithError(res, 404, "History entry not found.");
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/settings", async (req, res, next) => {
  try {
    const store = await readStore();
    res.json({ settings: getSession(store, req.sessionId).settings });
  } catch (error) {
    next(error);
  }
});

app.put("/api/settings", async (req, res, next) => {
  try {
    const settings = req.body;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return respondWithError(res, 400, "Settings must be a JSON object.");
    }
    const hasSecret = value => {
      if (!value || typeof value !== "object") return false;
      return Object.entries(value).some(([key, item]) =>
        /key|token|secret|password/i.test(key) || hasSecret(item)
      );
    };
    if (hasSecret(settings)) {
      return respondWithError(res, 400, "Secrets cannot be stored in browser settings.");
    }
    const allowedLocales = new Set(["en-US", "fr-FR", "ar-SA"]);
    const allowedLanguages = new Set(["typescript", "javascript", "python", "golang", "rust", "java", "cpp", "php", "htmlcss"]);
    if (settings.locale !== undefined && !allowedLocales.has(settings.locale)) {
      return respondWithError(res, 400, "Unsupported locale.");
    }
    if (settings.language !== undefined && !allowedLanguages.has(settings.language)) {
      return respondWithError(res, 400, "Unsupported language.");
    }
    if (settings.temperature !== undefined &&
        (typeof settings.temperature !== "number" || settings.temperature < 0.1 || settings.temperature > 0.7)) {
      return respondWithError(res, 400, "Temperature must be between 0.1 and 0.7.");
    }
    if (settings.notifications !== undefined &&
        (!Array.isArray(settings.notifications) || settings.notifications.length !== 3 ||
         settings.notifications.some(value => typeof value !== "boolean"))) {
      return respondWithError(res, 400, "Notifications must contain three boolean values.");
    }
    const safeSettings = {
      ...(settings.locale ? { locale: settings.locale } : {}),
      ...(settings.language ? { language: settings.language } : {}),
      ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
      ...(settings.notifications ? { notifications: settings.notifications } : {})
    };
    await updateStore(store => {
      getSession(store, req.sessionId).settings = safeSettings;
    });
    res.json({ settings: safeSettings });
  } catch (error) {
    next(error);
  }
});

async function runAiTask(req, res, next) {
  try {
    const { code, language, task = "fix", projectId } = req.body || {};
    if (typeof code !== "string" || !code.trim()) {
      return respondWithError(res, 400, "Please provide code to analyze.");
    }
    if (code.length > MAX_CODE_LENGTH) {
      return respondWithError(res, 413, "Code is too long. Maximum is 20000 characters.");
    }
    if (!AI_TASKS.has(task)) {
      return respondWithError(res, 400, "Unsupported AI task.");
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return respondWithError(res, 503, "AI service is not configured. Set GEMINI_API_KEY on the server.");
    }

    const prompts = {
      fix: "Fix errors in the supplied code while preserving intended behavior. Return only complete corrected code, without Markdown fences.",
      complete: "Complete the supplied partial code in the stated language, preserving its apparent intent. Return only the completed code, without Markdown fences.",
      explain: "Explain the supplied code clearly. Do not claim errors unless they are present in the supplied code.",
      bugs: "Review the supplied code for actual bugs. Cite exact evidence and state when no bug is apparent.",
      performance: "Review the supplied code for concrete performance improvements. Do not invent issues.",
      comments: "Return the supplied code with concise, useful comments. Preserve its behavior.",
      refactor: "Refactor the supplied code for clarity while preserving its behavior. Return only the complete code, without Markdown fences.",
      security: "Review the supplied code for concrete security risks. Cite exact evidence and state when no issue is apparent.",
      documentation: "Generate concise documentation for the supplied code based only on what it implements."
    };
    const safeLanguage = typeof language === "string" ? language.slice(0, 50) : "not specified";
    const storedSettings = await readStore();
    const temperature = storedSettings.sessions[req.sessionId]?.settings?.temperature ?? 0.1;
    let response;
    try {
      response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [{ text: `${prompts[task]}\nLanguage: ${safeLanguage}\n\nCode:\n${code}` }]
          }],
          generationConfig: { temperature, maxOutputTokens: 8192 }
        }),
          signal: AbortSignal.timeout(60000)
        }
      );
    } catch (error) {
      if (error.name === "TimeoutError" || error.name === "AbortError") throw error;
      console.error("Gemini request could not reach the service:", error.message);
      return respondWithError(res, 502, "Gemini service could not be reached.");
    }

    let data;
    try {
      data = await response.json();
    } catch {
      return respondWithError(res, 502, "Gemini returned an invalid response.");
    }
    if (!response.ok) {
      console.error("Gemini API error status:", response.status);
      if (response.status === 429) {
        return respondWithError(res, 429, "Gemini usage limit reached. Please try again later.");
      }
      if (response.status === 400 || response.status === 403) {
        return respondWithError(res, 502, "Gemini rejected the request. Check the server API key and model access.");
      }
      return respondWithError(res, 502, "Gemini service request failed.");
    }

    let result = data.candidates?.[0]?.content?.parts
      ?.map(part => typeof part.text === "string" ? part.text : "")
      .join("")
      .trim();
    if (!result) return respondWithError(res, 502, "Gemini returned no result.");
    if (["fix", "complete", "refactor", "comments"].includes(task)) {
      const fencedCode = result.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
      if (fencedCode) result = fencedCode[1];
    }

    const entry = {
      id: crypto.randomUUID(),
      task,
      language: safeLanguage,
      input: code,
      output: result,
      projectId: typeof projectId === "string" ? projectId : null,
      createdAt: new Date().toISOString()
    };
    await updateStore(store => {
      const session = getSession(store, req.sessionId);
      session.history.unshift(entry);
      session.history = session.history.slice(0, 200);
    });

    res.json({
      success: true,
      task,
      language: safeLanguage,
      result,
      ...(task === "fix" ? { fixedCode: result } : {}),
      entryId: entry.id
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return respondWithError(res, 504, "Gemini request timed out. Please try again.");
    }
    next(error);
  }
}

app.post("/api/ai", runAiTask);
app.post("/api/fix", (req, res, next) => {
  req.body = { ...req.body, task: "fix" };
  runAiTask(req, res, next);
});

app.use("/api", (req, res) => {
  respondWithError(res, 404, "API route not found.");
});

app.use(express.static(__dirname));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "codefix_ai_home_editor.html"));
});

app.use((error, req, res, next) => {
  console.error("Request failed:", error.message);
  if (res.headersSent) return next(error);
  const status = error.status === 400 || error.status === 413 ? error.status : 500;
  const message = status === 413
    ? "Request body is too large."
    : status === 400
      ? "Request body must contain valid JSON."
      : "An unexpected server error occurred.";
  return respondWithError(res, status, message);
});

app.listen(PORT, () => {
  console.log(`CodeFix AI server running on port ${PORT}`);
});

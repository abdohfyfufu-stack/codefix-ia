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

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`CodeFix AI server running on port ${PORT}`);
});

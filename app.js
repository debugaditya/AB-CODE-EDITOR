const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/ask', async (req, res) => {
  const { data, lang } = req.body;
  if (!data) return res.status(400).json({ error: "Missing input data in request body." });

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const result = await model.generateContent({
      contents: [{
        parts: [{
          text: `You are an intelligent AI assistant, like a copilot, designed to help users complete their thoughts or fix their code of ${lang} within a web input field.
The user's current input in the text field is:

"${data}"

Based on this 'Current Input', provide a direct continuation, completion, or correction.
Your response MUST strictly follow this format:
---SNIPPET---
<The exact text that should be suggested to append to the 'Current Input'. This should be concise and directly extend the user's current line or thought. If no meaningful suggestion, leave empty.>
---FULLCODE---
<The complete, updated text that would be in the input field if the SNIPPET is accepted and appended to the 'Current Input'. THERE SHOULD BE NO SYNTAX ERROR IN THE FULL CODE.This is essentially 'Current Input' + 'SNIPPET'. If no meaningful suggestion, this should be the 'Current Input' itself.>

Here are CORRECTED examples to follow STRICTLY:

Example 1:
Current Input: "Hello, how are yo"
---SNIPPET---
u?
---FULLCODE---
Hello, how are you?

Example 2:
Current Input: "function sum(a, b) {"
---SNIPPET---
  return a + b;
}
---FULLCODE---
function sum(a, b) {
  return a + b;
}

Example 3:
Current Input: "This is a sentence that is not fully completed yet, it needs a "
---SNIPPET---
period.
---FULLCODE---
This is a sentence that is fully completed yet, it needs a period.

Example 4:
Current Input: "The quick brown fox"
---SNIPPET---

---FULLCODE---
The quick brown fox

Ensure you only output the content between the ---SNIPPET--- and ---FULLCODE--- markers, and nothing else. Do not add any conversational text or explanations.` }]
      }]
    });

    const response = result.response;
    const text = response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const snippetMatch = text.match(/---SNIPPET---\n([\s\S]*?)\n---FULLCODE---/);
    const fullCodeMatch = text.match(/---FULLCODE---\n([\s\S]*)/);

    const snippet = snippetMatch?.[1]?.trim() || "";
    let fullCode = fullCodeMatch?.[1]?.trim() || "";

    if (!fullCode && snippet) {
      fullCode = data + snippet;
    }

    res.json({ snippet, fullCode });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate content from AI.', details: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

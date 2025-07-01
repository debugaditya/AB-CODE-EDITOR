const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Load environment variables from .env file
dotenv.config();

const app = express();

// Enable CORS for all routes, essential for your frontend (Chrome Extension) to communicate with this local server
app.use(cors());

// Enable parsing of JSON request bodies
app.use(express.json());
// Serve static files from the current directory
// This allows serving the index.html and any other static files directly
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// POST endpoint for AI suggestions
app.post('/ask', async (req, res) => {
  const { data } = req.body;

  // Validate incoming request data
  if (!data) {
    return res.status(400).json({ error: "Missing input data in request body." });
  }

  try {
    // Initialize Google Generative AI with your API key
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);

    // Choose the model: 'gemini-pro' for general high-quality text, 'gemini-2.0-flash' for faster response
    // You can experiment with which model works best for your specific use cases.
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // Using gemini-2.0-flash for faster response

    // Generate content based on the provided prompt
    const result = await model.generateContent({
      contents: [{
        parts: [{
          text: `You are an intelligent AI assistant, like a copilot, designed to help users complete their thoughts or fix their text within a web input field.
The user's current input in the text field is:

"${data}"

Based on this 'Current Input', provide a direct continuation, completion, or correction.
Your response MUST strictly follow this format:
---SNIPPET---
<The exact text that should be suggested to append to the 'Current Input'. This should be concise and directly extend the user's current line or thought. If no meaningful suggestion, leave empty.>
---FULLCODE---
<The complete, updated text that would be in the input field if the SNIPPET is accepted and appended to the 'Current Input'. This is essentially 'Current Input' + 'SNIPPET'. If no meaningful suggestion, this should be the 'Current Input' itself.>
Both full code and snippet should be formatted correctly, with proper indentation and line breaks as needed.
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

    // Extract the text content from the Gemini response
    // Using optional chaining to safely access properties
    const response = result.response;
    const text = response?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse the Gemini response to extract snippet and fullCode
    // Regex is designed to handle potential newlines within the sections
    const snippetMatch = text.match(/---SNIPPET---\n([\s\S]*?)\n---FULLCODE---/);
    const fullCodeMatch = text.match(/---FULLCODE---\n([\s\S]*)/);

    const snippet = snippetMatch && snippetMatch[1] ? snippetMatch[1].trim() : "";
    const fullCode = fullCodeMatch && fullCodeMatch[1] ? fullCodeMatch[1].trim() : "";

    

    // Send the parsed snippet and fullCode back to the client (Chrome Extension)
    res.json({ snippet, fullCode });

  } catch (error) {
    // Log the error on the server side for internal debugging
    console.error('Error generating content from Gemini API:', error);

    // Send a more informative error message to the client
    res.status(500).json({ error: 'Failed to generate content from AI.', details: error.message });
  }
});

// Start the Express server
const PORT = process.env.PORT || 5000; // Use port from environment variable or default to 5000
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
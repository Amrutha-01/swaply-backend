const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const PROMPT_TEMPLATE = `
You are an advanced document parsing AI engine. Your sole function is to analyze the provided document and extract all promotional coupon offers.

You MUST return the data as a single, valid JSON object that contains one key: "coupons". This key's value must be a JSON array. Each object within the array must conform to the following exact schema:

- "platform": (string) The name of the merchant or platform.
- "category": (string) The type of coupons (example: Shopping, Food, etc)
- "summary": (string) A concise one-sentence description of the offer.
- "coupon_code": (string | null) The coupon code, or null if not present.
- "value": (string) The discount rate or value of the coupon (eg: 100 rupees, 10%,etc)
- "expiry_date": (string) The expiration date in "YYYY-MM-DD" format.
- "source_document": (string) The name of the file this was extracted from.

If the document contains no coupons, return an empty array: {"coupons": []}.
Only return the raw JSON object without any extra text or markdown formatting.`;

/**
 * Analyzes a document using the Gemini Pro Vision model and extracts coupon data.
 * @param {string} filePath - The path to the local document (image or PDF).
 * @returns {Promise<object>} A promise that resolves to the parsed JSON object from the AI.
 */
async function extractCouponsFromDocument(filePath, mimeType, originalName) {
  const genAI = new GoogleGenerativeAI(process.env.API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });

  const promptParts = [
    {
      inlineData: {
        data: Buffer.from(fs.readFileSync(filePath)).toString("base64"),
        mimeType,
      },
    },
    {
      text: PROMPT_TEMPLATE.replace("source_document", `"${originalName}"`),
    },
  ];

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: promptParts }],
    });
    const responseText = result.response.text();

    const jsonString = responseText
      .trim()
      .replace(/^```json\n?/, "")
      .replace(/\n?```$/, "");
    const parsedJson = JSON.parse(jsonString);

    console.log("✅ AI Response Parsed:");
    console.log(JSON.stringify(parsedJson, null, 2));
    return parsedJson;
  } catch (error) {
    console.error("❌ Gemini error:", error);
    return { error: "Failed to extract data from the document." };
  }
}


module.exports= {extractCouponsFromDocument};
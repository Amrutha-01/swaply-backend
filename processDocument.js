const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");


const API_KEY = "AIzaSyA4skE0N_8l2DLcliAIdEkKlyvEEwTrqq0"; 
const aifile = 'gt.jpeg'; 


const PROMPT_TEMPLATE = `
You are an advanced document parsing AI engine. Your sole function is to analyze the provided document and extract all promotional coupon offers.

You MUST return the data as a single, valid JSON object that contains one key: "coupons". This key's value must be a JSON array. Each object within the array must conform to the following exact schema:

- "platform": (string) The name of the merchant or platform.
- "summary": (string) A concise one-sentence description of the offer.
- "coupon_code": (string | null) The coupon code, or null if not present.
- "expiry_date": (string) The expiration date in "YYYY-MM-DD" format.
- "source_document": (string) The name of the file this was extracted from.

If the document contains no coupons, return an empty array: {"coupons": []}.
Only return the raw JSON object without any extra text or markdown formatting.`;

/**
 * Analyzes a document using the Gemini Pro Vision model and extracts coupon data.
 * @param {string} filePath - The path to the local document (image or PDF).
 * @returns {Promise<object>} A promise that resolves to the parsed JSON object from the AI.
 */
async function extractCouponsFromDocument(filePath) {
  console.log(`Processing document with Gemini: ${filePath}`);

  const genAI = new GoogleGenerativeAI(API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });

  const mimeTypeMap = {
    ".pdf": "application/pdf", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  };
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = mimeTypeMap[extension];

  if (!mimeType) {
    throw new Error(`Unsupported file type: ${extension}`);
  }

  // Construct the multimodal request. The AI needs both the image data and the text prompt.
  // The file is read from disk and converted to a base64 string for transmission.
  const promptParts = [
    {
      inlineData: {
        data: Buffer.from(fs.readFileSync(filePath)).toString("base64"),
        mimeType,
      },
    },
    {
      text: PROMPT_TEMPLATE.replace(
        "source_document", `"${path.basename(filePath)}"`
      )
    },
  ];

  try {
    const result = await model.generateContent({ contents: [{ role: "user", parts: promptParts }] });
    const responseText = result.response.text();

    // The AI might occasionally wrap its response in markdown. This cleans it up.
    const jsonString = responseText.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const parsedJson = JSON.parse(jsonString);

    console.log("--- AI Response Parsed Successfully ---");
    console.log(JSON.stringify(parsedJson, null, 2));
    return parsedJson;

  } catch (error) {
    console.error("Error processing document with Gemini:", error);
    // This provides more detailed API error info for debugging if something goes wrong.
    if (error.response) {
      console.error(error.response.data);
    }
    return { error: "Failed to extract data from the document." };
  }
}


if (!fs.existsSync(aifile)) {
    console.error(`Error: File not found at '${aifile}'. Please create it or change the filename.`);
} else {
  extractCouponsFromDocument(aifile);
}

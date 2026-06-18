require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const { z } = require('zod');
const zodToJsonSchema = require('zod-to-json-schema').zodToJsonSchema;

const generatedSqlSchema = z.object({
  title: z.string(),
  summary: z.string(),
  sql: z.string(),
  assumptions: z.array(z.string()),
});

async function testGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  const ai = new GoogleGenAI({ apiKey });
  
  try {
    const jsonSchema = zodToJsonSchema(generatedSqlSchema);
    const { $schema, ...responseJsonSchema } = jsonSchema;
    console.log(JSON.stringify(responseJsonSchema, null, 2));

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: 'genera un esquema sql simple para un blog',
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema,
        temperature: 0.2,
      }
    });
    console.log('Gemini OK:', response.text);
  } catch (e) {
    console.error('Gemini Error:', e.message);
  }
}

testGemini();

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type } from "@google/genai";
import type { GenerateContentResponse } from "@google/genai";

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable is not set");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });


// --- Type Definitions ---
export interface OutfitAnalysis {
    bodyShape: string;
    reason: string;
    outfits: string[];
}

// --- Helper Functions ---

/**
 * Creates a fallback prompt to use when the primary one is blocked.
 * @param outfit The outfit string (e.g., "A-line dress").
 * @returns The fallback prompt string.
 */
function getFallbackOutfitPrompt(outfit: string): string {
    return `Create a photograph of the person in this image wearing a ${outfit}. The photograph should capture the style realistically. Ensure the final image is a clear photograph that looks authentic.`;
}

/**
 * Processes the Gemini API response, extracting the image or throwing an error if none is found.
 * @param response The response from the generateContent call.
 * @returns A data URL string for the generated image.
 */
function processGeminiResponse(response: GenerateContentResponse): string {
    const imagePartFromResponse = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

    if (imagePartFromResponse?.inlineData) {
        const { mimeType, data } = imagePartFromResponse.inlineData;
        return `data:${mimeType};base64,${data}`;
    }

    const textResponse = response.text;
    console.error("API did not return an image. Response:", textResponse);
    throw new Error(`The AI model responded with text instead of an image: "${textResponse || 'No text response received.'}"`);
}

/**
 * A wrapper for the Gemini API call that includes a retry mechanism for internal server errors.
 * @param imagePart The image part of the request payload.
 * @param textPart The text part of the request payload.
 * @returns The GenerateContentResponse from the API.
 */
async function callGeminiWithRetry(imagePart: object, textPart: object): Promise<GenerateContentResponse> {
    const maxRetries = 3;
    const initialDelay = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await ai.models.generateContent({
                model: 'gemini-2.5-flash-image-preview',
                contents: { parts: [imagePart, textPart] },
            });
        } catch (error) {
            console.error(`Error calling Gemini API (Attempt ${attempt}/${maxRetries}):`, error);
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
            const isInternalError = errorMessage.includes('"code":500') || errorMessage.includes('INTERNAL');

            if (isInternalError && attempt < maxRetries) {
                const delay = initialDelay * Math.pow(2, attempt - 1);
                console.log(`Internal error detected. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw error; // Re-throw if not a retriable error or if max retries are reached.
        }
    }
    // This should be unreachable due to the loop and throw logic above.
    throw new Error("Gemini API call failed after all retries.");
}


/**
 * Analyzes a user's body from an image and suggests 6 suitable outfits.
 * @param imageDataUrl The data URL of the user's image.
 * @param excludedOutfits A list of outfits to exclude from suggestions.
 * @returns A promise resolving to a OutfitAnalysis object.
 */
export async function analyzeBodyAndSuggestOutfits(
    imageDataUrl: string,
    excludedOutfits: string[] = []
): Promise<OutfitAnalysis> {
    const match = imageDataUrl.match(/^data:(image\/\w+);base64,(.*)$/);
    if (!match) {
        throw new Error("Invalid image data URL format. Expected 'data:image/...;base64,...'");
    }
    const [, mimeType, base64Data] = match;

    const imagePart = {
        inlineData: {
            mimeType,
            data: base64Data,
        },
    };

    const excludedOutfitsText = excludedOutfits.length > 0
        ? `Do not suggest any of the following outfits: ${excludedOutfits.join(', ')}.`
        : '';

    const textPart = {
        text: `Analyze the person's body shape in this image. Based on their body shape, suggest exactly 6 specific, distinct, and flattering clothing outfits. Be creative with the outfit descriptions.
        Your response must be a JSON object.
        ${excludedOutfitsText}
        Ensure the output is only the JSON object, with no extra text or markdown formatting.`
    };

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [imagePart, textPart] },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    bodyShape: {
                        type: Type.STRING,
                        description: "A concise description of the identified body shape (e.g., 'Pear', 'Hourglass')."
                    },
                    reason: {
                        type: Type.STRING,
                        description: "A brief, 1-2 sentence explanation of why the suggested outfits are suitable for this body shape."
                    },
                    outfits: {
                        type: Type.ARRAY,
                        description: "An array of exactly 6 short, descriptive strings for the suggested outfits (e.g., 'A-line floral sundress').",
                        items: { type: Type.STRING }
                    }
                },
                required: ["bodyShape", "reason", "outfits"]
            }
        }
    });

    try {
        let jsonString = response.text.trim();
        // The model can sometimes wrap the JSON in ```json ... ```.
        if (jsonString.startsWith("```json")) {
            jsonString = jsonString.slice(7, -3).trim();
        } else if (jsonString.startsWith("```")) {
            jsonString = jsonString.slice(3, -3).trim();
        }
        
        const result: OutfitAnalysis = JSON.parse(jsonString);

        if (!result.bodyShape || !result.reason || !result.outfits || !Array.isArray(result.outfits) || result.outfits.length !== 6) {
             console.error("Invalid JSON structure or outfit count from API. Response:", result);
             throw new Error("Invalid JSON structure received from API.");
        }

        return result;

    } catch (e) {
        console.error("Failed to parse JSON response from Gemini:", response.text, e);
        throw new Error("The AI failed to return a valid analysis. Please try again.");
    }
}

/**
 * Generates an image of a person wearing a specific outfit.
 * @param imageDataUrl The data URL of the original image of the person.
 * @param outfit A string describing the outfit.
 * @returns A promise resolving to a data URL string of the generated image.
 */
export async function generateOutfitImage(imageDataUrl: string, outfit: string): Promise<string> {
    const match = imageDataUrl.match(/^data:(image\/\w+);base64,(.*)$/);
    if (!match) {
        throw new Error("Invalid image data URL format. Expected 'data:image/...;base64,...'");
    }
    const [, mimeType, base64Data] = match;

    const imagePart = {
        inlineData: {
            mimeType,
            data: base64Data,
        },
    };

    const primaryPrompt = `Generate a photorealistic image of the person from the user's image wearing the following outfit: "${outfit}". The generated person, including their body, face, and pose, must be identical to the person in the original photo. Only the clothing should be changed. The background should be a minimal, neutral studio backdrop.`;

    const textPart = { text: primaryPrompt };

    try {
        const response = await callGeminiWithRetry(imagePart, textPart);
        return processGeminiResponse(response);
    } catch (error) {
        console.error("Primary prompt failed, trying fallback:", error);
        // If the primary prompt is blocked or fails, try a simpler one.
        const fallbackPrompt = getFallbackOutfitPrompt(outfit);
        const fallbackTextPart = { text: fallbackPrompt };

        const fallbackResponse = await callGeminiWithRetry(imagePart, fallbackTextPart);
        return processGeminiResponse(fallbackResponse);
    }
}

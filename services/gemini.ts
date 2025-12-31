import { GoogleGenAI, Modality } from "@google/genai";

/**
 * Hàm khởi tạo AI an toàn cho môi trường Browser.
 * Tránh lỗi "process is not defined" thường gặp khi deploy lên Vercel.
 */
const getAiClient = () => {
  // Kiểm tra an toàn biến môi trường
  const env = typeof process !== 'undefined' ? process.env : (window as any).process?.env;
  const apiKey = env?.API_KEY;
  
  if (!apiKey) {
    console.error("API_KEY is missing in environment variables.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export const getSpeech = async (text: string, isVietnamese: boolean = false): Promise<string | null> => {
  try {
    const ai = getAiClient();
    if (!ai) return null;

    const prompt = isVietnamese 
      ? `Phát âm tiếng Việt rõ ràng: "${text}"` 
      : `Phát âm tiếng Jrai rõ ràng: "${text}"`;
      
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: isVietnamese ? 'Puck' : 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  } catch (error) {
    console.error("Lỗi Gemini TTS:", error);
    return null;
  }
};

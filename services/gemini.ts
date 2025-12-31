import { GoogleGenAI, Modality } from "@google/genai";

// Khởi tạo SDK chuẩn: Phải dùng named parameter { apiKey: process.env.API_KEY }
// Không định nghĩa model trước, gọi trực tiếp qua ai.models
const getAiClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export const explainWord = async (jraiWord: string, vietMeaning: string) => {
  try {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Giải thích chi tiết hơn về từ tiếng Jrai "${jraiWord}" (nghĩa là "${vietMeaning}"). Hãy cho biết ngữ cảnh sử dụng và ví dụ một câu đơn giản. Trả lời bằng tiếng Việt gọn gàng.`,
    });
    return response.text || "Không có giải thích nào từ AI.";
  } catch (error) {
    console.error("Lỗi Gemini:", error);
    return "Không thể kết nối với trí tuệ nhân tạo lúc này.";
  }
};

export const getSpeech = async (text: string, isVietnamese: boolean = false): Promise<string | null> => {
  try {
    const ai = getAiClient();
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

    // Lấy data audio từ inlineData
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  } catch (error) {
    console.error("Lỗi TTS:", error);
    return null;
  }
};

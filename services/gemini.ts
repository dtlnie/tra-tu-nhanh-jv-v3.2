import { GoogleGenAI, Modality } from "@google/genai";

// Khởi tạo SDK bên trong hàm để tránh lỗi ReferenceError: process is not defined khi load script trên một số môi trường
const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key không tồn tại. Vui lòng cấu hình environment variable.");
  }
  return new GoogleGenAI({ apiKey });
};

export const getSpeech = async (text: string, isVietnamese: boolean = false): Promise<string | null> => {
  try {
    const ai = getAiClient();
    const prompt = isVietnamese 
      ? `Phát âm tiếng Việt rõ ràng, tốc độ vừa phải: "${text}"` 
      : `Phát âm tiếng dân tộc Jrai rõ ràng, chuẩn xác: "${text}"`;
      
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            // Puck cho tiếng Việt, Kore cho tiếng dân tộc để có âm sắc phù hợp
            prebuiltVoiceConfig: { voiceName: isVietnamese ? 'Puck' : 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  } catch (error) {
    console.error("Lỗi tạo âm thanh:", error);
    return null;
  }
};


import { GoogleGenAI, Modality } from "@google/genai";

// khởi tạo gemini client - @google/genai guideline: must use new GoogleGenAI({ apiKey: process.env.API_KEY })
const getAi = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

// hàm giải thích từ vựng dùng ai
export const explainWord = async (jraiWord: string, vietMeaning: string) => {
  try {
    const ai = getAi();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Giải thích chi tiết hơn về từ tiếng Jrai "${jraiWord}" (nghĩa là "${vietMeaning}"). Hãy cho biết ngữ cảnh sử dụng và ví dụ một câu đơn giản. Trả lời bằng tiếng Việt.`,
    });
    // @google/genai guideline: use .text property
    return response.text;
  } catch (error) {
    console.error("Lỗi khi gọi Gemini:", error);
    return "Không thể lấy giải thích từ AI vào lúc này.";
  }
};

// hàm phát âm dùng gemini tts
export const getSpeech = async (text: string, isVietnamese: boolean = false): Promise<string | null> => {
  try {
    const ai = getAi();
    // prompt cụ thể hơn để tránh model hiểu nhầm ngôn ngữ
    const prompt = isVietnamese 
      ? `Hãy phát âm chuẩn xác từng chữ tiếng Việt sau đây một cách rõ ràng: "${text}"` 
      : `Hãy phát âm rõ ràng từ vựng tiếng dân tộc Jrai sau đây: "${text}"`;
      
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            // sử dụng Puck cho tiếng việt/á đông để có giọng tự nhiên hơn
            prebuiltVoiceConfig: { voiceName: isVietnamese ? 'Puck' : 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    // Return raw base64 string for PCM decoding as per guidelines
    return base64Audio || null;
  } catch (error) {
    console.error("Lỗi khi tạo âm thanh:", error);
    return null;
  }
};

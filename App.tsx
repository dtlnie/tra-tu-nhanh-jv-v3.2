import React, { useState, useEffect, useCallback } from 'react';
import { Dictionary, TabType, WordEntry } from './types';
import { DEFAULT_DICTIONARY, DiscordIcon, SpeakerIcon } from './constants';
import { explainWord, getSpeech } from './services/gemini';

// Singleton AudioContext để tối ưu hiệu năng và tránh lỗi delay khi phát nhiều lần
let globalAudioCtx: AudioContext | null = null;

function getAudioContext() {
  if (!globalAudioCtx) {
    globalAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  }
  // luôn resume để đảm bảo context hoạt động sau tương tác người dùng
  if (globalAudioCtx.state === 'suspended') {
    globalAudioCtx.resume();
  }
  return globalAudioCtx;
}

// decode base64 cho audio pcm
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// hàm giải mã audio data thô sang AudioBuffer
async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

interface QuizItem extends WordEntry {
  questionSide: 'jrai' | 'viet';
  userInput: string;
  status: 'none' | 'correct' | 'wrong';
  isTesting: boolean;
}

const WordCard: React.FC<{ entry: WordEntry; onExplain?: () => void }> = ({ entry, onExplain }) => {
  const [playing, setPlaying] = useState(false);

  const handlePlay = async (text: string, isViet: boolean) => {
    try {
      if (playing) return;
      setPlaying(true);
      
      const audioCtx = getAudioContext();
      const audioBase64 = await getSpeech(text, isViet);
      
      if (!audioBase64) {
        alert("Chưa cập nhật được âm thanh, hãy liên hệ Admin để đóng góp.");
        setPlaying(false);
        return;
      }

      const bytes = decode(audioBase64);
      const buffer = await decodeAudioData(bytes, audioCtx, 24000, 1);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.onended = () => setPlaying(false);
      source.start(0);
    } catch (err) {
      console.error(err);
      setPlaying(false);
    }
  };

  return (
    <div className="bg-white rounded-xl p-5 mb-3 shadow-sm border-l-4 border-orange-600 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-xl font-bold text-orange-900">{entry.jrai}</h3>
            <button 
              onClick={() => handlePlay(entry.jrai, false)}
              disabled={playing}
              className={`p-1.5 rounded-full hover:bg-orange-100 transition-colors ${playing ? 'text-orange-300' : 'text-orange-600'}`}
              title="Phát âm tiếng Jrai"
            >
              <SpeakerIcon />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-gray-700 font-medium">{entry.viet}</p>
            <button 
              onClick={() => handlePlay(entry.viet, true)}
              disabled={playing}
              className={`p-1.5 rounded-full hover:bg-orange-50 transition-colors ${playing ? 'text-gray-300' : 'text-gray-400'}`}
              title="Phát âm tiếng Việt"
            >
              <SpeakerIcon />
            </button>
          </div>
        </div>
        {onExplain && (
          <button 
            onClick={onExplain}
            className="text-xs bg-orange-100 text-orange-700 px-3 py-1 rounded-full hover:bg-orange-200 ml-2 shrink-0 font-bold"
          >
            Giải thích AI
          </button>
        )}
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [dictionary, setDictionary] = useState<Dictionary>(DEFAULT_DICTIONARY);
  const [activeTab, setActiveTab] = useState<TabType>(TabType.SEARCH);
  const [searchQuery, setSearchQuery] = useState('');
  const [quizWords, setQuizWords] = useState<QuizItem[]>([]);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [securityKey, setSecurityKey] = useState('');

  const normalize = (str: string) => {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  };

  // Tải dữ liệu từ LocalStorage
  useEffect(() => {
    const saved = localStorage.getItem('tu_dien_jrai_v14');
    if (saved) {
      try {
        setDictionary(JSON.parse(saved));
      } catch (e) {
        console.error("Lỗi đọc dữ liệu");
      }
    }
  }, []);

  // Lưu dữ liệu vào LocalStorage khi có thay đổi
  useEffect(() => {
    localStorage.setItem('tu_dien_jrai_v14', JSON.stringify(dictionary));
  }, [dictionary]);

  // Lấy 6 từ ngẫu nhiên cho tab học
  const refreshQuiz = useCallback(() => {
    const keys = Object.keys(dictionary);
    const shuffled = [...keys].sort(() => 0.5 - Math.random());
    const items: QuizItem[] = shuffled.slice(0, 6).map(k => ({
      ...dictionary[k],
      questionSide: 'jrai', // Mặc định hiển thị Jrai ở câu hỏi
      userInput: '',
      status: 'none',
      isTesting: false
    }));
    setQuizWords(items);
  }, [dictionary]);

  useEffect(() => {
    if (activeTab === TabType.LEARN) {
      refreshQuiz();
    }
  }, [activeTab, refreshQuiz]);

  // Chế độ kiểm tra: Trộn lẫn jrai-to-viet và viet-to-jrai
  const startTesting = () => {
    setQuizWords(prev => prev.map(item => ({
      ...item,
      isTesting: true,
      questionSide: Math.random() > 0.5 ? 'jrai' : 'viet',
      status: 'none',
      userInput: ''
    })));
  };

  // Kiểm tra kết quả tất cả các câu hỏi
  const handleCheckResults = () => {
    setQuizWords(prev => prev.map(item => {
      if (!item.isTesting) return item;
      const correctAnswer = item.questionSide === 'jrai' ? item.viet : item.jrai;
      const isCorrect = normalize(item.userInput) === normalize(correctAnswer);
      return { ...item, status: isCorrect ? 'correct' : 'wrong' };
    }));
  };

  const updateQuizValue = (idx: number, val: string) => {
    setQuizWords(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], userInput: val, status: 'none' };
      return next;
    });
  };

  // Tìm kiếm khớp hoàn toàn Jrai hoặc Việt
  const getFiltered = () => {
    if (!searchQuery.trim()) return [];
    const query = normalize(searchQuery);
    return Object.values(dictionary).filter(w => 
      normalize(w.jrai) === query || normalize(w.viet) === query
    );
  };

  const filteredResults = getFiltered();

  const handleExplain = async (word: WordEntry) => {
    setLoadingAi(true);
    setAiExplanation(null);
    const text = await explainWord(word.jrai, word.viet);
    setAiExplanation(`**${word.jrai}**: ${text}`);
    setLoadingAi(false);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-40">
      {/* header tiêu đề */}
      <header className="bg-gradient-to-br from-orange-800 to-orange-600 text-white p-8 rounded-2xl shadow-xl text-center mb-8">
        <h1 className="text-3xl font-black tracking-tight uppercase">Tra Từ Nhanh Jrai - Việt</h1>
        <p className="mt-2 text-orange-100 italic">Bảo tồn di sản văn hóa dân tộc Jrai (v1.4)</p>
      </header>

      {/* thống kê kho dữ liệu */}
      <div className="bg-white rounded-xl p-4 shadow-sm flex items-center justify-center mb-8 gap-3 border border-orange-50">
        <span className="text-3xl font-black text-orange-600 tracking-tighter">{Object.keys(dictionary).length}</span>
        <span className="text-gray-600 font-bold text-sm">từ trong kho dữ liệu</span>
      </div>

      {/* tabs điều hướng */}
      <nav className="flex bg-white p-1 rounded-xl shadow-sm mb-6 overflow-x-auto border border-gray-100">
        {Object.values(TabType).map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setAiExplanation(null); }}
            className={`flex-1 min-w-[100px] py-3.5 px-4 rounded-lg font-black transition-all text-xs uppercase tracking-widest ${
              activeTab === tab ? 'bg-orange-600 text-white shadow-lg' : 'text-gray-400 hover:bg-orange-50'
            }`}
          >
            {tab}
          </button>
        ))}
      </nav>

      {/* nội dung các tab */}
      <main className="min-h-[450px]">
        {activeTab === TabType.SEARCH && (
          <section className="animate-in fade-in duration-300">
            <h2 className="text-lg font-black text-gray-800 mb-4 uppercase tracking-tight">Tra cứu từ vựng</h2>
            <input 
              type="text" 
              placeholder="Nhập từ Jrai hoặc tiếng Việt cần tra..."
              className="w-full p-4 rounded-2xl border-2 border-orange-100 focus:border-orange-500 outline-none transition-all shadow-sm mb-6"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            {aiExplanation && (
              <div className="bg-orange-50 border-l-4 border-orange-500 p-5 mb-6 rounded-r-2xl shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <span className="font-black text-orange-800 text-sm uppercase flex items-center gap-2">
                    <span className="text-xl">💡</span> Giải thích từ AI
                  </span>
                  <button onClick={() => setAiExplanation(null)} className="text-gray-400 hover:text-gray-600 p-1">✕</button>
                </div>
                <p className="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap">{aiExplanation}</p>
              </div>
            )}

            {loadingAi && <div className="text-center py-4 text-orange-600 italic animate-pulse font-bold">Đang phân tích dữ liệu...</div>}

            <div className="space-y-3">
              {searchQuery.trim() && filteredResults.length === 0 ? (
                <div className="bg-yellow-50 p-8 rounded-2xl border border-yellow-100 text-yellow-800 text-sm font-medium leading-relaxed">
                  Từ bạn nhập chưa được cập nhật hoặc đã sai, hãy liên hệ Admin để được hỗ trợ.
                </div>
              ) : (
                filteredResults.map((w, i) => <WordCard key={i} entry={w} onExplain={() => handleExplain(w)} />)
              )}
              {!searchQuery.trim() && (
                <div className="text-center py-24 text-gray-300">
                  <p className="italic font-medium">Nhập từ vựng vào ô tìm kiếm để tra cứu nghĩa.</p>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === TabType.LEARN && (
          <section className="animate-in slide-in-from-bottom-4 duration-300">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-8 gap-4">
              <h2 className="text-lg font-black text-gray-800 uppercase tracking-tight">Học tập & Kiểm tra (6 từ)</h2>
              <div className="flex gap-2 w-full sm:w-auto">
                <button 
                  onClick={startTesting}
                  className="flex-1 sm:flex-none bg-orange-100 text-orange-800 px-5 py-2.5 rounded-xl font-black text-[10px] uppercase hover:bg-orange-200 transition-all shadow-sm"
                >
                  Bắt đầu kiểm tra
                </button>
                <button 
                  onClick={handleCheckResults}
                  className="flex-1 sm:flex-none bg-green-600 text-white px-5 py-2.5 rounded-xl font-black text-[10px] uppercase hover:bg-green-700 transition-all shadow-md"
                >
                  Kiểm tra tất cả
                </button>
                <button 
                  onClick={refreshQuiz}
                  className="flex-1 sm:flex-none bg-orange-600 text-white px-5 py-2.5 rounded-xl font-black text-[10px] uppercase hover:bg-orange-700 transition-all shadow-md"
                >
                  Đổi 6 từ khác
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {quizWords.map((item, i) => (
                <div key={i} className="bg-white rounded-2xl p-6 shadow-sm border-l-4 border-orange-500 relative transition-all hover:shadow-md min-h-[140px]">
                  {!item.isTesting ? (
                    <div>
                      <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest block mb-1">Ghi nhớ #{i+1}</span>
                      <h3 className="text-xl font-black text-orange-900">{item.jrai}</h3>
                      <p className="text-gray-600 font-bold text-sm mt-1">{item.viet}</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-orange-300 uppercase tracking-widest">Câu hỏi #{i+1}</span>
                        <span className="text-[9px] font-bold text-gray-400 italic">Dịch sang {item.questionSide === 'jrai' ? 'Tiếng Việt' : 'Tiếng Jrai'}</span>
                      </div>
                      <div className="text-xl font-black text-orange-900 uppercase">
                        {item.questionSide === 'jrai' ? item.jrai : item.viet}
                      </div>
                      <div className="relative">
                        <input 
                          type="text"
                          className={`w-full p-3 border-2 rounded-xl outline-none transition-all font-bold text-sm ${
                            item.status === 'correct' ? 'border-green-500 bg-green-50 text-green-700' : 
                            item.status === 'wrong' ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-100 focus:border-orange-400'
                          }`}
                          placeholder="Nhập từ còn lại..."
                          value={item.userInput}
                          onChange={(e) => updateQuizValue(i, e.target.value)}
                        />
                        {item.status === 'correct' && <p className="text-[10px] text-green-600 font-black mt-1 uppercase tracking-tighter">Chính xác!</p>}
                        {item.status === 'wrong' && (
                          <div className="mt-2 bg-red-50 p-2 rounded-lg">
                            <p className="text-[9px] text-red-600 font-black uppercase">Sai rồi!</p>
                            <p className="text-[10px] text-gray-500 font-bold leading-tight">Đáp án: {item.questionSide === 'jrai' ? item.viet : item.jrai}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === TabType.MANAGE && (
          <section className="animate-in fade-in duration-300 max-w-xl mx-auto">
            <h2 className="text-lg font-black text-gray-800 mb-6 uppercase tracking-tight">Thêm từ mới vào từ điển</h2>
            <div className="bg-white p-8 rounded-3xl shadow-sm space-y-5 border border-gray-100">
               <div>
                 <label className="block text-xs font-black text-gray-400 uppercase mb-2 ml-1">Tiếng Jrai</label>
                 <input id="new-jrai" type="text" className="w-full p-4 rounded-2xl border-2 border-gray-50 outline-none focus:border-orange-500 transition-all font-bold" />
               </div>
               <div>
                 <label className="block text-xs font-black text-gray-400 uppercase mb-2 ml-1">Nghĩa tiếng Việt</label>
                 <input id="new-viet" type="text" className="w-full p-4 rounded-2xl border-2 border-gray-50 outline-none focus:border-orange-500 transition-all font-bold" />
               </div>
               <button 
                 onClick={() => {
                   const j = (document.getElementById('new-jrai') as HTMLInputElement).value;
                   const v = (document.getElementById('new-viet') as HTMLInputElement).value;
                   if (j && v) {
                     setDictionary(prev => ({...prev, [normalize(j)]: {jrai: j, viet: v}}));
                     (document.getElementById('new-jrai') as HTMLInputElement).value = '';
                     (document.getElementById('new-viet') as HTMLInputElement).value = '';
                     alert("Đã thêm từ vựng mới vào kho lưu trữ trên thiết bị này.");
                   } else { alert("Vui lòng điền đủ thông tin."); }
                 }}
                 className="w-full bg-orange-600 text-white py-5 rounded-2xl font-black hover:bg-orange-700 shadow-xl transition-all uppercase tracking-widest"
               >
                 Cập nhật từ mới
               </button>
            </div>
          </section>
        )}

        {activeTab === TabType.DATA && (
          <section className="animate-in fade-in duration-300 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                <h3 className="font-black text-orange-800 uppercase text-sm mb-4 tracking-tight">Xuất dữ liệu</h3>
                <div className="mb-5">
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 ml-1">Mã bảo mật (Admin)</label>
                  <input 
                    type="password"
                    placeholder="Nhập mã để tải file..."
                    className="w-full p-4 border-2 border-gray-50 rounded-2xl text-sm outline-none focus:border-orange-500 transition-all font-bold"
                    value={securityKey}
                    onChange={(e) => setSecurityKey(e.target.value)}
                  />
                  <p className="text-[10px] text-gray-400 mt-2 italic leading-tight">Liên hệ Admin để được cấp mã bảo mật khi cần xuất dữ liệu hệ thống.</p>
                </div>
                <button 
                  onClick={() => {
                    if (securityKey !== 'JRAI2025') { alert("Sai mã bảo mật! Vui lòng liên hệ Admin."); return; }
                    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dictionary, null, 2));
                    const link = document.createElement('a');
                    link.setAttribute("href", dataStr);
                    link.setAttribute("download", "tu_dien_jrai_2025.json");
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                  }}
                  className="w-full py-4 px-4 bg-orange-100 text-orange-800 rounded-2xl font-black hover:bg-orange-200 transition-colors uppercase text-[10px] tracking-widest"
                >
                  Tải dữ liệu file JSON
                </button>
              </div>

              <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                <h3 className="font-black text-orange-800 uppercase text-sm mb-4 tracking-tight">Nhập dữ liệu</h3>
                <p className="text-[10px] text-gray-400 font-medium mb-6 leading-relaxed">Đồng bộ kho dữ liệu từ một file JSON đã xuất trước đó. Không yêu cầu mã bảo mật.</p>
                <input 
                  type="file" 
                  accept=".json"
                  className="w-full text-xs text-gray-500 file:mr-4 file:py-3 file:px-6 file:rounded-full file:border-0 file:text-[10px] file:font-black file:bg-orange-50 file:text-orange-800 hover:file:bg-orange-100 cursor-pointer"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        try {
                          const json = JSON.parse(ev.target?.result as string);
                          setDictionary(json);
                          alert("Đã nhập dữ liệu thành công!");
                        } catch (err) { alert("File JSON không hợp lệ!"); }
                      };
                      reader.readAsText(file);
                    }
                  }}
                />
              </div>
            </div>

            <div className="bg-red-50 p-8 rounded-3xl border-2 border-red-100 shadow-sm">
              <h3 className="font-black text-red-800 uppercase text-xs mb-2">Reset từ điển</h3>
              <p className="text-xs text-red-600/80 mb-6 font-medium">Hành động này xóa toàn bộ các từ vựng bạn tự thêm và quay lại dữ liệu gốc của hệ thống (v1.4).</p>
              <button 
                onClick={() => { if (confirm("Xác nhận reset toàn bộ?")) { setDictionary(DEFAULT_DICTIONARY); } }}
                className="bg-red-600 text-white px-10 py-4 rounded-2xl font-black hover:bg-red-700 shadow-lg active:scale-95 transition-all text-[10px] uppercase tracking-widest"
              >
                Khôi phục mặc định
              </button>
            </div>
          </section>
        )}
      </main>

      {/* footer chân trang - các nút mạng xã hội */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-100 p-5 shadow-2xl z-50">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row gap-4 items-center justify-between">
          <p className="text-[10px] text-gray-400 font-black uppercase tracking-tighter">© 2025 Jrai-Viet Dictionary - Bảo tồn văn hóa dân tộc</p>
          <div className="flex gap-2.5 w-full sm:w-auto">
            <a href="https://discord.gg/TpjGV3EHt" target="_blank" rel="noopener noreferrer" className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-[#5865F2] text-white px-6 py-3 rounded-2xl text-[10px] font-black uppercase hover:scale-105 active:scale-95 transition-transform shadow-lg"><DiscordIcon /> Cộng đồng</a>
            <a href="https://discord.gg/2qK6P5FW" target="_blank" rel="noopener noreferrer" className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-gray-800 text-white px-6 py-3 rounded-2xl text-[10px] font-black uppercase hover:scale-105 active:scale-95 transition-transform shadow-lg"><DiscordIcon /> Liên hệ Admin</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;

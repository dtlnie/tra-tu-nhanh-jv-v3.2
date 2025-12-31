
// định nghĩa cấu trúc dữ liệu từ điển
export interface WordEntry {
  jrai: string;
  viet: string;
  audio?: string; // base64 encoded mp3 string
}

export type Dictionary = Record<string, WordEntry>;

export enum TabType {
  SEARCH = 'TRA CỨU',
  LEARN = 'HỌC TỪ',
  MANAGE = 'QUẢN LÝ',
  DATA = 'DỮ LIỆU'
}

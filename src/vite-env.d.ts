declare module '*.css';

interface SpeechRecognitionResultItem { transcript: string; confidence: number }
interface SpeechRecognitionAlternativeList { 0: SpeechRecognitionResultItem; isFinal: boolean; length: number }
interface SpeechRecognitionEvent extends Event { results: SpeechRecognitionAlternativeList[]; resultIndex: number }
declare class SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: Event) => void) | null;
  start(): void;
  stop(): void;
}

// src/hooks/useChromeAI.ts
import { useState, useRef, useCallback } from 'react';

interface ChromeAIProps {
  langName: { src: string; tgt: string };
  addLog: (text: string, type: 'info' | 'success' | 'error') => void;
}

export const useChromeAI = ({ langName, addLog }: ChromeAIProps) => {
  const [translator, setTranslator] = useState<any>(null);
  const [translatedText, setTranslatedText] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  
  const isTranslatingRef = useRef(false);
  const pendingTextRef = useRef<string | null>(null);

  // 1. 번역 엔진(Translator) 초기화 함수
  const initTranslator = useCallback(async () => {
    addLog("▶ Chrome 내장 언어 AI(Translator) 연결 중...", "info");
    const pair = { sourceLanguage: 'ja', targetLanguage: 'ko' }; // 필요시 langName 활용 가능
    let translatorInstance = null;

    try {
      if ('Translator' in window) {
        translatorInstance = await (window as any).Translator.create(pair);
      } else if ('ai' in window && 'translator' in (window as any).ai) {
        translatorInstance = await (window as any).ai.translator.create(pair);
      } else if ('translation' in window) {
        const canTranslate = await (window as any).translation.canTranslate(pair);
        if (canTranslate !== 'no') {
          translatorInstance = await (window as any).translation.createTranslator(pair);
        }
      }

      if (!translatorInstance) throw new Error("Chrome 번역 API를 찾을 수 없습니다.");
      
      setTranslator(translatorInstance);
      return translatorInstance;
    } catch (e: any) {
      addLog(`❌ 번역 엔진 로드 실패: ${e.message}`, "error");
      return null;
    }
  }, [addLog]);

  // 2. 텍스트 번역 실행 함수 (Gemini Nano + 기본 API 백업)
  const processTranslation = useCallback((rawText: string) => {
    if (!translator || !rawText) return;
    
    // 대기열에 최신 텍스트 등록
    pendingTextRef.current = rawText;

    const processQueue = async () => {
      // 이미 번역 중이거나 대기열이 비어있으면 중단
      if (isTranslatingRef.current || !pendingTextRef.current) return;

      isTranslatingRef.current = true;
      setIsTranslating(true);

      const textToTranslate = pendingTextRef.current;
      pendingTextRef.current = null; // 대기열 비우기

      try {
        let finalTranslation = "";

        // 1단계: Gemini Nano (오타 교정 + 고유명사 음차)
        if ('ai' in window && 'languageModel' in (window as any).ai) {
          try {
            const nanoSession = await (window as any).ai.languageModel.create({
              systemPrompt: `너는 ${langName.src}를 ${langName.tgt}로 번역하는 전문 번역가야. 추출된 문장의 오타를 문맥에 맞게 교정하고 번역해 줘. 
가장 중요한 규칙: 지명, 인명, 역 이름 등 '고유명사'는 절대 뜻으로 번역하지 말고, 반드시 현지 발음대로 한국어로 음차(예: 東京 -> 도쿄)해서 작성해 줘. 어떠한 부연 설명 없이 최종 번역된 결과만 정확히 출력해.`
            });
            finalTranslation = await nanoSession.prompt(textToTranslate);
            nanoSession.destroy();
          } catch (nanoError) {
            console.warn("Gemini Nano 번역 실패, 기본 API로 대체:", nanoError);
          }
        }

        // 2단계: Nano 실패 시 기본 API로 백업
        if (!finalTranslation) {
          finalTranslation = await translator.translate(textToTranslate);
        }

        setTranslatedText(finalTranslation);

      } catch (e: any) {
        if (!e.message?.includes('channel closed')) {
          console.error("번역 연산 중 오류:", e);
        }
      } finally {
        isTranslatingRef.current = false;
        setIsTranslating(false);
        
        // 대기열에 새 텍스트가 들어왔다면 꼬리물기 실행
        if (pendingTextRef.current) {
          processQueue();
        }
      }
    };

    processQueue();
  }, [translator, langName]);

  return {
    translator,
    translatedText,
    isTranslating,
    setTranslatedText, // 초기화용
    initTranslator,
    processTranslation
  };
};
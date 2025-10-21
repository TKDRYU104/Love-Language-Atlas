"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QUESTIONS } from "@/app/questions";
type RecorderState = "idle" | "recording" | "transcribing" | "error";
type DiagnoseState = "idle" | "loading" | "done" | "error";
type StatusTone = "neutral" | "success" | "error";

type DebugLog = {
  id: string;
  at: number;
  event: string;
  detail?: string;
};

const DEBUG_ENABLED = process.env.NEXT_PUBLIC_DEBUG_LOG === "true";

interface DiagnosePick {
  id: string;
  term: string;
  lang: string;
  gloss: string;
  reason_ja: string;
  catch_ja: string;
}

interface DiagnoseResponse {
  analysis: {
    summary_ja: string;
    scores: Record<string, number>;
  };
  result: {
    pick?: DiagnosePick;
    picks?: DiagnosePick[];
  };
}

const RESULT_DISCLAIMER =
  "※ 診断は文化背景を断定するものではなく、個人差があります。";

const API_ERROR_MESSAGES: Record<string, string> = {
  invalid_request: "回答データの形式が正しくありません。ページを更新してやり直してください。",
  answer_required: "未回答の質問があります。すべての質問に回答してください。",
  invalid_yesno: "はい／いいえの回答形式が正しくありません。",
  duplicate_question: "同じ質問が重複しています。最初からやり直してください。",
  analyzer_parse_failed: "解析処理で問題が発生しました。少し時間を置いて再試行してください。",
  matcher_parse_failed: "結果の生成に失敗しました。時間を置いて再試行してください。",
  internal_error: "診断処理で予期しないエラーが発生しました。時間を置いて再試行してください。"
};

const YES = "はい" as const;
const NO = "いいえ" as const;

type YesNoOpenValue = {
  choice: typeof YES | typeof NO | "";
  note: string;
};

function decodeYesNoOpen(raw: string): YesNoOpenValue {
  if (!raw) return { choice: "", note: "" };
  try {
    const parsed = JSON.parse(raw) as Partial<YesNoOpenValue>;
    const choice = parsed?.choice === YES || parsed?.choice === NO ? parsed.choice : "";
    const note = typeof parsed?.note === "string" ? parsed.note : "";
    if (choice || note) {
      return { choice, note };
    }
  } catch {
    const trimmed = raw.trim();
    if (trimmed === YES || trimmed === NO) {
      return { choice: trimmed, note: "" };
    }
  }
  return { choice: "", note: raw };
}

function encodeYesNoOpen(value: YesNoOpenValue): string {
  return JSON.stringify({ choice: value.choice, note: value.note });
}

export default function Home() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>(() => QUESTIONS.map(() => ""));
  const answersRef = useRef<string[]>(answers);
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [diagnoseState, setDiagnoseState] = useState<DiagnoseState>("idle");
  const [result, setResult] = useState<DiagnoseResponse | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [debugCollapsed, setDebugCollapsed] = useState(true);

  const recogRef = useRef<SpeechRecognition | null>(null);
  const sessionBaseRef = useRef("");
  const finalRef = useRef("");
  const interimRef = useRef("");
  const manualStopRef = useRef(false);
  const recorderStateRef = useRef<RecorderState>("idle");
  const debugRef = useRef<DebugLog[]>([]);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const hasWebSpeech = useMemo(() => {
    if (typeof window === "undefined") return false;
    return "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
  }, []);

  useEffect(() => {
    recorderStateRef.current = recorderState;
  }, [recorderState]);

  useEffect(() => {
    return () => {
      if (recogRef.current) {
        recogRef.current.onend = null;
        recogRef.current.abort();
        recogRef.current = null;
      }
    };
  }, []);

  const updateAnswer = useCallback(
    (value: string) => {
      setAnswers((prev) => {
        const next = [...prev];
        next[currentIndex] = value;
        return next;
      });
    },
    [currentIndex]
  );

  const addDebugLog = useCallback((event: string, detail?: string) => {
    if (!DEBUG_ENABLED) return;
    const entry: DebugLog = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      event,
      detail
    };
    setDebugLogs((prev) => {
      const next = [...prev, entry].slice(-200);
      debugRef.current = next;
      return next;
    });
    if (detail) {
      console.debug(`[LoveAtlas DEBUG] ${event}`, detail);
    } else {
      console.debug(`[LoveAtlas DEBUG] ${event}`);
    }
  }, []);

  const ensureRecordingStopped = useCallback(() => {
    if (recorderStateRef.current === "recording") {
      setStatusMessage("録音を停止してから操作してください。");
      setStatusTone("error");
      addDebugLog("recording.blocked", "Operation attempted while recording");
      return false;
    }
    return true;
  }, [addDebugLog]);

  const stopRecognition = useCallback(
    (options?: { abort?: boolean; skipFinalize?: boolean }) => {
      const recognition = recogRef.current;
      if (!recognition) return;

      const shouldFinalize = !options?.skipFinalize && !options?.abort;
      manualStopRef.current = shouldFinalize;

      if (options?.skipFinalize) {
        recognition.onend = null;
      }

      if (shouldFinalize) {
        setRecorderState("transcribing");
      }

      if (options?.abort) {
        recognition.abort();
        recogRef.current = null;
        manualStopRef.current = false;
        setRecorderState("idle");
        return;
      }

      recognition.stop();
      if (options?.skipFinalize) {
        recogRef.current = null;
        setRecorderState("idle");
      }
    },
    []
  );

  const enterQuestion = useCallback(
    (index: number) => {
      const base = (answersRef.current[index] || "").trim();
      sessionBaseRef.current = base;
      finalRef.current = base;
      interimRef.current = "";
      manualStopRef.current = false;
      setStatusMessage(null);
      setStatusTone("neutral");
      setRecorderState("idle");
      setCurrentIndex(index);
      setDiagnoseState("idle");
      addDebugLog("question.enter", JSON.stringify({ index, question: QUESTIONS[index].text }));
    },
    [addDebugLog]
  );

  useEffect(() => {
    void enterQuestion(0);
  }, [enterQuestion]);

  const handleRecognitionEnd = useCallback(() => {
    if (!manualStopRef.current) {
      sessionBaseRef.current = finalRef.current.trim();
      finalRef.current = sessionBaseRef.current;
      interimRef.current = "";
      if (recorderStateRef.current === "recording") {
        const recognition = recogRef.current;
        if (!recognition) return;
        try {
          recognition.start();
          addDebugLog("recognition.auto_restart");
        } catch (error) {
          console.error("Speech restart error", error);
          recogRef.current = null;
          setRecorderState("error");
          setStatusMessage("音声認識が中断されました。もう一度録音を開始してください。");
          setStatusTone("error");
          addDebugLog("recognition.restart_error", error instanceof Error ? error.message : String(error));
        }
      } else {
        recogRef.current = null;
        setRecorderState("idle");
      }
      return;
    }

    const text = [finalRef.current, interimRef.current].filter(Boolean).join(" ").trim();
    sessionBaseRef.current = text;
    manualStopRef.current = false;
    finalRef.current = "";
    interimRef.current = "";
    recogRef.current = null;
    setRecorderState("idle");
    if (text) {
      updateAnswer(text);
      addDebugLog("recognition.manual_stop", text);
    } else {
      addDebugLog("recognition.manual_stop", "(empty result)");
    }
  }, [addDebugLog, updateAnswer]);

  const startRecognition = useCallback(() => {
    if (!hasWebSpeech) {
      setStatusMessage("録音に対応していない環境です。テキスト入力をご利用ください。");
      setStatusTone("error");
      addDebugLog("recognition.unsupported");
      return;
    }

    stopRecognition({ abort: true, skipFinalize: true });
    const base = (answers[currentIndex] || "").trim();
    sessionBaseRef.current = base;
    finalRef.current = base;
    interimRef.current = "";
    manualStopRef.current = false;
    setStatusMessage(null);
    setStatusTone("neutral");
    addDebugLog("recognition.start_request", JSON.stringify({ questionIndex: currentIndex }));

    try {
      // @ts-ignore - prefixed constructor support
      const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition: SpeechRecognition = new RecognitionCtor();
      recogRef.current = recognition;
      recognition.lang = "ja-JP";
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      // @ts-ignore continuous mode is available in Chrome/Webkit
      recognition.continuous = true;

      recognition.onerror = (event) => {
        console.error("Speech error", event);
        stopRecognition({ abort: true, skipFinalize: true });
        setRecorderState("error");
        setStatusMessage("音声認識で問題が発生しました。テキスト入力をお試しください。");
        setStatusTone("error");
        addDebugLog("recognition.error", event.error ?? "unknown");
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = "";
        const results = Array.from(event.results);
        for (let i = event.resultIndex; i < results.length; i += 1) {
          const transcript = results[i][0].transcript;
          if (!results[i].isFinal) {
            interim += transcript;
          }
        }

        const finalsText = results
          .filter((result) => result.isFinal)
          .map((result) => result[0].transcript.trim())
          .join(" ")
          .trim();

        finalRef.current = [sessionBaseRef.current, finalsText].filter(Boolean).join(" ").trim();
        interimRef.current = interim.trim();

        const combined = [finalRef.current, interimRef.current].filter(Boolean).join(" ").trim();
        updateAnswer(combined || sessionBaseRef.current);
        if (finalsText) {
          addDebugLog("recognition.final_update", finalsText);
        }
        if (interimRef.current) {
          addDebugLog("recognition.interim_update", interimRef.current);
        }
      };

      recognition.onend = () => {
        handleRecognitionEnd();
      };

      recognition.start();
      setRecorderState("recording");
      addDebugLog("recognition.started");
    } catch (error) {
      console.error("Speech start error", error);
      recogRef.current = null;
      setRecorderState("error");
      setStatusMessage("音声認識の初期化に失敗しました。別の環境をお試しください。");
      setStatusTone("error");
       addDebugLog(
        "recognition.start_error",
        error instanceof Error ? error.message : String(error)
      );
    }
  }, [
    addDebugLog,
    answers,
    currentIndex,
    handleRecognitionEnd,
    hasWebSpeech,
    stopRecognition,
    updateAnswer
  ]);

  const stopRecording = useCallback(() => {
    addDebugLog("recognition.stop_request");
    stopRecognition();
  }, [addDebugLog, stopRecognition]);

  const question = QUESTIONS[currentIndex];
  const isRecording = recorderState === "recording";
  const currentAnswer = answers[currentIndex] ?? "";
  const isLastQuestion = currentIndex === QUESTIONS.length - 1;
  const yesNoOpenValue: YesNoOpenValue =
    question?.type === "yesno+open" ? decodeYesNoOpen(currentAnswer) : { choice: "", note: "" };
  const selectedChoice = question?.type === "choice" ? currentAnswer : "";
  const trimmedOpenAnswer = question?.type === "open" ? currentAnswer.trim() : "";
  const isYesSelected = question?.type === "yesno" && currentAnswer === YES;
  const isNoSelected = question?.type === "yesno" && currentAnswer === NO;
  const isCurrentAnswered = (() => {
    if (!question) return false;
    switch (question.type) {
      case "yesno":
        return currentAnswer === YES || currentAnswer === NO;
      case "choice":
        return question.choices.includes(selectedChoice);
      case "yesno+open":
        return yesNoOpenValue.choice === YES || yesNoOpenValue.choice === NO;
      case "open":
      default:
        return trimmedOpenAnswer.length > 0;
    }
  })();
  const isSubmitDisabled =
    !isCurrentAnswered || (isLastQuestion && diagnoseState === "loading");
  const recorderLabel =
    recorderState === "recording"
      ? "録音停止"
      : recorderState === "transcribing"
      ? "文字起こし中"
      : recorderState === "error"
      ? "再試行"
      : "録音開始";
  const picks = useMemo(() => {
    const data = result?.result;
    if (!data) return [];
    if (Array.isArray(data.picks) && data.picks.length > 0) {
      return data.picks;
    }
    if (data.pick) {
      return [data.pick];
    }
    return [];
  }, [result]);
  const primaryPick = picks[0];
  const answerSummaries = useMemo(() => {
    return QUESTIONS.map((item, index) => {
      const raw = answers[index] ?? "";
      if (!raw) return "（未回答）";
      switch (item.type) {
        case "yesno": {
          return raw;
        }
        case "choice": {
          return raw;
        }
        case "yesno+open": {
          const parsed = decodeYesNoOpen(raw);
          if (!parsed.choice) return "（未回答）";
          return parsed.note ? `${parsed.choice} / ${parsed.note}` : parsed.choice;
        }
        case "open":
        default: {
          return raw.trim() || "（未回答）";
        }
      }
    });
  }, [answers]);
  const statusNode = useMemo(() => {
    if (!statusMessage) return null;
    const toneClass =
      statusTone === "error"
        ? "text-red-600"
        : statusTone === "success"
        ? "text-green-600"
        : "text-gray-600";
    return <p className={`text-sm ${toneClass}`}>{statusMessage}</p>;
  }, [statusMessage, statusTone]);
  const debugLogList = useMemo(
    () => [...debugLogs].sort((a, b) => a.at - b.at),
    [debugLogs]
  );

  const goToPrevQuestion = useCallback(() => {
    if (!ensureRecordingStopped()) {
      return;
    }
    if (currentIndex === 0) {
      setStatusMessage("最初の質問です。これ以上戻れません。");
      setStatusTone("neutral");
      return;
    }
    const prevIndex = currentIndex - 1;
    setStatusMessage(null);
    setStatusTone("neutral");
    void enterQuestion(prevIndex);
    addDebugLog("question.prev", JSON.stringify({ from: currentIndex, to: prevIndex }));
  }, [addDebugLog, currentIndex, enterQuestion, ensureRecordingStopped]);

  const resetAll = useCallback(() => {
    if (!ensureRecordingStopped()) {
      return;
    }
    stopRecognition({ abort: true, skipFinalize: true });
    setAnswers(QUESTIONS.map(() => ""));
    finalRef.current = "";
    interimRef.current = "";
    sessionBaseRef.current = "";
    manualStopRef.current = false;
    setResult(null);
    setDiagnoseState("idle");
    setStatusMessage(null);
    setStatusTone("neutral");
    setCurrentIndex(0);
    void enterQuestion(0);
    addDebugLog("app.reset");
  }, [addDebugLog, enterQuestion, ensureRecordingStopped, stopRecognition]);

  const diagnose = useCallback(async () => {
    if (!ensureRecordingStopped()) {
      return;
    }

    const qaPayload = QUESTIONS.map((item, index) => {
      const raw = answers[index] ?? "";
      let answer = "";
      switch (item.type) {
        case "open": {
          answer = raw.trim();
          break;
        }
        case "yesno": {
          answer = raw === YES || raw === NO ? raw : "";
          break;
        }
        case "choice": {
          answer = item.choices.includes(raw) ? raw : "";
          break;
        }
        case "yesno+open": {
          const parsed = decodeYesNoOpen(raw);
          if (parsed.choice === YES || parsed.choice === NO) {
            const note = parsed.note.trim();
            answer = note ? `${parsed.choice} / ${note}` : parsed.choice;
          }
          break;
        }
        default:
          answer = raw;
      }
      return {
        id: item.id,
        type: item.type,
        text: item.text,
        answer
      };
    });

    const hasEmpty = qaPayload.some((item) => !item.answer);
    if (hasEmpty) {
      setStatusMessage("未回答の質問があります。すべての質問に回答してください。");
      setStatusTone("error");
      return;
    }

    const logPayload = JSON.stringify(qaPayload);
    addDebugLog(
      "diagnose.request",
      logPayload.length > 800 ? `${logPayload.slice(0, 800)}…` : logPayload
    );

    setDiagnoseState("loading");
    setStatusMessage(null);
    setStatusTone("neutral");
    try {
      const response = await fetch("/api/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: qaPayload })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const errorKey = typeof data?.error === "string" ? data.error : undefined;
        if (errorKey) {
          addDebugLog("diagnose.error_code", errorKey);
        }
        const defaultMessage =
          response.status === 400
            ? "入力内容にエラーがあります。回答を確認してください。"
            : "診断APIの応答に失敗しました。時間を置いて再試行してください。";
        const message = errorKey ? API_ERROR_MESSAGES[errorKey] ?? defaultMessage : defaultMessage;
        throw new Error(message);
      }
      const data = (await response.json()) as DiagnoseResponse;
      const normalizedPicks =
        Array.isArray(data.result?.picks) && data.result.picks.length > 0
          ? data.result.picks
          : data.result?.pick
          ? [data.result.pick]
          : [];
      setResult({
        analysis: data.analysis,
        result: {
          pick: data.result?.pick,
          picks: normalizedPicks
        }
      });
      setDiagnoseState("done");
      setStatusMessage("診断が完了しました。");
      setStatusTone("success");
      if (normalizedPicks[0]) {
        addDebugLog("diagnose.success", JSON.stringify(normalizedPicks[0]));
      } else {
        addDebugLog("diagnose.success", "(no picks)");
      }
    } catch (error) {
      console.error(error);
      setDiagnoseState("error");
      setStatusMessage(
        error instanceof Error ? error.message : "診断処理で予期しないエラーが発生しました。"
      );
      setStatusTone("error");
      addDebugLog("diagnose.error", error instanceof Error ? error.message : String(error));
    }
  }, [addDebugLog, answers, ensureRecordingStopped]);

  const goToNextQuestion = useCallback(() => {
    if (!ensureRecordingStopped()) {
      return;
    }
    const item = QUESTIONS[currentIndex];
    const raw = answers[currentIndex] ?? "";
    const trimmedOpen = item?.type === "open" ? raw.trim() : "";
    const parsedYesNoOpen = item?.type === "yesno+open" ? decodeYesNoOpen(raw) : null;
    const isAnswered = (() => {
      if (!item) return false;
      switch (item.type) {
        case "yesno":
          return raw === YES || raw === NO;
        case "choice":
          return item.choices.includes(raw);
        case "yesno+open":
          return parsedYesNoOpen?.choice === YES || parsedYesNoOpen?.choice === NO;
        case "open":
        default:
          return trimmedOpen.length > 0;
      }
    })();

    if (!isAnswered) {
      const message =
        item?.type === "yesno"
          ? "どちらかを選んでください。"
          : item?.type === "choice"
          ? "ピンとくる選択肢を選んでください。"
          : item?.type === "yesno+open"
          ? "まずは「はい / いいえ」を選んでみてください。感じたことがあれば自由に書いてください。"
          : "少しでも構わないので、この質問への答えを教えてください。";
      setStatusMessage(message);
      setStatusTone("error");
      return;
    }

    if (item?.type === "open" && raw !== trimmedOpen) {
      updateAnswer(trimmedOpen);
    }
    if (item?.type === "yesno+open" && parsedYesNoOpen) {
      const trimmedNote = parsedYesNoOpen.note.trim();
      if (parsedYesNoOpen.note !== trimmedNote) {
        updateAnswer(
          encodeYesNoOpen({
            choice: parsedYesNoOpen.choice,
            note: trimmedNote
          })
        );
      }
    }

    setStatusMessage(null);
    setStatusTone("neutral");

    if (currentIndex < QUESTIONS.length - 1) {
      const nextIndex = currentIndex + 1;
      void enterQuestion(nextIndex);
      addDebugLog("question.next", JSON.stringify({ from: currentIndex, to: nextIndex }));
    } else {
      addDebugLog("question.submit");
      void diagnose();
    }
  }, [
    addDebugLog,
    answers,
    currentIndex,
    diagnose,
    enterQuestion,
    ensureRecordingStopped,
    updateAnswer
  ]);

  const handleCopy = useCallback(async () => {
    if (!primaryPick) return;
    try {
      const url = typeof window !== "undefined" ? window.location.href : "";
      const textToCopy = `${primaryPick.catch_ja} ${url}`.trim();
      await navigator.clipboard.writeText(textToCopy);
      setStatusMessage("コピーしました。");
      setStatusTone("success");
      addDebugLog("diagnose.copy", textToCopy);
    } catch (error) {
      console.error(error);
      setStatusMessage("コピーに失敗しました。手動で選択してください。");
      setStatusTone("error");
      addDebugLog(
        "diagnose.copy_error",
        error instanceof Error ? error.message : String(error)
      );
    }
  }, [addDebugLog, primaryPick]);

  const copyDebugLogs = useCallback(async () => {
    if (!DEBUG_ENABLED) return;
    try {
      const text = debugRef.current
        .map((log) => {
          const time = new Date(log.at).toISOString();
          return `${time} [${log.event}]${log.detail ? ` ${log.detail}` : ""}`;
        })
        .join("\n");
      await navigator.clipboard.writeText(text);
      setStatusMessage("デバッグログをコピーしました。");
      setStatusTone("success");
    } catch (error) {
      console.error(error);
      setStatusMessage("デバッグログのコピーに失敗しました。");
      setStatusTone("error");
    }
  }, []);

  const clearDebugLogs = useCallback(() => {
    if (!DEBUG_ENABLED) return;
    debugRef.current = [];
    setDebugLogs([]);
  }, []);

  return (
    <main className="flex min-h-screen flex-col bg-white">
      <div className="flex flex-1 flex-col px-6 py-10">
        <header className="mx-auto w-full max-w-3xl space-y-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-pink-600">
            Love Language Atlas（仮）
          </h1>
          <p className="text-sm text-gray-600">
            {QUESTIONS.length}の問いにじっくり答えて、世界の愛のことばからあなたに今ぴったりの言葉を見つけましょう。
          </p>
        </header>

        {statusNode && <div className="mx-auto mt-4 w-full max-w-2xl text-center">{statusNode}</div>}

        {diagnoseState !== "done" && (
          <section className="mx-auto mt-8 w-full max-w-3xl rounded-2xl border border-pink-100 bg-pink-50 px-6 py-8 shadow-sm">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2 text-center">
              <div className="text-xs uppercase tracking-widest text-pink-400">
                質問 {currentIndex + 1} / {QUESTIONS.length}
              </div>
              <div className="text-xl font-semibold text-gray-900">{question.text}</div>
              <p className="text-xs text-gray-600">
                {question.type === "open"
                  ? "声で話すか、テキストで自由に答えてください。"
                  : question.type === "yesno"
                  ? "直感に近いほうを選んでください。"
                  : question.type === "choice"
                  ? "いちばんしっくりくる選択肢を選んでください。"
                  : "「はい / いいえ」を選んで、感じたことを自由に書いてください。"}
              </p>
            </div>

            {question.type === "yesno" && (
              <div className="flex justify-center gap-3">
                {[YES, NO].map((choice) => {
                  const isSelected = choice === YES ? isYesSelected : isNoSelected;
                  return (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => {
                        updateAnswer(choice);
                        setStatusMessage(null);
                        setStatusTone("neutral");
                      }}
                      className={`px-5 py-2 rounded-full border text-sm font-medium transition-colors ${
                        isSelected
                          ? choice === YES
                            ? "border-pink-500 bg-pink-500 text-white"
                            : "border-gray-900 bg-gray-900 text-white"
                          : choice === YES
                          ? "border-pink-200 text-pink-700 hover:bg-pink-100"
                          : "border-gray-200 text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      {choice}
                    </button>
                  );
                })}
              </div>
            )}

            {question.type === "choice" && (
              <div className="flex flex-wrap justify-center gap-3">
                {question.choices.map((choice) => {
                  const isSelected = selectedChoice === choice;
                  return (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => {
                        updateAnswer(choice);
                        setStatusMessage(null);
                        setStatusTone("neutral");
                      }}
                      className={`px-4 py-2 rounded-full border text-sm font-medium transition-colors ${
                        isSelected
                          ? "border-pink-500 bg-pink-500 text-white"
                          : "border-pink-200 text-pink-700 hover:bg-pink-100"
                      }`}
                    >
                      {choice}
                    </button>
                  );
                })}
              </div>
            )}

            {question.type === "yesno+open" && (
              <div className="flex flex-col gap-4">
                <div className="flex justify-center gap-3">
                  {[YES, NO].map((choice) => {
                    const isSelected = yesNoOpenValue.choice === choice;
                    return (
                      <button
                        key={choice}
                        type="button"
                        onClick={() => {
                          updateAnswer(
                            encodeYesNoOpen({
                              choice,
                              note: yesNoOpenValue.note
                            })
                          );
                          setStatusMessage(null);
                          setStatusTone("neutral");
                        }}
                        className={`px-5 py-2 rounded-full border text-sm font-medium transition-colors ${
                          isSelected
                            ? choice === YES
                              ? "border-pink-500 bg-pink-500 text-white"
                              : "border-gray-900 bg-gray-900 text-white"
                            : choice === YES
                            ? "border-pink-200 text-pink-700 hover:bg-pink-100"
                            : "border-gray-200 text-gray-700 hover:bg-gray-100"
                        }`}
                      >
                        {choice}
                      </button>
                    );
                  })}
                </div>
                <textarea
                  className="min-h-[160px] rounded-lg border border-pink-200 bg-white p-3 text-sm shadow-inner focus:border-pink-400 focus:outline-none focus:ring-2 focus:ring-pink-200"
                  placeholder="気持ちや背景があれば、ここに書いてください。"
                  value={yesNoOpenValue.note}
                  onChange={(event) => {
                    if (statusTone === "error") {
                      setStatusMessage(null);
                      setStatusTone("neutral");
                    }
                    updateAnswer(
                      encodeYesNoOpen({
                        choice: yesNoOpenValue.choice,
                        note: event.target.value
                      })
                    );
                  }}
                />
              </div>
            )}

            {question.type === "open" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      if (isRecording) {
                        stopRecording();
                      } else {
                        startRecognition();
                      }
                    }}
                    className={`flex h-20 w-20 items-center justify-center rounded-full border-4 border-pink-300 text-sm font-medium text-pink-900 transition-colors ${
                      isRecording ? "bg-pink-500 text-white shadow-lg" : "bg-white hover:bg-pink-100"
                    }`}
                  >
                    {recorderLabel}
                  </button>
                  <div className="text-xs text-gray-600 text-center sm:text-left">
                    マイクで話すと自動でテキスト化されます。うまくいかない場合はテキストで入力してください。
                  </div>
                </div>
                {!hasWebSpeech && (
                  <p className="text-xs text-gray-600 text-center">
                    録音非対応環境です。テキスト入力欄をご利用ください。
                  </p>
                )}
                <textarea
                  className="min-h-[180px] rounded-lg border border-pink-200 bg-white p-3 text-sm shadow-inner focus:border-pink-400 focus:outline-none focus:ring-2 focus:ring-pink-200"
                  placeholder="声で答えるか、ここに自由に書いてください。"
                  value={currentAnswer}
                  onChange={(event) => {
                    if (statusTone === "error") {
                      setStatusMessage(null);
                      setStatusTone("neutral");
                    }
                    updateAnswer(event.target.value);
                  }}
                />
              </div>
            )}

            <div className="flex flex-wrap justify-between gap-2">
              <button
                type="button"
                onClick={goToPrevQuestion}
                className="rounded-full border border-pink-200 px-4 py-2 text-sm text-pink-700 hover:bg-pink-100 disabled:opacity-50"
                disabled={currentIndex === 0}
              >
                ← 戻る
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={resetAll}
                  className="rounded-full border border-pink-200 px-4 py-2 text-sm text-pink-700 hover:bg-pink-100"
                >
                  はじめから
                </button>
                <button
                  type="button"
                  onClick={goToNextQuestion}
                  className="rounded-full bg-pink-500 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-pink-600 disabled:opacity-50"
                  disabled={isSubmitDisabled}
                >
                  {isLastQuestion
                    ? diagnoseState === "loading"
                      ? "送信中…"
                      : "回答を送信"
                    : "次へ →"}
                </button>
              </div>
            </div>
            </div>
          </section>
        )}

        {DEBUG_ENABLED && (
          <section className="mx-auto mt-6 w-full max-w-3xl rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 text-left shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">
                デバッグログ ({debugLogs.length})
              </h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-200"
                  onClick={() => setDebugCollapsed((prev) => !prev)}
                >
                  {debugCollapsed ? "開く" : "閉じる"}
                </button>
                <button
                  type="button"
                  className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-200"
                  onClick={copyDebugLogs}
                >
                  コピー
                </button>
                <button
                  type="button"
                  className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-200"
                  onClick={clearDebugLogs}
                >
                  クリア
                </button>
              </div>
            </div>
            {!debugCollapsed && (
              <div className="mt-3 max-h-56 overflow-y-auto rounded border border-gray-200 bg-white p-3 text-xs font-mono text-gray-700">
                {debugLogList.length === 0 ? (
                  <p className="text-gray-400">ログはまだありません。</p>
                ) : (
                  <ul className="space-y-1">
                    {debugLogList.map((log) => (
                      <li key={log.id}>
                        <span className="text-gray-500">
                          {new Date(log.at).toLocaleTimeString()}
                        </span>{" "}
                        <span className="font-semibold">{log.event}</span>
                        {log.detail && <span className="text-gray-600"> — {log.detail}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        )}

        <section className="mx-auto mt-8 w-full max-w-3xl flex-1 space-y-4">
          {diagnoseState === "loading" && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
              <p className="text-sm text-gray-600">
                解析中です…あなたの回答を束ねて、世界の愛のことばから最適な3語を探しています。
              </p>
            </div>
          )}

          {diagnoseState === "error" && statusMessage && (
            <div className="space-y-3 rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700 shadow-sm">
              <p>{statusMessage}</p>
              <button
                type="button"
                onClick={diagnose}
                className="rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
              >
                再試行
              </button>
            </div>
          )}

          {diagnoseState === "done" && picks.length > 0 && (
            <article className="space-y-5 rounded-3xl border border-pink-100 bg-white p-6 shadow-md">
              <header className="space-y-2 text-center">
                <div className="text-xs uppercase tracking-wider text-pink-400">Your Words</div>
                <h2 className="text-2xl font-semibold text-gray-900">
                  {primaryPick.term}
                  <span className="text-sm text-gray-500">（{primaryPick.lang}）</span>
                </h2>
                <p className="text-sm text-gray-600">{primaryPick.gloss}</p>
                <p className="text-xs text-gray-500">
                  他にもあなたに響く言葉をあわせてお届けします。
                </p>
              </header>

              <div className="flex flex-col gap-5">
                {picks.map((pick, index) => (
                  <div
                    key={`${pick.id}-${index}`}
                    className="space-y-2 rounded-2xl border border-pink-100 bg-pink-50 p-4 shadow-sm animate-fadeIn"
                    style={{ animationDelay: `${index * 0.12}s` }}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs uppercase tracking-wide text-pink-400">
                        Word {index + 1}
                      </span>
                      <span className="text-xs text-gray-400">{pick.id}</span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 className="text-xl font-semibold text-gray-900">{pick.term}</h3>
                      <span className="text-sm text-gray-500">({pick.lang})</span>
                      {pick.gloss && (
                        <span className="text-sm text-gray-600">— {pick.gloss}</span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                      {pick.reason_ja}
                    </p>
                    <p className="text-sm font-semibold text-pink-600">「{pick.catch_ja}」</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  className="rounded-full border border-pink-200 px-4 py-2 text-sm text-pink-700 hover:bg-pink-100 disabled:opacity-50"
                  onClick={handleCopy}
                  disabled={!primaryPick}
                >
                  キャッチとURLをコピー
                </button>
                <button
                  type="button"
                  className="rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black"
                  onClick={resetAll}
                >
                  もう一度診断する
                </button>
              </div>
              <footer className="border-t border-pink-100 pt-3 text-xs text-gray-500">
                {RESULT_DISCLAIMER}
              </footer>
            </article>
          )}
        </section>

      </div>
    </main>
  );
}

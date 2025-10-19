"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QUESTIONS } from "@/app/questions";

type Phase = "answering" | "review";
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
    pick: DiagnosePick;
  };
}

const RESULT_DISCLAIMER =
  "※ 診断は文化背景を断定するものではなく、個人差があります。";

function serializeAnswers(answers: string[]): string {
  return answers
    .map((value, index) => {
      const question = QUESTIONS[index]?.text ?? `質問 ${index + 1}`;
      return `Q${index + 1}: ${question}\nA${index + 1}: ${value}`;
    })
    .join("\n\n");
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("answering");
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
      setPhase("answering");
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
      setPhase("answering");
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

  const goToNextQuestion = useCallback(() => {
    if (!ensureRecordingStopped()) {
      return;
    }
    const raw = answers[currentIndex] ?? "";
    const trimmed = raw.trim();
    if (!trimmed) {
      setStatusMessage("少しでも構わないので、この質問への答えを教えてください。");
      setStatusTone("error");
      return;
    }
    if (raw !== trimmed) {
      updateAnswer(trimmed);
    }
    if (currentIndex < QUESTIONS.length - 1) {
      const nextIndex = currentIndex + 1;
      void enterQuestion(nextIndex);
      addDebugLog("question.next", JSON.stringify({ from: currentIndex, to: nextIndex }));
    } else {
      setPhase("review");
      setStatusMessage(null);
      setStatusTone("neutral");
      addDebugLog("question.review_enter");
    }
  }, [addDebugLog, answers, currentIndex, enterQuestion, ensureRecordingStopped, updateAnswer]);

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
    void enterQuestion(prevIndex);
    addDebugLog("question.prev", JSON.stringify({ from: currentIndex, to: prevIndex }));
  }, [addDebugLog, currentIndex, enterQuestion, ensureRecordingStopped]);

  const jumpToQuestion = useCallback(
    (index: number) => {
      if (!ensureRecordingStopped()) {
        return;
      }
      void enterQuestion(index);
      addDebugLog("question.jump", JSON.stringify({ to: index }));
    },
    [addDebugLog, enterQuestion, ensureRecordingStopped]
  );

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
    setPhase("answering");
    setCurrentIndex(0);
    void enterQuestion(0);
    addDebugLog("app.reset");
  }, [addDebugLog, enterQuestion, ensureRecordingStopped, stopRecognition]);

  const diagnose = useCallback(async () => {
    if (!ensureRecordingStopped()) {
      return;
    }
    const payload = serializeAnswers(answers);
    addDebugLog(
      "diagnose.request",
      payload.length > 800 ? `${payload.slice(0, 800)}…` : payload
    );
    setDiagnoseState("loading");
    setStatusMessage(null);
    setStatusTone("neutral");
    try {
      const response = await fetch("/api/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ freeText: payload, lang: "ja" })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || "診断APIの応答に失敗しました。");
      }
      const data = (await response.json()) as DiagnoseResponse;
      setResult(data);
      setDiagnoseState("done");
      setStatusMessage("診断が完了しました。");
      setStatusTone("success");
      addDebugLog("diagnose.success", JSON.stringify(data.result.pick));
    } catch (error) {
      console.error(error);
      setDiagnoseState("error");
      setStatusMessage(
        error instanceof Error ? error.message : "診断処理で予期しないエラーが発生しました。"
      );
      setStatusTone("error");
      addDebugLog(
        "diagnose.error",
        error instanceof Error ? error.message : String(error)
      );
    }
  }, [addDebugLog, answers, ensureRecordingStopped]);

  const handleCopy = useCallback(async () => {
    if (!result?.result?.pick) return;
    try {
      const url = typeof window !== "undefined" ? window.location.href : "";
      const textToCopy = `${result.result.pick.catch_ja} ${url}`.trim();
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
  }, [addDebugLog, result]);

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
            5つの問いにじっくり答えて、世界の愛のことばからあなたに今ぴったりの1語を見つけましょう。
          </p>
        </header>

        {statusNode && <div className="mx-auto mt-4 w-full max-w-2xl text-center">{statusNode}</div>}

        {phase !== "review" && (
          <section className="mx-auto mt-8 w-full max-w-3xl rounded-2xl border border-pink-100 bg-pink-50 px-6 py-8 shadow-sm">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2 text-center">
                <div className="text-xs uppercase tracking-widest text-pink-400">
                  質問 {currentIndex + 1} / {QUESTIONS.length}
                </div>
                <h2 className="text-lg font-semibold text-gray-900">{question.text}</h2>
                <p className="text-xs text-gray-600">声でも、テキストでも自由に答えてください。</p>
              </div>

              <div className="flex flex-col items-center gap-3">
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
                  {recorderState === "recording" && "録音中"}
                  {recorderState === "transcribing" && "文字起こし中"}
                  {recorderState === "error" && "再試行"}
                  {recorderState === "idle" && "話す"}
                </button>
                {!hasWebSpeech && (
                  <p className="text-xs text-gray-600">
                    録音非対応環境です。テキスト入力欄をご利用ください。
                  </p>
                )}
              </div>

              <textarea
                className="min-h-[180px] rounded-lg border border-pink-200 bg-white p-3 text-sm shadow-inner focus:border-pink-400 focus:outline-none focus:ring-2 focus:ring-pink-200"
                placeholder="声で答えるか、ここに自由に書いてください。"
                value={answers[currentIndex]}
                onChange={(event) => updateAnswer(event.target.value)}
              />

              <div className="flex flex-wrap justify-between gap-2">
                <button
                  type="button"
                  onClick={goToPrevQuestion}
                  className="rounded-full border border-pink-200 px-4 py-2 text-sm text-pink-700 hover:bg-pink-100"
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
                    やり直す
                  </button>
                  <button
                    type="button"
                    onClick={goToNextQuestion}
                    className="rounded-full bg-pink-500 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-pink-600"
                  >
                    {currentIndex < QUESTIONS.length - 1 ? "次へ →" : "回答を確認"}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {phase === "review" && (
          <section className="mx-auto mt-8 w-full max-w-3xl space-y-4">
            <div className="rounded-2xl border border-pink-100 bg-pink-50 px-6 py-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">回答の確認</h2>
              <p className="mt-1 text-xs text-gray-600">
                内容を調整したい場合は各質問の「戻って編集」から再編集できます。
              </p>
              <ol className="mt-4 space-y-4">
                {QUESTIONS.map((item, index) => (
                  <li key={item.id} className="rounded-xl border border-pink-100 bg-white p-4 shadow-sm">
                    <div className="text-sm font-semibold text-pink-600">{item.text}</div>
                    <div className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
                      {answers[index] || "（未回答）"}
                    </div>
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => jumpToQuestion(index)}
                        className="rounded-full border border-pink-200 px-3 py-1 text-xs text-pink-700 hover:bg-pink-100"
                      >
                        ← この質問に戻って編集
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setPhase("answering");
                  void enterQuestion(QUESTIONS.length - 1);
                }}
                className="rounded-full border border-pink-200 px-4 py-2 text-sm text-pink-700 hover:bg-pink-100"
              >
                最後の質問に戻る
              </button>
              <button
                type="button"
                onClick={resetAll}
                className="rounded-full border border-pink-200 px-4 py-2 text-sm text-pink-700 hover:bg-pink-100"
              >
                はじめからやり直す
              </button>
              <button
                type="button"
                onClick={diagnose}
                className="rounded-full bg-pink-500 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-pink-600 disabled:opacity-50"
                disabled={diagnoseState === "loading"}
              >
                {diagnoseState === "loading" ? "解析中…" : "診断する"}
              </button>
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
                解析中です…あなたの回答を束ねて、世界の愛のことばから最適な1語を探しています。
              </p>
            </div>
          )}

          {diagnoseState === "error" && statusMessage && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700 shadow-sm">
              {statusMessage}
            </div>
          )}

          {diagnoseState === "done" && result?.result?.pick && (
            <article className="space-y-4 rounded-3xl border border-pink-100 bg-white p-6 shadow-md">
              <header className="space-y-1">
                <div className="text-xs uppercase tracking-wider text-pink-400">Your Word</div>
                <h2 className="text-2xl font-semibold text-gray-900">
                  {result.result.pick.term}{" "}
                  <span className="text-sm text-gray-500">({result.result.pick.lang})</span>
                </h2>
                <p className="text-sm text-gray-600">{result.result.pick.gloss}</p>
              </header>
              <p className="text-base leading-relaxed text-gray-800 whitespace-pre-wrap">
                {result.result.pick.reason_ja}
              </p>
              <p className="text-sm font-semibold text-pink-600">「{result.result.pick.catch_ja}」</p>

              <div className="flex flex-wrap gap-2 pt-3">
                <button
                  type="button"
                  className="rounded-full border border-pink-200 px-4 py-2 text-sm text-pink-700 hover:bg-pink-100"
                  onClick={handleCopy}
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

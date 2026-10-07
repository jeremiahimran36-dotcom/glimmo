(() => {
  const $ = (s) => document.querySelector(s);
  const orb = $("#orb"), statusEl = $("#status"), messagesEl = $("#messages");
  const input = $("#input"), micBtn = $("#mic"), sendBtn = $("#send");

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const history = [];
  let state = "idle", recognition = null, busy = false;

  function setState(s, text = "") {
    state = s;
    document.body.dataset.state = s;
    micBtn.classList.toggle("on", s === "listening");
    statusEl.textContent = text || ({ listening: "Listening...", thinking: "Thinking...", speaking: "" }[s] || "");
  }

  function addMsg(text, cls) {
    const el = document.createElement("div");
    el.className = "msg " + cls;
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function typing() {
    const el = document.createElement("div");
    el.className = "msg bot typing";
    el.innerHTML = "<i></i><i></i><i></i>";
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  /* ---------- Speaking ---------- */
  function pickVoice() {
    const voices = speechSynthesis.getVoices();
    const lang = navigator.language || "en-US";
    const same = voices.filter((v) => v.lang.startsWith(lang.slice(0, 2)));
    return same.find((v) => /female|google|samantha|zira/i.test(v.name)) || same[0] || null;
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) { setState("idle"); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.pitch = 1.35;  // cute voice
    u.rate = 1.02;
    u.onstart = () => setState("speaking");
    u.onend = u.onerror = () => setState("idle");
    speechSynthesis.speak(u);
  }

  /* ---------- Talking to the server ---------- */
  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    busy = true;
    stopListening();
    speechSynthesis.cancel();
    addMsg(text, "user");
    history.push({ role: "user", content: text });
    input.value = "";
    setState("thinking");
    const dots = typing();
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      const data = await res.json();
      dots.remove();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      history.push({ role: "assistant", content: data.reply });
      addMsg(data.reply, "bot");
      speak(data.reply);
    } catch (err) {
      dots.remove();
      history.pop();
      addMsg(err.message || "No connection. Check your internet.", "error");
      setState("idle");
    } finally {
      busy = false;
    }
  }

  /* ---------- Listening ---------- */
  function startListening() {
    if (!SR) { addMsg("Voice input isn't supported here. Type instead.", "error"); input.focus(); return; }
    if (busy) return;
    speechSynthesis.cancel();
    recognition = new SR();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    let finalText = "";
    recognition.onstart = () => setState("listening");
    recognition.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      statusEl.textContent = interim || finalText || "Listening...";
    };
    recognition.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        addMsg("Microphone is blocked. Allow it in your phone's settings.", "error");
      }
      setState("idle");
    };
    recognition.onend = () => {
      if (finalText.trim()) send(finalText); else if (state === "listening") setState("idle");
    };
    try { recognition.start(); } catch (_) {}
  }

  function stopListening() {
    if (recognition) { try { recognition.abort(); } catch (_) {} recognition = null; }
  }

  function toggleMic() {
    if (state === "listening") { recognition && recognition.stop(); } else startListening();
  }

  /* ---------- Open / close chat ---------- */
  function openChat() {
    if (document.body.classList.contains("chat-open")) return;
    document.body.classList.add("chat-open");
    $("#chat").setAttribute("aria-hidden", "false");
    const hello = "Hi! I'm Glimmo. Tap the mic and tell me something!";
    addMsg(hello, "bot");
    speak(hello);
  }

  function closeChat() {
    stopListening();
    speechSynthesis.cancel();
    setState("idle");
    document.body.classList.remove("chat-open");
    $("#chat").setAttribute("aria-hidden", "true");
  }

  $("#talk").addEventListener("click", openChat);
  $("#back").addEventListener("click", closeChat);
  sendBtn.addEventListener("click", () => send(input.value));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(input.value); });
  micBtn.addEventListener("click", toggleMic);
  orb.addEventListener("click", () => {
    if (!document.body.classList.contains("chat-open")) return openChat();
    if (state === "speaking") { speechSynthesis.cancel(); setState("idle"); } else toggleMic();
  });

  if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => {};
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
})();

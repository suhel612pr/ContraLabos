/* ============================================================
   CONTRALABOS — SUPPORT CHATBOT WIDGET
   Text + voice input (Web Speech API), voice output (SpeechSynthesis),
  EN/HI/MR. Responses use the deployed Supabase assistant function.
   ============================================================ */

const SPEECH_LANG_MAP = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" };
const CHAT_COPY = {
  en: { greeting: "Hi, I'm the Contralabos support assistant. Ask me about attendance, payments, materials, or requests.", thinking: "Thinking…", unavailable: "The assistant is temporarily unavailable." },
  hi: { greeting: "नमस्ते, मैं Contralabos सहायता सहायक हूँ। मुझसे उपस्थिति, भुगतान, सामग्री या अनुरोधों के बारे में पूछें।", thinking: "सोच रहा हूँ…", unavailable: "सहायक अभी उपलब्ध नहीं है।" },
  mr: { greeting: "नमस्कार, मी Contralabos सहाय्यक आहे. उपस्थिती, देयके, साहित्य किंवा विनंत्यांबद्दल मला विचारा.", thinking: "विचार करत आहे…", unavailable: "सहाय्यक सध्या उपलब्ध नाही." }
};

const Chatbot = {
  recognition: null,
  listening: false,
  history: [],
  voiceEnabled: false,
  context: null,

  mount(){
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <button class="chatbot-launcher" id="chatLauncher" aria-label="Open support chat">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1a1305" stroke-width="1.8">
          <path d="M21 11.5a8.4 8.4 0 01-8.9 8.4 9 9 0 01-3.6-.7L3 21l1.8-5.4A8.4 8.4 0 1121 11.5z"/>
        </svg>
      </button>
      <div class="chatbot-panel" id="chatPanel">
        <div class="chatbot-head">
          <div>
            <div class="ch-title" data-i18n="chatbot_title">Contralabos Support</div>
            <div class="ch-sub">Text or voice · EN / हिंदी / मराठी</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <select class="chatbot-lang" id="chatLang">
              <option value="en">EN</option><option value="hi">हिंदी</option><option value="mr">मराठी</option>
            </select>
            <button class="icon-btn" style="width:26px;height:26px;" id="chatVoice" aria-label="Enable voice replies">🔇</button>
            <button class="icon-btn" style="width:26px;height:26px;" id="chatClear" aria-label="Clear chat">↺</button>
            <button class="icon-btn" style="width:26px;height:26px;" id="chatClose" aria-label="Close chat">✕</button>
          </div>
        </div>
        <div class="chatbot-body" id="chatBody">
          <div class="chat-msg bot">Hi, I'm the Contralabos support assistant. Ask me about attendance, payments, materials, or requests.</div>
        </div>
        <div class="chatbot-input-row">
          <button id="micBtn" aria-label="Voice input">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>
          </button>
          <input type="text" id="chatInput" data-i18n-ph="chatbot_placeholder" placeholder="Type your question…">
          <button id="sendBtn" aria-label="Send">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          </button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    document.getElementById("chatLauncher").addEventListener("click", () => {
      document.getElementById("chatPanel").classList.toggle("open");
    });
    document.getElementById("chatClose").addEventListener("click", () => {
      document.getElementById("chatPanel").classList.remove("open");
    });
    document.getElementById("chatClear").addEventListener("click", () => this.clear());
    document.getElementById("chatVoice").addEventListener("click", () => this.toggleVoice());
    document.getElementById("sendBtn").addEventListener("click", () => this.send());
    document.getElementById("chatInput").addEventListener("keydown", (e) => {
      if(e.key === "Enter") this.send();
    });
    document.getElementById("micBtn").addEventListener("click", () => this.toggleMic());

    const langSel = document.getElementById("chatLang");
    langSel.value = (window.LangSwitcher && LangSwitcher.current) || "en";
    this.setGreeting(langSel.value);
    langSel.addEventListener("change", (e) => {
      if(window.LangSwitcher) LangSwitcher.apply(e.target.value);
      this.setGreeting(e.target.value);
    });
  },

  appendMessage(text, who){
    const body = document.getElementById("chatBody");
    const div = document.createElement("div");
    div.className = "chat-msg " + who;
    div.textContent = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  },

  clear(){
    this.history = [];
    window.speechSynthesis?.cancel();
    const lang = document.getElementById("chatLang").value;
    document.getElementById("chatBody").innerHTML = `<div class="chat-msg bot">${CHAT_COPY[lang].greeting}</div>`;
  },

  setGreeting(lang){
    const greeting = document.querySelector("#chatBody .chat-msg.bot");
    if(greeting && !this.history.length) greeting.textContent = CHAT_COPY[lang].greeting;
  },

  toggleVoice(){
    this.voiceEnabled = !this.voiceEnabled;
    const button = document.getElementById("chatVoice");
    button.textContent = this.voiceEnabled ? "🔊" : "🔇";
    button.setAttribute("aria-label", this.voiceEnabled ? "Disable voice replies" : "Enable voice replies");
    if(!this.voiceEnabled) window.speechSynthesis?.cancel();
  },

  async send(){
    const input = document.getElementById("chatInput");
    const text = input.value.trim();
    if(!text) return;
    const sendBtn = document.getElementById("sendBtn");
    const lang = document.getElementById("chatLang").value;
    this.appendMessage(text, "user");
    const history = this.history.slice(-10);
    this.history.push({ role: "user", text });
    input.value = "";
    input.disabled = true;
    sendBtn.disabled = true;
    this.appendMessage(CHAT_COPY[lang].thinking, "stub");
    const typing = document.getElementById("chatBody").lastElementChild;
    try{
      if(!this.context){
        const projects = await Contralabos.projects.list();
        this.context = { projectCount: projects.length, projects: projects.map(project => ({ name: project.name, status: project.status, progress: project.progress })) };
      }
      const result = await Contralabos.assistant.sendMessage(text, lang, history, this.context);
      typing.remove();
      if(result && result.reply){
        this.appendMessage(result.reply, "bot");
        this.history.push({ role: "model", text: result.reply });
        if(this.voiceEnabled) this.speak(result.reply, lang);
      }else{
        this.appendMessage(result?.note || CHAT_COPY[lang].unavailable, "stub");
      }
    }catch(err){
      typing.remove();
      this.history.pop();
      this.appendMessage(err.message || CHAT_COPY[lang].unavailable, "stub");
    }finally{
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }
  },

  toggleMic(){
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SpeechRecognition){
      this.appendMessage("Voice input isn't supported in this browser. Try Chrome or Edge.", "stub");
      return;
    }
    const micBtn = document.getElementById("micBtn");
    if(this.listening){
      this.recognition && this.recognition.stop();
      return;
    }
    const lang = document.getElementById("chatLang").value;
    this.recognition = new SpeechRecognition();
    this.recognition.lang = SPEECH_LANG_MAP[lang] || "en-IN";
    this.recognition.interimResults = false;
    this.recognition.onstart = () => { this.listening = true; micBtn.classList.add("mic-active"); };
    this.recognition.onend = () => { this.listening = false; micBtn.classList.remove("mic-active"); };
    this.recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      document.getElementById("chatInput").value = transcript;
      this.send();
    };
    this.recognition.start();
  },

  speak(text, lang){
    if(!window.speechSynthesis) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = SPEECH_LANG_MAP[lang] || "en-IN";
    window.speechSynthesis.speak(utter);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  if(document.body.dataset.chatbot !== "off") Chatbot.mount();
});

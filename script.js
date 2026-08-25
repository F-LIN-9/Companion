// ================================================================
// 亲语 · 银发语音助手 — 核心逻辑
// 功能：语音输入 → 多模式 AI 处理 → 语音播报
// 技术：Web Speech API + Fetch API + Canvas 图片压缩
// ================================================================

// ---------- 后端地址 ----------
const API_BASE = window.location.origin;

// ---------- 语音识别支持检测 ----------
const SPEECH_SUPPORTED = !!(
    (window.SpeechRecognition || window.webkitSpeechRecognition) &&
    !/iPhone|iPad|iPod/.test(navigator.userAgent)
);

// ---------- DOM 引用 ----------
const messageList = document.getElementById('messageList');
const recordBtn = document.getElementById('recordBtn');
const btnIcon = document.getElementById('btnIcon');
const btnText = document.getElementById('btnText');
const statusTip = document.getElementById('statusTip');
const callBtn = document.getElementById('callBtn');
const regenerateBtn = document.getElementById('regenerateBtn');
const photoInput = document.getElementById('photoInput');
const modeBtns = document.querySelectorAll('.mode-btn');
const textInputRow = document.getElementById('textInputRow');
const textInput = document.getElementById('textInput');
const sendBtn = document.getElementById('sendBtn');

// ---------- 状态 ----------
let currentMode = 'default';       // default | doctor | fraud | vision | medicine
let isRecording = false;
let isProcessing = false;
let lastUserText = '';
let lastAssistantText = '';
let recognition = null;
let synth = null;

// ---------- 模式元数据 ----------
const MODE_META = {
    default:  { icon: '💬', label: '帮我说清', tip: '按住说话，帮您把话说清楚' },
    doctor:   { icon: '🏥', label: '就医辅助', tip: '哪里不舒服？慢慢说' },
    fraud:    { icon: '🛡️', label: '防骗识别', tip: '把可疑的话复述一遍' },
    vision:   { icon: '📷', label: '拍照查价', tip: '点击按钮拍照，识别产品' },
    medicine: { icon: '💊', label: '用药提醒', tip: '告诉我您吃什么药、什么时候吃' }
};

// ---------- 模拟回复 ----------
const SIMULATE_REPLIES = {
    default:  (t) => t.length > 30 ? t.split(/[，,。.！!？?]/).filter(s => s.trim().length > 3).slice(0, 2).join('，') + '。' : t + '，我知道了。',
    doctor:   () => '请告诉我：哪里不舒服？持续多久了？有多严重？我来帮您整理成就医信息。',
    fraud:    () => '请把对方说的话复述一遍，我帮您判断是不是诈骗。',
    vision:   () => '请点击按钮拍照，我会帮您识别产品和价格。',
    medicine: () => '请告诉我您吃什么药，每天什么时间吃，我来帮您记着。'
};

// ---------- 模式切换 ----------
function switchMode(mode) {
    currentMode = mode;
    modeBtns.forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-mode="${mode}"]`).classList.add('active');

    const meta = MODE_META[mode];
    statusTip.textContent = meta.tip;
    btnIcon.textContent = meta.icon;
    btnText.textContent = mode === 'vision' ? '点击 拍照' : '按住 说话';

    // 拍照模式特殊样式
    if (mode === 'vision') {
        recordBtn.classList.add('photo-mode');
    } else {
        recordBtn.classList.remove('photo-mode');
    }
}

modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        if (isProcessing || isRecording) return;
        switchMode(btn.dataset.mode);
    });
});

// ---------- 语音识别 ----------
function initSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        statusTip.textContent = '⚠️ 您的浏览器不支持语音，请使用 Chrome 或 Edge';
        recordBtn.disabled = true;
        return null;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SpeechRecognition();
    rec.lang = 'zh-CN';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
        const text = event.results[event.results.length - 1][0].transcript;
        if (text && text.trim().length > 0) {
            handleUserInput(text.trim());
        } else {
            statusTip.textContent = '😕 没听清，再试一次吧';
            resetButton();
        }
    };

    rec.onerror = (event) => {
        console.warn('语音识别错误:', event.error);
        if (event.error === 'not-allowed') {
            statusTip.textContent = '🔒 请允许麦克风权限后再试';
        } else if (event.error === 'no-speech') {
            statusTip.textContent = '🤔 没听到声音，再试一次';
        } else {
            statusTip.textContent = '❌ 出了点小问题，再试一次';
        }
        resetButton();
    };

    rec.onend = () => {
        setTimeout(() => {
            if (isRecording) {
                resetButton();
                statusTip.textContent = MODE_META[currentMode].tip;
            }
        }, 300);
    };

    return rec;
}

// ---------- 按钮状态 ----------
function resetButton() {
    isRecording = false;
    recordBtn.classList.remove('recording');
    btnIcon.textContent = MODE_META[currentMode].icon;
    btnText.textContent = currentMode === 'vision' ? '点击 拍照' : '按住 说话';
}

// ---------- 处理用户输入（语音或文字） ----------
async function handleUserInput(text) {
    if (isProcessing) return;
    isProcessing = true;
    lastUserText = text;

    appendMessage('user', text);
    const botMsgId = appendMessage('bot', '⏳ 正在处理……', true);

    try {
        const reply = await callAPI(text);
        lastAssistantText = reply;
        updateBotMessage(botMsgId, reply);
        speakText(reply);

        callBtn.disabled = false;
        regenerateBtn.disabled = false;
        callBtn.classList.add('active-btn');
        regenerateBtn.classList.add('active-btn');

        statusTip.textContent = '✅ 已整理好，可以拨给家人了';
    } catch (error) {
        console.error('API 调用失败:', error);
        const fallback = SIMULATE_REPLIES[currentMode](text);
        updateBotMessage(botMsgId, fallback);
        lastAssistantText = fallback;
        speakText(fallback);
        statusTip.textContent = '⚠️ 网络不太稳，用了本地处理';
    } finally {
        isProcessing = false;
        resetButton();
    }
}

// ---------- 调用后端 API ----------
async function callAPI(userText) {
    const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, mode: currentMode })
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.reply || `请求失败(${response.status})`);
    }

    const data = await response.json();
    return data.reply?.trim() || '抱歉，AI 没有返回内容，请再试一次。';
}

// ---------- 拍照查价 ----------
async function handlePhoto(file) {
    if (isProcessing) return;
    isProcessing = true;

    appendMessage('user', '📷 已拍照，正在识别……');
    const botMsgId = appendMessage('bot', '🔍 正在识别产品……', true);

    try {
        const base64 = await compressImage(file);
        const response = await fetch(`${API_BASE}/api/vision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64 })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.reply || `请求失败(${response.status})`);
        }

        const data = await response.json();
        const reply = data.reply?.trim() || '无法识别该产品，请再拍一张清晰的照片。';
        lastAssistantText = reply;
        updateBotMessage(botMsgId, reply);
        speakText(reply);

        callBtn.disabled = false;
        regenerateBtn.disabled = false;
        callBtn.classList.add('active-btn');
        regenerateBtn.classList.add('active-btn');

        statusTip.textContent = '✅ 识别完成';
    } catch (error) {
        console.error('拍照识别失败:', error);
        updateBotMessage(botMsgId, '📷 识别失败，请确保光线充足、产品清晰，再拍一次。');
        statusTip.textContent = '⚠️ 识别失败，再试一次';
    } finally {
        isProcessing = false;
        resetButton();
    }
}

// ---------- 图片压缩（转 base64，限制大小） ----------
function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const maxW = 800;
                const scale = Math.min(1, maxW / img.width);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ---------- 语音合成（iOS 兼容） ----------
let _speechWarmedUp = false;

function _ensureSynth() {
    if (!synth) synth = window.speechSynthesis;
    return synth;
}

function _warmUpSpeech() {
    if (_speechWarmedUp) return;
    const s = _ensureSynth();
    const dummy = new SpeechSynthesisUtterance('');
    dummy.volume = 0;
    dummy.rate = 2;
    s.speak(dummy);
    _speechWarmedUp = true;
}

function speakText(text) {
    const s = _ensureSynth();
    s.cancel();

    const doSpeak = () => {
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'zh-CN';
        utter.rate = 0.9;
        utter.pitch = 1.0;
        utter.volume = 1.0;

        const voices = s.getVoices();
        const zhVoice = voices.find(v => v.lang.startsWith('zh'));
        if (zhVoice) utter.voice = zhVoice;

        if (voices.length === 0) {
            const onVoices = () => {
                const updated = s.getVoices();
                const zh = updated.find(v => v.lang.startsWith('zh'));
                if (zh) utter.voice = zh;
                s.speak(utter);
                s.onvoiceschanged = null;
            };
            s.onvoiceschanged = onVoices;
            setTimeout(() => {
                if (s.onvoiceschanged === onVoices) {
                    s.onvoiceschanged = null;
                    s.speak(utter);
                }
            }, 1000);
            return;
        }

        s.speak(utter);

        // iOS 有时 speak() 返回了但不播放，1.5秒后检查并重试
        setTimeout(() => {
            if (!s.speaking && !s.pending) {
                s.cancel();
                s.speak(utter);
            }
        }, 1500);
    };

    // iOS cancel() 后需要延迟
    setTimeout(doSpeak, 150);
}

// ---------- 消息渲染 ----------
function appendMessage(role, content, isPlaceholder) {
    const div = document.createElement('div');
    div.className = `msg-${role}`;
    const avatar = role === 'user' ? '👴' : '🤖';
    const bubbleClass = 'bubble' + (isPlaceholder ? ' placeholder' : '');
    div.innerHTML = `<div class="avatar">${avatar}</div><div class="${bubbleClass}">${content}</div>`;
    if (isPlaceholder) {
        div.dataset.placeholder = 'true';
        div.id = `msg-${Date.now()}`;
    }
    messageList.appendChild(div);
    const chatArea = document.getElementById('chatArea');
    chatArea.scrollTop = chatArea.scrollHeight;
    return div;
}

function updateBotMessage(msgEl, newContent) {
    if (!msgEl) return;
    const bubble = msgEl.querySelector('.bubble');
    if (bubble) {
        bubble.textContent = newContent;
        bubble.classList.remove('placeholder');
    }
    document.getElementById('chatArea').scrollTop = document.getElementById('chatArea').scrollHeight;
}

// ---------- 录音按钮交互 ----------
function setupRecordButton() {
    if (!recognition) {
        recognition = initSpeechRecognition();
        if (!recognition) return;
    }

    let _lastDownTime = 0;

    // 按下：pointerdown + touchstart 双保险（带防抖，250ms 内只触发一次）
    const onDown = (e) => {
        e.preventDefault();
        const now = Date.now();
        if (now - _lastDownTime < 250) return;
        _lastDownTime = now;

        if (isProcessing || isRecording) return;
        if (currentMode === 'vision') {
            photoInput.click();
            return;
        }
        startRecording();
    };

    // 松开：pointerup + touchend
    const onUp = (e) => {
        e.preventDefault();
        if (isRecording) {
            _lastDownTime = 0;
            stopRecording();
        }
    };

    // 滑出 / 取消
    const onCancel = () => {
        if (isRecording) {
            _lastDownTime = 0;
            stopRecording();
        }
    };

    recordBtn.addEventListener('pointerdown', onDown);
    recordBtn.addEventListener('pointerup', onUp);
    recordBtn.addEventListener('pointerleave', onCancel);
    recordBtn.addEventListener('pointercancel', onCancel);

    // 部分 Android WebView 不支持 pointer 事件，touch 作为兜底
    recordBtn.addEventListener('touchstart', onDown, { passive: false });
    recordBtn.addEventListener('touchend', onUp, { passive: false });
    recordBtn.addEventListener('touchcancel', onCancel, { passive: false });

    // 注意：不绑定 mousedown，移动端 touch 会 300ms 后触发合成 mousedown，导致松手后再次录音

    // 阻止长按菜单
    recordBtn.addEventListener('contextmenu', (e) => e.preventDefault());

    // 拍照回传
    photoInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handlePhoto(file);
        photoInput.value = '';
    });
}

function startRecording() {
    if (!recognition) return;
    _warmUpSpeech();
    try {
        recognition.start();
        isRecording = true;
        recordBtn.classList.add('recording');
        btnIcon.textContent = '🔴';
        btnText.textContent = '松开 结束';
        statusTip.textContent = '🎙️ 正在听，慢慢说……';
    } catch (e) {
        if (!e.message?.includes('already started')) {
            console.warn('startRecording error:', e);
        }
    }
}

function stopRecording() {
    if (!recognition || !isRecording) return;
    isRecording = false;
    recordBtn.classList.remove('recording');
    try {
        recognition.stop();
    } catch (e) {
        // 忽略 already stopped 等错误
    }
    setTimeout(() => {
        resetButton();
        statusTip.textContent = MODE_META[currentMode].tip;
    }, 500);
}

// ---------- 辅助按钮 ----------
callBtn.addEventListener('click', () => {
    if (!lastAssistantText) return;
    // 直接调起拨号界面（不指定号码，让老人自己输或选择联系人）
    window.location.href = 'tel:';
});

regenerateBtn.addEventListener('click', () => {
    if (lastUserText) {
        const botMsgs = document.querySelectorAll('.msg-bot');
        const lastBot = botMsgs[botMsgs.length - 1];
        if (lastBot) lastBot.remove();
        handleUserInput(lastUserText);
    }
});

// ---------- 初始化 ----------
function init() {
    if (window.speechSynthesis) {
        window.speechSynthesis.getVoices();
        window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }

    if (SPEECH_SUPPORTED) {
        setupRecordButton();
    } else {
        // iOS 降级：显示文本输入框 + 发送按钮
        textInputRow.style.display = 'flex';

        let _iosLastTap = 0;
        const onIosTap = (e) => {
            e.preventDefault();
            const now = Date.now();
            if (now - _iosLastTap < 250) return;
            _iosLastTap = now;
            if (isProcessing) return;
            if (currentMode === 'vision') {
                photoInput.click();
                return;
            }
            textInput.focus();
        };

        recordBtn.addEventListener('pointerdown', onIosTap);
        recordBtn.addEventListener('touchstart', onIosTap, { passive: false });
        recordBtn.addEventListener('contextmenu', (e) => e.preventDefault());

        // 发送按钮
        sendBtn.addEventListener('click', () => {
            const text = textInput.value.trim();
            if (!text || isProcessing) return;
            textInput.value = '';
            handleUserInput(text);
        });
        textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const text = textInput.value.trim();
                if (!text || isProcessing) return;
                textInput.value = '';
                handleUserInput(text);
            }
        });

        // 拍照
        photoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) handlePhoto(file);
            photoInput.value = '';
        });

        btnText.textContent = '点击 打字';
        statusTip.textContent = '⌨️ 打字输入，点发送即可';
    }

    console.log('亲语已启动 | 模式:', currentMode, '| 语音支持:', SPEECH_SUPPORTED);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
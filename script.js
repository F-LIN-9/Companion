// ================================================================
// 亲语 · 核心逻辑
// 功能：语音输入 → 调用 DeepSeek API 精简老人语言 → 语音播报
// 技术：Web Speech API (语音识别 + 语音合成) + Fetch API
// ================================================================

// ---------- 配置 ----------
// 请替换成你自己的 DeepSeek API Key（免费申请：platform.deepseek.com）
const DEEPSEEK_API_KEY = 'sk-9725cc304b40426f8d51e244cd71d063';  
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

// ---------- DOM 引用 ----------
const messageList = document.getElementById('messageList');
const recordBtn = document.getElementById('recordBtn');
const btnIcon = document.getElementById('btnIcon');
const btnText = document.getElementById('btnText');
const statusTip = document.getElementById('statusTip');
const callBtn = document.getElementById('callBtn');
const regenerateBtn = document.getElementById('regenerateBtn');

// ---------- 状态 ----------
let isRecording = false;
let isProcessing = false;
let lastUserText = '';          // 用户最后一次输入的原文
let lastAssistantText = '';     // AI最后一次回复的精简文本
let recognition = null;
let synth = window.speechSynthesis;

// ---------- 初始化语音识别 ----------
function initSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        statusTip.textContent = '?? 您的浏览器不支持语音识别，请使用 Chrome 或 Edge';
        recordBtn.disabled = true;
        return null;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SpeechRecognition();
    rec.lang = 'zh-CN';
    rec.continuous = false;       // 单次识别，说完即止
    rec.interimResults = false;   // 只返回最终结果，避免老人困惑
    rec.maxAlternatives = 1;

    // 识别结果
    rec.onresult = (event) => {
        const last = event.results.length - 1;
        const text = event.results[last][0].transcript;
        if (text && text.trim().length > 0) {
            handleUserSpeech(text.trim());
        } else {
            statusTip.textContent = '?? 没听清，再按一次说吧';
            resetButton();
        }
    };

    rec.onerror = (event) => {
        console.warn('语音识别错误:', event.error);
        if (event.error === 'not-allowed') {
            statusTip.textContent = '?? 请允许使用麦克风权限';
        } else if (event.error === 'no-speech') {
            statusTip.textContent = '?? 没有说话吗？再按一次试试';
        } else {
            statusTip.textContent = '? 出了点小问题，再试一次';
        }
        resetButton();
    };

    rec.onend = () => {
        // 如果正在录音状态但结束了（用户松手触发 stop），但没产生结果
        if (isRecording) {
            // 防止在 onresult 之后再次触发 reset 导致重复
            // 用延迟确保 onresult 先执行
            setTimeout(() => {
                if (isRecording) {
                    resetButton();
                    statusTip.textContent = '?? 按住说话，松开结束';
                }
            }, 300);
        }
    };

    return rec;
}

// ---------- 重置按钮状态 ----------
function resetButton() {
    isRecording = false;
    recordBtn.classList.remove('recording');
    btnIcon.textContent = '??';
    btnText.textContent = '按住 说话';
    if (!isProcessing) {
        // 如果不在处理中，恢复提示；否则由处理函数接管
        // 但为了安全，不覆盖处理中的状态
    }
}

// ---------- 处理用户语音输入 ----------
async function handleUserSpeech(text) {
    if (isProcessing) return;
    isProcessing = true;
    lastUserText = text;

    // 1. 显示用户消息
    appendMessage('user', text);

    // 2. 显示“正在思考”
    const botMsgId = appendMessage('bot', '? 正在帮您整理……', true);

    // 3. 调用 DeepSeek 精简语言
    try {
        const simplified = await callDeepSeek(text);
        lastAssistantText = simplified;

        // 更新机器人的回复（替换占位）
        updateBotMessage(botMsgId, simplified);

        // 4. 语音播报精简结果
        speakText(simplified);

        // 5. 启用辅助按钮
        callBtn.disabled = false;
        regenerateBtn.disabled = false;
        callBtn.classList.add('active-btn');
        regenerateBtn.classList.add('active-btn');

        statusTip.textContent = '? 已整理好，可以拨给家人了';

    } catch (error) {
        console.error('DeepSeek 调用失败:', error);
        updateBotMessage(botMsgId, '?? 网络有点忙，请您再试一次好吗？');
        statusTip.textContent = '?? 连接失败，检查网络或 API Key';
    } finally {
        isProcessing = false;
        resetButton();
    }
}

// ---------- 调用 DeepSeek API ----------
async function callDeepSeek(userText) {
    if (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY === 'sk-你的DeepSeek密钥') {
        // 未配置 API Key 时使用模拟回复（演示用）
        return simulateReply(userText);
    }

    const systemPrompt = `你是一位耐心、温和的晚辈助手，专门帮老年人把话说清楚。

任务：用户（老人）说了一段话，可能很啰嗦、跳跃、夹杂很多背景信息。请你：
1. 理解老人真正想表达的核心意思。
2. 用简洁、清晰、有条理的语言重新组织，保留老人的情感和语气。
3. 最终输出只包含精简后的内容，不要添加任何额外解释、不要评价老人的表达。

示例：
用户："哎呀，我那个儿子啊，就是小刚，他好久没回来了，我上回给他打电话，他说忙，我这心里头啊，老惦记着，也不知道他吃饭吃得好不好，你说这孩子……"
输出："小刚最近忙，好久没回家了。我惦记他，担心他吃不好。"

现在请处理以下内容：`;

    try {
        const response = await fetch(DEEPSEEK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userText }
                ],
                temperature: 0.7,
                max_tokens: 500
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API 请求失败: ${response.status} ${errText}`);
        }

        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content?.trim();
        if (!reply) {
            throw new Error('API 返回内容为空');
        }
        return reply;

    } catch (error) {
        console.warn('DeepSeek API 调用失败，使用模拟回复:', error.message);
        return simulateReply(userText);
    }
}

// ---------- 模拟回复（当 API Key 未配置或网络不通时使用） ----------
function simulateReply(text) {
    // 如果用户说了很长的话，简单压缩
    if (text.length > 30) {
        // 提取关键句（按标点切分取前两句）
        const sentences = text.split(/[，,。.！!？?、；;]/).filter(s => s.trim().length > 3);
        if (sentences.length >= 2) {
            return sentences.slice(0, 2).join('，') + '。';
        }
        return text.slice(0, 40) + '……（是这样吗？）';
    }
    return text + '，我知道了。';
}

// ---------- 语音合成（播报） ----------
function speakText(text) {
    if (!synth) {
        synth = window.speechSynthesis;
    }
    // 取消之前未完成的播报
    synth.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-CN';
    utter.rate = 0.9;      // 稍慢，适合老人听
    utter.pitch = 1.0;
    utter.volume = 1.0;

    // 尝试选择中文语音
    const voices = synth.getVoices();
    const zhVoice = voices.find(v => v.lang.startsWith('zh'));
    if (zhVoice) utter.voice = zhVoice;

    // 加载语音列表（部分浏览器需要异步加载）
    if (voices.length === 0) {
        synth.onvoiceschanged = () => {
            const updated = synth.getVoices();
            const zh = updated.find(v => v.lang.startsWith('zh'));
            if (zh) utter.voice = zh;
            synth.speak(utter);
        };
        return;
    }

    synth.speak(utter);
}

// ---------- 渲染消息 ----------
function appendMessage(role, content, isPlaceholder = false) {
    const div = document.createElement('div');
    div.className = `msg-${role}`;
    const avatar = role === 'user' ? '??' : '??';
    const bubbleClass = 'bubble' + (isPlaceholder ? ' placeholder' : '');
    div.innerHTML = `
        <div class="avatar">${avatar}</div>
        <div class="${bubbleClass}">${content}</div>
    `;
    if (isPlaceholder) {
        div.dataset.placeholder = 'true';
        div.id = `msg-${Date.now()}`;
    }
    messageList.appendChild(div);
    // 滚动到底部
    const chatArea = document.getElementById('chatArea');
    chatArea.scrollTop = chatArea.scrollHeight;
    return div;
}

function updateBotMessage(msgElement, newContent) {
    if (!msgElement) return;
    const bubble = msgElement.querySelector('.bubble');
    if (bubble) {
        bubble.textContent = newContent;
        bubble.classList.remove('placeholder');
    }
    // 滚动到底部
    const chatArea = document.getElementById('chatArea');
    chatArea.scrollTop = chatArea.scrollHeight;
}

// ---------- 录音按钮交互 ----------
function setupRecordButton() {
    if (!recognition) {
        recognition = initSpeechRecognition();
        if (!recognition) return;
    }

    // 按下开始录音
    recordBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (isProcessing) return;
        startRecording();
    });

    recordBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (isProcessing) return;
        startRecording();
    });

    // 松开结束录音
    recordBtn.addEventListener('mouseup', (e) => {
        e.preventDefault();
        if (isRecording) stopRecording();
    });
    recordBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (isRecording) stopRecording();
    });

    // 防止手指滑出按钮导致 touchend 不触发
    recordBtn.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        if (isRecording) stopRecording();
    });

    // 鼠标离开按钮区域也停止（防止按住后移出）
    recordBtn.addEventListener('mouseleave', () => {
        if (isRecording) stopRecording();
    });
}

function startRecording() {
    if (!recognition) return;
    try {
        recognition.start();
        isRecording = true;
        recordBtn.classList.add('recording');
        btnIcon.textContent = '??';
        btnText.textContent = '松开 结束';
        statusTip.textContent = '??? 正在听，慢慢说……';
    } catch (e) {
        // 防止重复 start 报错
        if (e.message && e.message.includes('already started')) {
            // 忽略
        } else {
            console.warn('startRecording error:', e);
        }
    }
}

function stopRecording() {
    if (!recognition) return;
    try {
        recognition.stop();
        // 注意：onend 会触发 reset，但这里先不重置，等 onresult 或 onend 处理
        // 但为了防止卡死，加一个安全重置
        setTimeout(() => {
            if (isRecording) {
                resetButton();
                statusTip.textContent = '?? 按住说话，松开结束';
            }
        }, 1000);
    } catch (e) {
        console.warn('stopRecording error:', e);
        resetButton();
    }
}

// ---------- 辅助按钮 ----------
// 拨打电话：模拟呼叫（实际可调起系统电话）
callBtn.addEventListener('click', () => {
    if (!lastAssistantText) return;
    // 尝试提取家人称呼，简单模拟
    const msg = `要不要现在就打给家人？您可以说：${lastAssistantText}`;
    alert(msg);
    // 真实场景：可 prompt 用户确认后调起 tel:// 链接
    // 例如：window.location.href = 'tel:13800138000';
});

// 重新生成（再说一遍）
regenerateBtn.addEventListener('click', () => {
    if (lastUserText) {
        // 清除上一条机器人回复，重新处理
        const botMessages = document.querySelectorAll('.msg-bot');
        const lastBot = botMessages[botMessages.length - 1];
        if (lastBot) {
            lastBot.remove();
        }
        // 重新调用
        handleUserSpeech(lastUserText);
    }
});

// ---------- 初始化 ----------
function init() {
    // 预加载语音
    if (synth) {
        synth.getVoices();
        synth.onvoiceschanged = () => { synth.getVoices(); };
    }
    setupRecordButton();

    // 处理语音识别权限（部分浏览器需用户手势触发）
    console.log('亲语已启动，按大按钮说话即可。');
}

// DOM 加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
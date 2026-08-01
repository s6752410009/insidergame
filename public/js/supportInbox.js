(function() {
    'use strict';

    const root = document.getElementById('support-app');
    if (!root) return;

    const playerId = root.dataset.playerId;
    const threadElement = document.getElementById('support-thread');
    const form = document.getElementById('support-form');
    const input = document.getElementById('support-message-input');
    const submitButton = document.getElementById('support-send');
    const feedback = document.getElementById('support-feedback');
    let requestInFlight = false;

    function formatTime(value) {
        return new Intl.DateTimeFormat('th-TH', {
            dateStyle: 'short',
            timeStyle: 'short'
        }).format(new Date(value));
    }

    function renderThread(thread) {
        threadElement.replaceChildren();
        const messages = Array.isArray(thread?.messages) ? thread.messages : [];
        if (!messages.length) {
            const empty = document.createElement('div');
            empty.className = 'support-empty';
            empty.textContent = 'ยังไม่มีข้อความ\nพิมพ์หาแอดมินได้เลย ข้อความจะถูกเก็บไว้แม้แอดมินออฟไลน์';
            threadElement.appendChild(empty);
            return;
        }

        messages.forEach(message => {
            const item = document.createElement('article');
            const isUser = message.sender === 'user';
            item.className = `support-message${isUser ? ' is-user' : ''}`;

            const bubble = document.createElement('p');
            bubble.className = 'support-bubble';
            bubble.textContent = message.body;

            const meta = document.createElement('span');
            meta.className = `support-message-meta${isUser && message.readAt ? ' is-read' : ''}`;
            const readLabel = isUser ? (message.readAt ? ' · แอดมินอ่านแล้ว' : ' · ส่งแล้ว ยังไม่ได้อ่าน') : ' · Site admin';
            meta.textContent = `${formatTime(message.createdAt)}${readLabel}`;

            item.append(bubble, meta);
            threadElement.appendChild(item);
        });
        threadElement.scrollTop = threadElement.scrollHeight;
    }

    async function loadThread(options) {
        const silent = Boolean(options?.silent);
        if (requestInFlight) return;
        requestInFlight = true;
        try {
            const response = await fetch(`/api/admin-messages/thread?playerId=${encodeURIComponent(playerId)}`, {
                headers: { Accept: 'application/json' },
                cache: 'no-store'
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'โหลดข้อความไม่สำเร็จ');
            renderThread(data.thread);
            if (!silent) feedback.textContent = '';
        } catch (error) {
            if (!silent) {
                feedback.textContent = error.message;
                feedback.classList.add('is-error');
            }
        } finally {
            requestInFlight = false;
        }
    }

    form.addEventListener('submit', async function(event) {
        event.preventDefault();
        const message = input.value.trim();
        if (!message) return;

        submitButton.disabled = true;
        feedback.classList.remove('is-error');
        feedback.textContent = 'กำลังส่ง…';
        try {
            const response = await fetch('/api/admin-messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ playerId, message })
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'ส่งข้อความไม่สำเร็จ');
            input.value = '';
            renderThread(data.thread);
            feedback.textContent = 'ส่งถึงกล่องข้อความของแอดมินแล้ว';
        } catch (error) {
            feedback.textContent = error.message;
            feedback.classList.add('is-error');
        } finally {
            submitButton.disabled = false;
            input.focus();
        }
    });

    loadThread();
    window.setInterval(() => loadThread({ silent: true }), 15000);
})();

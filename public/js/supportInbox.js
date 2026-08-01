(function() {
    'use strict';

    const root = document.getElementById('support-app');
    if (!root) return;

    const playerId = root.dataset.playerId;
    const supportToken = root.dataset.supportToken || '';
    const threadElement = document.getElementById('support-thread');
    const form = document.getElementById('support-form');
    const input = document.getElementById('support-message-input');
    const submitButton = document.getElementById('support-send');
    const feedback = document.getElementById('support-feedback');
    let requestInFlight = false;

    function supportHeaders(extra) {
        return Object.assign({
            Accept: 'application/json',
            'X-Support-Token': supportToken
        }, extra || {});
    }

    function formatTime(value) {
        return new Intl.DateTimeFormat('th-TH', {
            dateStyle: 'short',
            timeStyle: 'short'
        }).format(new Date(value));
    }

    function showThreadMessage(text, isError) {
        threadElement.replaceChildren();
        const empty = document.createElement('div');
        empty.className = 'support-empty';
        empty.textContent = text;
        threadElement.appendChild(empty);
        if (isError) {
            const retry = document.createElement('a');
            retry.className = 'support-retry-link';
            retry.href = '/support?playerId=' + encodeURIComponent(playerId || '');
            retry.textContent = 'เปิดหน้าติดต่อแอดมินใหม่อีกครั้ง';
            threadElement.appendChild(retry);
        }
    }

    function renderThread(thread) {
        threadElement.replaceChildren();
        const messages = Array.isArray(thread?.messages) ? thread.messages : [];
        if (!messages.length) {
            showThreadMessage('ยังไม่มีข้อความ\nพิมพ์หาแอดมินได้เลย ข้อความจะถูกเก็บไว้แม้แอดมินออฟไลน์');
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
                headers: supportHeaders(),
                cache: 'no-store',
                credentials: 'same-origin'
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'โหลดข้อความไม่สำเร็จ');
            renderThread(data.thread);
            if (!silent) {
                feedback.textContent = '';
                feedback.classList.remove('is-error');
            }
        } catch (error) {
            if (!silent) {
                feedback.textContent = error.message;
                feedback.classList.add('is-error');
                showThreadMessage('โหลดข้อความไม่สำเร็จ', true);
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
                headers: supportHeaders({ 'Content-Type': 'application/json' }),
                credentials: 'same-origin',
                body: JSON.stringify({ playerId, message, supportToken })
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

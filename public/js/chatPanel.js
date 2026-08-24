/* Shared in-game chat panel behaviour — ported from the Insider board.
 * Requires jQuery, SweetAlert2 and the markup shipped in chatPanel.css.
 *
 * initChatPanel({ socket, playerId, playerName, onIncoming, onCommand })
 *   socket      — connected socket.io client
 *   playerId    — this player's id (used to right-align own messages)
 *   playerName  — fallback match when the payload has no playerId
 *   onIncoming  — optional callback(data, isMyMessage) e.g. to play a sound
 *   onCommand   — optional callback(text); return true to swallow the input
 *                 instead of sending it (used for slash commands like /m)
 */
(function attachChatPanel(global) {
    function initChatPanel(options) {
        const opts = options || {};
        const socket = opts.socket;
        const playerId = opts.playerId;
        const playerName = opts.playerName;
        const onIncoming = typeof opts.onIncoming === 'function' ? opts.onIncoming : null;
        const onCommand = typeof opts.onCommand === 'function' ? opts.onCommand : null;

        if (!socket || typeof jQuery === 'undefined') {
            return null;
        }

        const $ = jQuery;
        let replyingTo = null;

        function escapeText(value) {
            return $('<div>').text(value == null ? '' : value).html();
        }

        // แชทยาวๆ เคยสะสมใน DOM ไปเรื่อยๆ (วัดได้ 1,000 ข้อความ = 9,000 element, scroll 90,000px)
        // server เก็บย้อนหลังแค่ 100 ข้อความอยู่แล้ว เก็บบนจอ 200 จึงเกินพอ
        const MAX_CHAT_MESSAGES = 200;
        function trimOldMessages(area) {
            if (!area || area.children.length <= MAX_CHAT_MESSAGES) return;
            const before = area.scrollHeight;
            while (area.children.length > MAX_CHAT_MESSAGES) {
                area.removeChild(area.firstElementChild);
            }
            // ตัดจากด้านบนทำให้ความสูงหาย ถ้ามีคนกำลังอ่านย้อนอยู่ต้องเลื่อนชดเชย
            // ไม่งั้นข้อความจะกระโดดหนีสายตา
            const shrank = before - area.scrollHeight;
            if (shrank > 0) area.scrollTop = Math.max(0, area.scrollTop - shrank);
        }

        function isChatOpen() {
            return $('#chatBox').is(':visible');
        }

        function clearReply() {
            replyingTo = null;
            $('#replyPreview').hide();
            $('#replyPreview .reply-player-name').empty();
            $('#replyPreview .reply-message-content').empty();
        }

        // The bubble holds the reply snippet and the name span too — strip both
        // so reply/copy only carry the message text itself.
        function bubbleText($wrapper) {
            const $bubble = $wrapper.find('.chat-message-bubble');
            return $bubble.contents().filter(function() {
                return this.nodeType === 3
                    || (this.nodeType === 1 && $(this).is(':not(.chat-message-name, .reply-to-text)'));
            }).text().trim();
        }

        function setReplyToMessage($wrapper) {
            const name = $wrapper.find('.chat-message-name').text().replace(':', '').trim();
            replyingTo = {
                id: $wrapper.data('message-id'),
                name: name,
                content: bubbleText($wrapper).split('\n')[0]
            };

            $('#replyPreview .reply-player-name')
                .css('color', $wrapper.find('.chat-message-name').css('color'))
                .text(replyingTo.name);
            $('#replyPreview .reply-message-content').text(replyingTo.content);
            $('#replyPreview').show();
            $('#chatInput').focus();
            $('.chat-context-menu').remove();
        }

        function copyMessageText($wrapper) {
            const text = bubbleText($wrapper);
            const toast = function() {
                if (global.Swal) {
                    global.Swal.fire({
                        toast: true, position: 'top', icon: 'success',
                        title: 'คัดลอกข้อความแล้ว', showConfirmButton: false, timer: 1500,
                        background: '#1e1e1e', color: '#fff'
                    });
                }
            };

            if (navigator.clipboard) {
                navigator.clipboard.writeText(text).then(toast).catch(function() {
                    const $temp = $('<textarea>');
                    $('body').append($temp);
                    $temp.val(text).select();
                    document.execCommand('copy');
                    $temp.remove();
                });
            }
            $('.chat-context-menu').remove();
        }

        function showContextMenu($wrapper, x, y) {
            $('.chat-context-menu').remove();

            const $menu = $(
                '<div class="chat-context-menu" style="left:' + x + 'px; top:' + y + 'px;">' +
                    '<button type="button" class="chat-context-menu-item" data-action="reply"><span class="menu-icon">↩️</span> ตอบกลับ</button>' +
                    '<button type="button" class="chat-context-menu-item" data-action="copy"><span class="menu-icon">📋</span> คัดลอก</button>' +
                '</div>'
            );
            $('body').append($menu);

            if (x + $menu.outerWidth() > $(global).width()) {
                $menu.css('left', $(global).width() - $menu.outerWidth() - 10);
            }
            if (y + $menu.outerHeight() > $(global).height()) {
                $menu.css('top', $(global).height() - $menu.outerHeight() - 10);
            }
            $menu.data('wrapper', $wrapper);
        }

        function appendMessage(data, settings) {
            const renderSettings = settings || {};
            const $msgArea = $('#chatMessages');
            const isMyMessage = (data.playerId && data.playerId === playerId)
                || (!data.playerId && data.playerName === playerName);

            const $wrapper = $('<div class="chat-message-wrapper ' + (isMyMessage ? 'self' : 'other') + '"></div>')
                .attr('data-message-id', data.messageId);
            const $bubble = $('<div class="chat-message-bubble"></div>');
            const $info = $('<div class="chat-message-info"></div>').text(data.timestamp || '');

            if (!isMyMessage && data.color) {
                $bubble.css('background-color', data.color + '33');
            }

            if (data.replyTo) {
                const replyColor = data.replyTo.name === playerName ? '#fff' : (data.replyTo.color || '#ddd');
                $bubble.append(
                    '<span class="reply-to-text">' +
                        '<span class="reply-indicator">ตอบกลับ </span>' +
                        '<span class="reply-name" style="color:' + escapeText(replyColor) + ';">' +
                            escapeText(data.replyTo.name) + ':</span> ' +
                        escapeText(data.replyTo.content) +
                    '</span>'
                );
            }

            $bubble.append(
                '<span class="chat-message-name" style="color:' + (isMyMessage ? '#fff' : escapeText(data.color || '#fff')) + ';">' +
                escapeText(data.displayName || data.playerName) + ':</span> ' + escapeText(data.message)
            );

            // รูปผู้เล่น + กรอบ แสดงข้างฟองแชท (System ไม่ต้องมีรูป)
            const showAvatar = data.playerName !== 'System' && typeof global.renderPlayerAvatar === 'function';
            const $row = $('<div class="chat-message-row"></div>').append(
                showAvatar
                    ? global.renderPlayerAvatar({
                        avatar: data.avatar,
                        avatarFrame: data.avatarFrame,
                        color: data.color,
                        playerName: data.displayName || data.playerName
                    }, { size: 30, className: 'chat-message-avatar' })
                    : '',
                $bubble
            );

            $wrapper.append(
                '<div class="swipe-reply-indicator">↩️</div>',
                $row,
                '<div class="chat-message-actions"><button type="button" class="chat-action-btn" title="ตัวเลือก" aria-label="ตัวเลือกข้อความ">⋮</button></div>',
                $info
            );
            $msgArea.append($wrapper);
            trimOldMessages($msgArea[0]);
            $msgArea[0].scrollTop = $msgArea[0].scrollHeight;

            if (!renderSettings.silent && !isChatOpen()) {
                $('#chatUnreadDot').show();
            }
            if (!renderSettings.silent && onIncoming) {
                onIncoming(data, isMyMessage);
            }
        }

        function sendMessage() {
            const text = $('#chatInput').val().trim();
            if (!text) return;

            // คำสั่ง /… ที่เกมจัดการเอง ต้องไม่หลุดไปเป็นข้อความในห้อง
            if (onCommand && onCommand(text) === true) {
                $('#chatInput').val('').focus();
                return;
            }

            const payload = { message: text, playerName: playerName };
            if (replyingTo) {
                payload.replyTo = replyingTo;
                clearReply();
            }
            socket.emit('sendMessage', payload);
            $('#chatInput').val('').focus();
            $('#chatUnreadDot').hide();
        }

        // ---- wiring ----
        socket.on('newMessage', appendMessage);

        $('#toggleChat').on('click', function() {
            const open = !isChatOpen();
            $('#chatBox').toggle(open).attr('aria-hidden', open ? 'false' : 'true');
            $(this).attr('aria-expanded', open ? 'true' : 'false');
            if (open) {
                $('#chatUnreadDot').hide();
                $('#chatInput').focus();
            }
        });

        $(document).on('click', '#closeChat', function() {
            $('#chatBox').hide().attr('aria-hidden', 'true');
            $('#toggleChat').attr('aria-expanded', 'false');
            $('#toggleChat').focus();
        });

        $(document).on('keydown', function(event) {
            if (!isChatOpen()) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                $('#closeChat').trigger('click');
                return;
            }
            if (event.key !== 'Tab') return;
            const panel = document.getElementById('chatBox');
            const focusable = Array.from(panel.querySelectorAll('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
                .filter(node => node.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });

        $('#sendChat').on('click', sendMessage);

        $('#chatInput').on('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        $(document).on('click', '#replyPreview .reply-cancel-btn', clearReply);

        $(document).on('click', '.chat-action-btn', function(e) {
            e.stopPropagation();
            const rect = this.getBoundingClientRect();
            showContextMenu($(this).closest('.chat-message-wrapper'), rect.left, rect.bottom + 5);
        });

        $(document).on('click', '.chat-context-menu-item', function() {
            const $wrapper = $(this).closest('.chat-context-menu').data('wrapper');
            if ($(this).data('action') === 'reply') {
                setReplyToMessage($wrapper);
            } else {
                copyMessageText($wrapper);
            }
        });

        $(document).on('click', function(e) {
            if (!$(e.target).closest('.chat-context-menu, .chat-action-btn').length) {
                $('.chat-context-menu').remove();
            }
        });

        // ---- swipe-to-reply (mobile) ----
        let touchStartX = 0;
        let touchStartY = 0;
        let $swiping = null;
        const SWIPE_THRESHOLD = 80;

        $(document).on('touchstart', '.chat-message-wrapper', function(e) {
            touchStartX = e.originalEvent.touches[0].clientX;
            touchStartY = e.originalEvent.touches[0].clientY;
            $swiping = $(this);
        });

        $(document).on('touchmove', '.chat-message-wrapper', function(e) {
            if (!$swiping) return;
            const diffX = e.originalEvent.touches[0].clientX - touchStartX;
            const diffY = Math.abs(e.originalEvent.touches[0].clientY - touchStartY);
            if (diffX > 20 && diffY < 50) {
                e.preventDefault();
                $swiping.css('transform', 'translateX(' + Math.min(diffX, 100) + 'px)');
                $swiping.addClass('swiping').toggleClass('swiped', diffX > SWIPE_THRESHOLD);
            }
        });

        $(document).on('touchend', '.chat-message-wrapper', function(e) {
            if (!$swiping) return;
            const diffX = e.originalEvent.changedTouches[0].clientX - touchStartX;
            $swiping.css('transform', '').removeClass('swiping swiped');
            if (diffX > SWIPE_THRESHOLD) {
                setReplyToMessage($swiping);
                if (navigator.vibrate) navigator.vibrate(50);
            }
            $swiping = null;
        });

        return { appendMessage: appendMessage, clearReply: clearReply };
    }

    global.initChatPanel = initChatPanel;
})(typeof window !== 'undefined' ? window : globalThis);

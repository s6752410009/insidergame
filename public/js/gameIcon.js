(function attachRenderGameIcon(global) {
    function escapeAttr(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // second arg accepts a class string or an options object ({ className })
    function renderGameIcon(meta, classNameOrOptions) {
        const entry = meta && typeof meta === 'object' ? meta : {};
        const options = classNameOrOptions && typeof classNameOrOptions === 'object'
            ? classNameOrOptions
            : { className: classNameOrOptions };
        const alt = entry.alt || entry.title || entry.name || entry.label || '';
        const cls = options.className || 'game-icon';
        const useImage = entry.image && entry.inline !== true;

        if (useImage) {
            return `<img src="${escapeAttr(entry.image)}" alt="${escapeAttr(alt)}" class="${escapeAttr(cls)}" loading="lazy" decoding="async" />`;
        }

        const icon = entry.icon || '🎴';
        return `<span class="${escapeAttr(cls)} game-icon-fallback" aria-hidden="true">${icon}</span>`;
    }

    global.renderGameIcon = renderGameIcon;
})(typeof window !== 'undefined' ? window : globalThis);

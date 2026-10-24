# Slave character artwork

Created with the built-in `image_gen` tool on 2026-10-24 for the illustrated Slave table UI.

Production asset: `public/img/slave/portraits-v1.jpg` (768 × 768, about 164 KiB). The four portraits are a single 2 × 2 atlas; CSS crops them without extra requests. The atlas represents the four built-in avatar values: 👤 top left, 👻 top right, 🦊 bottom left, 🐼 bottom right. Other emoji and custom avatar image URLs keep their existing rendering.

The original generated PNG remains under the Codex generated-images directory. The production JPEG was resized and compressed with macOS `sips`; no semantic image edits were made. Keep the repository asset available independently of that local generated-images directory.

## Generation prompt

Use case: stylized-concept. Asset type: production character portrait sprite atlas for a friendly Thai four-player Slave card game. Create ONE square image containing exactly FOUR equal square portrait tiles arranged in a clean 2 by 2 grid, each tile filling its quarter edge to edge, no gutters and no outlines separating tiles. Top left: a cheerful young adult card player wearing a red cap and a cream jacket, friendly confident smile, gender neutral styling. Top right: a cute rounded ivory ghost with expressive charcoal eyes, a small mischievous grin and a tiny gold bow tie. Bottom left: a charismatic orange fox card player with cream muzzle and a dark green vest. Bottom right: a friendly panda card player in a burgundy scarf, confident smile. All four: close-up head and shoulders, facing camera, centered perfectly within their own square tile with face occupying the central 65 percent so circular crop preserves the face. Style: polished illustrated mobile board game character art, softly sculpted hand-painted 3D shapes, bold clean silhouettes, warm directional highlights, gentle ambient shadows, rich color, tactile toy-like materials, sophisticated friendly expression. Consistent art direction and light from top left. Tile backgrounds: top left muted golden ochre, top right dusty violet, bottom left muted brick red, bottom right muted jade green. No cards in hands, no UI, no labels, no letters, no numbers, no logos, no watermark. This is game portrait artwork, not a screenshot or UI mockup.

## UI ownership

- `public/css/slave.css`: turn layout, readable cards, responsive sizing and common states.
- `public/css/slave-game.css`: illustrated game skin, wood/cloth materials, portrait frames, active-seat countdown ring, raised controls and result medals.
- `public/js/slaveBoard.js`: maps the built-in avatars to the atlas, retains the seat DOM while selecting cards, and animates plays from their relative seat direction. Timer decoration derives from the existing server deadline. It adds no game rules or currencies.
- `prefers-reduced-motion` disables portrait/play animations. Sound preferences and WebAudio are unchanged.
